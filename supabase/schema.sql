-- Tally - Supabase schema.
--
-- Run this in the Supabase SQL editor for a new project, and re-run it to
-- upgrade an existing one: every statement here is idempotent, so it is also
-- the migration. Nothing else needs applying on top, and nothing older should
-- be applied afterwards.
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
  -- 1 when bought before travel; still counts toward budget, not a trip day.
  is_pretrip integer not null default 0,
  paid_by uuid,
  shopback_type text,
  shopback_value numeric,
  shopback_amount numeric,
  shopback_amount_nzd numeric,
  shopback_status text,
  shopback_confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- `create table if not exists` does nothing to a table that already exists, so
-- every column added after the first release needs its own statement here for
-- this file to be a complete migration as well as a complete schema.
alter table public.expenses add column if not exists shopback_type text;
alter table public.expenses add column if not exists shopback_value numeric;
alter table public.expenses add column if not exists shopback_amount numeric;
alter table public.expenses add column if not exists shopback_amount_nzd numeric;
alter table public.expenses add column if not exists shopback_status text;
alter table public.expenses add column if not exists shopback_confirmed_at timestamptz;

-- Pre-trip bookings were called "preflight" for one release. Rename rather than
-- add, so a project from that window keeps the rows it already has.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'expenses' and column_name = 'is_preflight'
  ) then
    alter table public.expenses rename column is_preflight to is_pretrip;
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'expenses' and column_name = 'is_pretrip'
  ) then
    alter table public.expenses add column is_pretrip integer not null default 0;
  end if;
end $$;

-- Pulls page through `(updated_at, id)` in that order, so the index carries the
-- tiebreaker too. Without it every page after the first is a sort.
create index if not exists idx_expenses_trip_updated on public.expenses (trip_id, updated_at);
create index if not exists idx_expenses_updated_id on public.expenses (updated_at, id);
create index if not exists idx_legs_trip_updated on public.trip_legs (trip_id, updated_at);
create index if not exists idx_legs_updated_id on public.trip_legs (updated_at, id);
create index if not exists idx_members_user on public.trip_members (user_id);
create index if not exists idx_members_updated_id on public.trip_members (updated_at, id);
create index if not exists idx_budgets_updated_id on public.category_budgets (updated_at, id);
create index if not exists idx_trips_updated_id on public.trips (updated_at, id);

-- ---------------------------------------------------------------- timestamps

-- `updated_at` decides every conflict and drives the pull watermark, so it must
-- come from one clock. Taking the phone's value meant a device running fast won
-- every conflict for as long as its clock stayed ahead, and a device running
-- slow wrote rows stamped in the past that the partner's watermark had already
-- moved beyond — those expenses were never pulled and simply went missing.
-- The client reads the stamped value back out of the response and stores it.
create or replace function private.stamp_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trips_stamp_updated_at on public.trips;
create trigger trips_stamp_updated_at before insert or update on public.trips
  for each row execute function private.stamp_updated_at();

drop trigger if exists trip_members_stamp_updated_at on public.trip_members;
create trigger trip_members_stamp_updated_at before insert or update on public.trip_members
  for each row execute function private.stamp_updated_at();

drop trigger if exists trip_legs_stamp_updated_at on public.trip_legs;
create trigger trip_legs_stamp_updated_at before insert or update on public.trip_legs
  for each row execute function private.stamp_updated_at();

drop trigger if exists category_budgets_stamp_updated_at on public.category_budgets;
create trigger category_budgets_stamp_updated_at before insert or update on public.category_budgets
  for each row execute function private.stamp_updated_at();

drop trigger if exists expenses_stamp_updated_at on public.expenses;
create trigger expenses_stamp_updated_at before insert or update on public.expenses
  for each row execute function private.stamp_updated_at();

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

