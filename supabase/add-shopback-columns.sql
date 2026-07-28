-- ShopBack cashback columns on expenses (run against an existing Supabase project).
alter table public.expenses add column if not exists shopback_type text;
alter table public.expenses add column if not exists shopback_value numeric;
alter table public.expenses add column if not exists shopback_amount numeric;
alter table public.expenses add column if not exists shopback_amount_nzd numeric;
alter table public.expenses add column if not exists shopback_status text;
alter table public.expenses add column if not exists shopback_confirmed_at timestamptz;
