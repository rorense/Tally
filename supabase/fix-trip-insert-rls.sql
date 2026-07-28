-- Fix: allow authenticated users to INSERT new trips.
-- The old FOR ALL member policy also covered INSERT, and a brand-new trip has
-- no members yet, so sync was rejected with RLS 42501 and left rows "waiting".
-- Run this once in the Supabase SQL editor, then tap Sync now in the app.

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

create policy trips_insert_own on public.trips
  for insert to authenticated with check (true);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.server_now() to authenticated;
grant execute on function public.join_trip_with_code(text, text) to authenticated;
