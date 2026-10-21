-- One-tap sleep (bedtime stored until "I'm awake"), fasting timer and daily supplement checklist.
alter table public.profiles add column if not exists sleep_started_at timestamptz;

create table if not exists public.fasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  goal_hours integer not null default 16 check (goal_hours between 8 and 72)
);
create index if not exists fasts_user_started on public.fasts (user_id, started_at desc);
create unique index if not exists fasts_one_active on public.fasts (user_id) where ended_at is null;
alter table public.fasts enable row level security;
grant select, insert, update, delete on public.fasts to authenticated;
create policy fasts_owner on public.fasts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  dose text not null default '' check (length(dose) <= 60),
  created_at timestamptz not null default now()
);
alter table public.supplements enable row level security;
grant select, insert, update, delete on public.supplements to authenticated;
create policy supplements_owner on public.supplements for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.supplement_logs (
  user_id uuid not null references auth.users (id) on delete cascade,
  supplement_id uuid not null references public.supplements (id) on delete cascade,
  local_date date not null,
  primary key (supplement_id, local_date)
);
alter table public.supplement_logs enable row level security;
grant select, insert, delete on public.supplement_logs to authenticated;
create policy supplement_logs_owner on public.supplement_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
