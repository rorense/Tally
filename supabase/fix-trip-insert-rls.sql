-- Fix trip sync RLS.
-- Cause: PostgREST upsert requires BOTH insert and update policies to pass.
-- A brand-new trip has no members, so the update check fails and sync stalls.
-- Also: an earlier failed sync can leave a trip row with zero members; those
-- orphans must be claimable by the creator's next push.
-- Run once in the SQL editor, then fully reload the app and Sync now.

create or replace function public.upsert_own_trip(p_trip jsonb, p_display_name text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := (p_trip->>'id')::uuid;
  v_exists boolean;
  v_has_members boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Kept for client API stability; membership is pushed via trip_members.
  perform p_display_name;

  select exists(select 1 from public.trips where id = v_id) into v_exists;
  select exists(
    select 1 from public.trip_members
    where trip_id = v_id and deleted_at is null
  ) into v_has_members;

  if v_exists then
    if not private.is_trip_member(v_id) and v_has_members then
      raise exception 'Not a member of this trip';
    end if;

    update public.trips set
      name = p_trip->>'name',
      start_date = (p_trip->>'start_date')::date,
      end_date = (p_trip->>'end_date')::date,
      total_budget_nzd = coalesce((p_trip->>'total_budget_nzd')::numeric, 0),
      join_code = p_trip->>'join_code',
      trip_type = coalesce(p_trip->>'trip_type', 'multi'),
      updated_at = coalesce((p_trip->>'updated_at')::timestamptz, now()),
      deleted_at = nullif(p_trip->>'deleted_at', '')::timestamptz
    where id = v_id;
  else
    insert into public.trips (
      id, name, start_date, end_date, total_budget_nzd, join_code, trip_type, updated_at, deleted_at
    ) values (
      v_id,
      p_trip->>'name',
      (p_trip->>'start_date')::date,
      (p_trip->>'end_date')::date,
      coalesce((p_trip->>'total_budget_nzd')::numeric, 0),
      p_trip->>'join_code',
      coalesce(p_trip->>'trip_type', 'multi'),
      coalesce((p_trip->>'updated_at')::timestamptz, now()),
      nullif(p_trip->>'deleted_at', '')::timestamptz
    );
  end if;
end;
$$;

grant execute on function public.upsert_own_trip(jsonb, text) to authenticated;

drop policy if exists trips_member_access on public.trips;
drop policy if exists trips_select on public.trips;
drop policy if exists trips_update on public.trips;
drop policy if exists trips_delete on public.trips;
drop policy if exists trips_insert_own on public.trips;

create policy trips_select on public.trips
  for select using (
    private.is_trip_member(id)
    or not exists (
      select 1 from public.trip_members m
      where m.trip_id = id and m.deleted_at is null
    )
  );

create policy trips_update on public.trips
  for update using (
    private.is_trip_member(id)
    or not exists (
      select 1 from public.trip_members m
      where m.trip_id = id and m.deleted_at is null
    )
  )
  with check (
    private.is_trip_member(id)
    or not exists (
      select 1 from public.trip_members m
      where m.trip_id = id and m.deleted_at is null
    )
  );

create policy trips_delete on public.trips
  for delete using (private.is_trip_member(id));

create policy trips_insert_own on public.trips
  for insert to authenticated with check (true);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.server_now() to authenticated;
grant execute on function public.join_trip_with_code(text, text) to authenticated;
grant execute on function public.upsert_own_trip(jsonb, text) to authenticated;
