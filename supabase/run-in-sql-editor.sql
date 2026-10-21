-- Ascend: training, recovery and daily habits. Safe to run more than once.

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
drop policy if exists training_plans_owner on public.training_plans;
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
drop policy if exists workout_logs_owner on public.workout_logs;
create policy workout_logs_owner on public.workout_logs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Daily health metrics (sleep, HRV, resting HR, steps) from devices or manual entry,
-- device connections (OAuth tokens, server-only) and Apple Health ingest tokens (server-only).
create table if not exists public.daily_health (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  sleep_minutes integer check (sleep_minutes between 0 and 1440),
  sleep_efficiency numeric check (sleep_efficiency between 0 and 100),
  bed_time text,
  wake_time text,
  hrv_ms numeric check (hrv_ms between 1 and 400),
  resting_hr numeric check (resting_hr between 20 and 200),
  steps integer check (steps between 0 and 200000),
  active_kcal integer check (active_kcal between 0 and 20000),
  device_recovery numeric check (device_recovery between 0 and 100),
  device_strain numeric check (device_strain between 0 and 21),
  source text not null default 'manual',
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table public.daily_health enable row level security;
grant select, insert, update, delete on public.daily_health to authenticated;
drop policy if exists daily_health_owner on public.daily_health;
create policy daily_health_owner on public.daily_health for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Server-only: no grants to authenticated, so tokens never reach the browser.
create table if not exists public.device_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('whoop', 'oura')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.device_connections enable row level security;

create table if not exists public.health_ingest_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token_hash text not null unique,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.health_ingest_tokens enable row level security;

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
drop policy if exists fasts_owner on public.fasts;
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
drop policy if exists supplements_owner on public.supplements;
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
drop policy if exists supplement_logs_owner on public.supplement_logs;
create policy supplement_logs_owner on public.supplement_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

