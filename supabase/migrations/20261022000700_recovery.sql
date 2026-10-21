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
