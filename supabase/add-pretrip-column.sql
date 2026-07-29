-- Pretrip flag on expenses (run against an existing Supabase project).
-- Handles both fresh installs and databases that already have is_preflight.
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
