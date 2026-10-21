-- Saved training plan (one per user) and completed workouts.
create table if not exists public.training_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan jsonb not null,
  settings jsonb not null,
  goal text not null,
  source text not null,
  updated_at timestamptz not null default now()
);
alter table public.training_plans enable row level security;
grant select, insert, update, delete on public.training_plans to authenticated;
create policy training_plans_owner on public.training_plans for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.workout_logs (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  focus text not null default '',
  completed_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table public.workout_logs enable row level security;
grant select, insert, update, delete on public.workout_logs to authenticated;
create policy workout_logs_owner on public.workout_logs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
