-- NutriLens AI — water tracking.
alter table public.profiles
  add column if not exists water_goal_ml integer not null default 2000 check (water_goal_ml between 500 and 6000);

create table public.water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  ml integer not null check (ml between 1 and 3000),
  logged_at timestamptz not null default now()
);
create index water_logs_user_date on public.water_logs (user_id, local_date);

alter table public.water_logs enable row level security;
grant select, insert, delete on public.water_logs to authenticated;
create policy water_logs_owner on public.water_logs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
