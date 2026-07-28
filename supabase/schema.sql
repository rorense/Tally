-- Tally - Supabase schema.
-- Run this once in the Supabase SQL editor for a new project.
--
-- Mirrors the SQLite schema on the device. The only structural difference is
-- that `dirty` is local-only and never leaves the phone.

-- Security definer helpers live outside the API-exposed schema.
create schema if not exists private;

-- ---------------------------------------------------------------- tables

create table if not exists public.trips (
  id uuid primary key,
  name text not null,
  start_date date not null,
  end_date date not null,
  total_budget_nzd numeric not null default 0,
  join_code text not null unique,
  -- 'single' hides the itinerary editor and keeps one leg covering the trip.
  trip_type text not null default 'multi',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Safe to re-run against a project created before trip types existed.
alter table public.trips
  add column if not exists trip_type text not null default 'multi';

create table if not exists public.trip_members (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (trip_id, user_id)
);

create table if not exists public.trip_legs (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  country_code text not null,
  currency_code text not null,
  start_date date not null,
  end_date date not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.category_budgets (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  category text not null,
  budget_nzd numeric not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (trip_id, category)
);

create table if not exists public.expenses (
  id uuid primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  leg_id uuid,
  country_code text not null,
  category text not null,
  description text not null default '',
  amount numeric not null,
  currency text not null,
  -- Frozen at entry time so historical totals never shift when rates move.
  rate_to_nzd numeric not null,
  amount_nzd numeric not null,
  spent_at timestamptz not null,
  -- The calendar day in the timezone the purchase happened in. Charts group by
  -- this, not spent_at, so an evening meal in Europe stays on the right day.
  local_date date not null,
  paid_by uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_expenses_trip_updated on public.expenses (trip_id, updated_at);
create index if not exists idx_legs_trip_updated on public.trip_legs (trip_id, updated_at);
create index if not exists idx_members_user on public.trip_members (user_id);

-- ---------------------------------------------------------------- helpers

-- A policy on trip_members that queries trip_members recurses infinitely.
-- security definer bypasses RLS on the inner read and breaks the cycle.
create or replace function private.is_trip_member(p_trip_id uuid)
returns boolean
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id
      and user_id = (select auth.uid())
      and deleted_at is null
  );
$$ language sql security definer stable;

-- Joining is a chicken-and-egg problem: a non-member cannot select the trip by
-- code, because the policy only shows trips you already belong to. This does
-- that single lookup with elevated rights and inserts the membership row.
create or replace function public.join_trip_with_code(p_code text, p_display_name text default '')
returns uuid
set search_path = ''
as $$
declare
  v_trip_id uuid;
  v_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;

  -- Accept both EURO-4K7P and EURO4K7P; partners type these from a phone screen.
  v_code := upper(regexp_replace(trim(p_code), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) = 8 then
    v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
  end if;

  select id into v_trip_id
  from public.trips
  where join_code = v_code and deleted_at is null;

  if v_trip_id is null then
    raise exception 'Invalid code';
  end if;

  insert into public.trip_members (id, trip_id, user_id, display_name)
  values (gen_random_uuid(), v_trip_id, (select auth.uid()), coalesce(p_display_name, ''))
  on conflict (trip_id, user_id) do update
    set deleted_at = null,
        display_name = excluded.display_name,
        updated_at = now();

  return v_trip_id;
end;
$$ language plpgsql security definer;

-- Wall clock used as the sync watermark. Must be the database's clock so a
-- phone set hours ahead cannot skip partner writes forever.
create or replace function public.server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

grant execute on function public.server_now() to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_legs enable row level security;
alter table public.category_budgets enable row level security;
alter table public.expenses enable row level security;

-- Split trip policies by command. A FOR ALL member policy also covers INSERT,
-- and for a brand-new trip `is_trip_member` is false, so the insert would be
-- denied even when a separate insert policy exists (depending on how policies
-- were applied). Keeping INSERT on its own policy avoids that trap.
drop policy if exists trips_member_access on public.trips;
drop policy if exists trips_select on public.trips;
drop policy if exists trips_update on public.trips;
drop policy if exists trips_delete on public.trips;
drop policy if exists trips_insert_own on public.trips;

create policy trips_select on public.trips
  for select using (private.is_trip_member(id));

create policy trips_update on public.trips
  for update using (private.is_trip_member(id))
  with check (private.is_trip_member(id));

create policy trips_delete on public.trips
  for delete using (private.is_trip_member(id));

-- Authenticated users may create a trip; the app then writes trip_members.
create policy trips_insert_own on public.trips
  for insert to authenticated with check (true);

drop policy if exists members_read on public.trip_members;
create policy members_read on public.trip_members
  for select using (
    user_id = (select auth.uid()) or private.is_trip_member(trip_id)
  );

drop policy if exists members_write_self on public.trip_members;
create policy members_write_self on public.trip_members
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists legs_member_access on public.trip_legs;
create policy legs_member_access on public.trip_legs
  for all using (private.is_trip_member(trip_id))
  with check (private.is_trip_member(trip_id));

drop policy if exists budgets_member_access on public.category_budgets;
create policy budgets_member_access on public.category_budgets
  for all using (private.is_trip_member(trip_id))
  with check (private.is_trip_member(trip_id));

drop policy if exists expenses_member_access on public.expenses;
create policy expenses_member_access on public.expenses
  for all using (private.is_trip_member(trip_id))
  with check (private.is_trip_member(trip_id));

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.join_trip_with_code(text, text) to authenticated;
grant execute on function public.server_now() to authenticated;
