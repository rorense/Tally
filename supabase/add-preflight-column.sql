-- Preflight flag on expenses (run against an existing Supabase project).
alter table public.expenses add column if not exists is_preflight integer not null default 0;