-- A join code the traveller has to read aloud or type from a phone screen, so
-- the alphabet omits the characters that are easy to confuse (0/O, 1/I).
--
-- Randomness comes from gen_random_uuid(), which is cryptographically strong on
-- PG13+. That matters: the code is a capability, and anyone holding it can join
-- the trip. 256 is a whole multiple of the 32-character alphabet, so the
-- modulo introduces no bias.
create or replace function private.unique_join_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  for attempt in 1..20 loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
      if i = 3 then v_code := v_code || '-'; end if;
    end loop;
    if not exists (select 1 from public.trips where join_code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'Could not allocate a unique join code';
end;
$$;

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

  insert into public.trip_members as m (id, trip_id, user_id, display_name)
  values (gen_random_uuid(), v_trip_id, (select auth.uid()), coalesce(p_display_name, ''))
  on conflict (trip_id, user_id) do update
    set deleted_at = null,
        -- An empty name means "not set on this device", not "clear the one I
        -- already have".
        display_name = case
          when excluded.display_name <> '' then excluded.display_name
          else m.display_name
        end;

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

-- Also granted to anon so the keep-alive cron can call it without an account.
-- Free-tier projects pause after ~7 days idle, and Tally is used in bursts, so
-- something has to touch Postgres between trips. This leaks nothing: the server
-- clock is already in the Date header of every response.
grant execute on function public.server_now() to anon;

-- Creates or updates a trip as the signed-in user. Used by sync instead of a
-- plain upsert: PostgREST upsert needs both INSERT and UPDATE RLS checks to
-- pass, and UPDATE fails before the membership row exists.
--
-- The membership row is written here, in the same transaction as the trip.
-- Doing it in a second round trip is what used to leave "orphan" trips on the
-- server whenever that second push failed, and the only way to let the creator
-- reclaim one was an RLS escape hatch that exposed every orphan — join code
-- included — to every account on the project. Writing both together means the
-- state the escape hatch existed for cannot arise.
--
-- Returns the values the server decided: the trigger-stamped `updated_at`, and
-- the join code, which is reassigned if the one the phone generated was taken.
drop function if exists public.upsert_own_trip(jsonb, text);

create function public.upsert_own_trip(p_trip jsonb, p_display_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := (p_trip->>'id')::uuid;
  v_exists boolean;
  v_has_members boolean;
  v_code text := p_trip->>'join_code';
  v_updated_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select exists(select 1 from public.trips where id = v_id) into v_exists;
  select exists(
    select 1 from public.trip_members
    where trip_id = v_id and deleted_at is null
  ) into v_has_members;

  -- Claiming a memberless trip is still allowed, but only here. A project
  -- upgraded from the version that pushed membership separately can be holding
  -- orphans already, and locking them out would strand the traveller's own
  -- trip with no way back. Reaching one now takes its uuid, which nothing hands
  -- out any more: the policy that used to list orphans to every account is gone,
  -- and no new orphan can be created because the insert below is part of this
  -- same transaction.
  if v_exists and not private.is_trip_member(v_id) and v_has_members then
    raise exception 'Not a member of this trip';
  end if;

  -- A phone cannot know which codes other devices have already taken. Reassign
  -- rather than fail: the unique violation would wedge this trip's push for
  -- good, with nothing the traveller could do about it.
  if v_code is null or exists (
    select 1 from public.trips where join_code = v_code and id <> v_id
  ) then
    v_code := private.unique_join_code();
  end if;

  if v_exists then
    update public.trips set
      name = p_trip->>'name',
      start_date = (p_trip->>'start_date')::date,
      end_date = (p_trip->>'end_date')::date,
      total_budget_nzd = coalesce((p_trip->>'total_budget_nzd')::numeric, 0),
      join_code = v_code,
      trip_type = coalesce(p_trip->>'trip_type', 'multi'),
      deleted_at = nullif(p_trip->>'deleted_at', '')::timestamptz
    where id = v_id;
  else
    insert into public.trips (
      id, name, start_date, end_date, total_budget_nzd, join_code, trip_type, deleted_at
    ) values (
      v_id,
      p_trip->>'name',
      (p_trip->>'start_date')::date,
      (p_trip->>'end_date')::date,
      coalesce((p_trip->>'total_budget_nzd')::numeric, 0),
      v_code,
      coalesce(p_trip->>'trip_type', 'multi'),
      nullif(p_trip->>'deleted_at', '')::timestamptz
    );
  end if;

  insert into public.trip_members as m (id, trip_id, user_id, display_name)
  values (gen_random_uuid(), v_id, v_uid, coalesce(p_display_name, ''))
  on conflict (trip_id, user_id) do update
    set deleted_at = null,
        display_name = case
          when excluded.display_name <> '' then excluded.display_name
          else m.display_name
        end;

  select updated_at into v_updated_at from public.trips where id = v_id;
  return jsonb_build_object('updated_at', v_updated_at, 'join_code', v_code);
end;
$$;

grant execute on function public.upsert_own_trip(jsonb, text) to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_legs enable row level security;
alter table public.category_budgets enable row level security;
alter table public.expenses enable row level security;

-- Membership is the only key to a trip. There is deliberately no exception for
-- trips that happen to have no members: that clause handed every authenticated
-- account on the project a listing of such trips, join codes included, and let
-- them overwrite the rows too. `upsert_own_trip` now writes the trip and its
-- membership together, so the case it covered no longer exists.
drop policy if exists trips_member_access on public.trips;
drop policy if exists trips_select on public.trips;
drop policy if exists trips_update on public.trips;
drop policy if exists trips_delete on public.trips;
-- Trips are only ever created through the security-definer RPC, which writes
-- the membership alongside. A direct INSERT policy would let any account create
-- rows outside that guarantee, so there is none.
drop policy if exists trips_insert_own on public.trips;

create policy trips_select on public.trips
  for select using (private.is_trip_member(id));

create policy trips_update on public.trips
  for update using (private.is_trip_member(id))
  with check (private.is_trip_member(id));

create policy trips_delete on public.trips
  for delete using (private.is_trip_member(id));

drop policy if exists members_read on public.trip_members;
create policy members_read on public.trip_members
  for select using (
    user_id = (select auth.uid()) or private.is_trip_member(trip_id)
  );

-- Split by command, because INSERT is the one that needs a different rule.
-- A single FOR ALL policy checked only that the row named you, not that you had
-- any right to the trip — so knowing a trip's id was enough to enrol yourself
-- and read every expense on it, straight past the join code. Creating a
-- membership now requires already having one, which `join_trip_with_code` and
-- `upsert_own_trip` are the two supported ways to get.
drop policy if exists members_write_self on public.trip_members;
drop policy if exists members_insert_self on public.trip_members;
drop policy if exists members_update_self on public.trip_members;
drop policy if exists members_delete_self on public.trip_members;

create policy members_insert_self on public.trip_members
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_trip_member(trip_id));

create policy members_update_self on public.trip_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy members_delete_self on public.trip_members
  for delete to authenticated
  using (user_id = (select auth.uid()));

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
grant execute on function public.server_now() to anon;
grant execute on function public.upsert_own_trip(jsonb, text) to authenticated;
