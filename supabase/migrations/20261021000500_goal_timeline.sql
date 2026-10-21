-- Weeks the user wants to reach their target weight in (drives the planned rate).
alter table public.profiles
  add column if not exists goal_weeks int check (goal_weeks is null or goal_weeks between 1 and 260);
