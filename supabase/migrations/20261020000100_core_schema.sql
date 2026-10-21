-- NutriLens AI — core schema
-- All user-owned tables reference auth.users(id) ON DELETE CASCADE so deleting
-- an account removes every row the user owns. Row Level Security is enabled in
-- the next migration.


-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Converts a JSON array of strings to text[] (lets drivers pass arrays as JSON text).
create or replace function public.jsonb_to_text_array(j jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(coalesce(j, '[]'::jsonb)) x
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per user). No birth date is stored: age is recorded with the
-- date it was given and advanced in application code.
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  age_years integer check (age_years between 13 and 110),
  age_recorded_on date,
  sex_parameter text check (sex_parameter in ('male', 'female', 'unspecified')),
  height_cm double precision check (height_cm between 120 and 250),
  preferred_units text not null default 'metric' check (preferred_units in ('metric', 'imperial')),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  activity_level text check (activity_level in ('sedentary', 'light', 'moderate', 'very', 'extra')),
  activity_evidence jsonb not null default '{}'::jsonb,
  goal_type text check (goal_type in ('lose', 'maintain', 'gain', 'muscle')),
  goal_pace text check (goal_pace in ('gentle', 'moderate', 'faster')),
  target_weight_kg double precision check (target_weight_kg between 30 and 350),
  dietary_pattern text not null default 'omnivore'
    check (dietary_pattern in ('omnivore', 'vegetarian', 'vegan', 'pescatarian')),
  allergies text[] not null default '{}',
  disliked_foods text[] not null default '{}',
  liked_foods text[] not null default '{}',
  meal_frequency integer check (meal_frequency between 1 and 8),
  sleep_hours double precision check (sleep_hours between 0 and 16),
  preferred_protein_g_per_kg double precision check (preferred_protein_g_per_kg between 0.8 and 2.4),
  fat_percent double precision check (fat_percent between 0.2 and 0.4),
  clinical_flags text[] not null default '{}',
  adaptive_enabled boolean not null default true,
  image_retention text not null default '30_days'
    check (image_retention in ('delete_after_analysis', '30_days', 'keep')),
  notification_prefs jsonb not null default '{"weeklySummary": false, "logReminders": false}'::jsonb,
  -- Current targets (denormalised for display; authoritative history is nutrition_goal_history)
  daily_calorie_goal integer check (daily_calorie_goal between 800 and 6000),
  protein_goal_g integer check (protein_goal_g between 0 and 500),
  carbohydrate_goal_g integer check (carbohydrate_goal_g between 0 and 1000),
  fat_goal_g integer check (fat_goal_g between 0 and 400),
  fiber_goal_g integer check (fiber_goal_g between 0 and 150),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Goal history: one row per target period. A day D uses the row where
-- effective_from <= D and (effective_until is null or D < effective_until).
-- ---------------------------------------------------------------------------
create table public.nutrition_goal_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  effective_from date not null,
  effective_until date,
  goal_type text not null check (goal_type in ('lose', 'maintain', 'gain', 'muscle')),
  goal_pace text check (goal_pace in ('gentle', 'moderate', 'faster')),
  target_weight_kg double precision check (target_weight_kg between 30 and 350),
  target_calories_kcal integer check (target_calories_kcal between 800 and 6000),
  target_protein_g integer check (target_protein_g between 0 and 500),
  target_carbohydrates_g integer check (target_carbohydrates_g between 0 and 1000),
  target_fat_g integer check (target_fat_g between 0 and 400),
  target_fiber_g integer check (target_fiber_g between 0 and 150),
  target_saturated_fat_max_g integer,
  target_sodium_max_mg integer,
  tracking_only boolean not null default false,
  calculation_method text not null check (calculation_method in ('equation', 'adaptive', 'manual', 'tracking_only')),
  activity_level text check (activity_level in ('sedentary', 'light', 'moderate', 'very', 'extra')),
  assumptions_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint goal_period_valid check (effective_until is null or effective_until >= effective_from)
);
create unique index nutrition_goal_history_one_open
  on public.nutrition_goal_history (user_id) where effective_until is null;
create index nutrition_goal_history_lookup
  on public.nutrition_goal_history (user_id, effective_from desc);

-- ---------------------------------------------------------------------------
-- Energy estimates (each calculation the user applied)
-- ---------------------------------------------------------------------------
create table public.energy_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  estimated_bmr_kcal integer,
  estimated_tdee_kcal integer,
  calorie_target_kcal integer,
  equation_name text not null,
  activity_multiplier double precision,
  source text not null default 'equation' check (source in ('equation', 'adaptive')),
  inputs jsonb not null default '{}'::jsonb,
  uncertainty_notes text,
  calculated_at timestamptz not null default now()
);
create index energy_estimates_user on public.energy_estimates (user_id, calculated_at desc);

-- ---------------------------------------------------------------------------
-- Body metrics
-- ---------------------------------------------------------------------------
create table public.user_body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  measured_at timestamptz not null,
  local_date date not null,
  weight_kg double precision check (weight_kg between 20 and 400),
  waist_cm double precision check (waist_cm between 30 and 300),
  hip_cm double precision check (hip_cm between 30 and 300),
  chest_cm double precision check (chest_cm between 30 and 300),
  source text not null default 'manual' check (source in ('manual', 'import')),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  constraint body_metric_has_value check (
    weight_kg is not null or waist_cm is not null or hip_cm is not null or chest_cm is not null
  )
);
create index user_body_metrics_user_date on public.user_body_metrics (user_id, local_date desc);

-- ---------------------------------------------------------------------------
-- Food analyses (AI pipeline runs)
-- ---------------------------------------------------------------------------
create table public.food_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meal_id uuid,
  image_path text,
  image_sha256 text,
  image_count integer not null default 1 check (image_count between 1 and 4),
  model_provider text not null,
  model_version text not null,
  prompt_version text not null,
  is_mock boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  stage text,
  quality jsonb not null default '{}'::jsonb,
  structured_result jsonb,
  uncertainty_metadata jsonb,
  user_context jsonb not null default '{}'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);
create index food_analyses_user_created on public.food_analyses (user_id, created_at desc);
create index food_analyses_dedupe on public.food_analyses (user_id, image_sha256, prompt_version, model_version)
  where status = 'completed';

-- ---------------------------------------------------------------------------
-- Meals, items and immutable nutrition snapshots
-- ---------------------------------------------------------------------------
create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'custom')),
  custom_label text check (char_length(custom_label) <= 40),
  logged_at timestamptz not null,
  local_date date not null,
  title text not null check (char_length(title) between 1 and 120),
  notes text check (char_length(notes) <= 1000),
  original_image_path text,
  image_expires_at timestamptz,
  source_type text not null check (source_type in ('photo', 'manual', 'barcode', 'suggestion', 'copy', 'quick_add')),
  analysis_status text not null default 'none' check (analysis_status in ('none', 'pending', 'completed', 'failed')),
  analysis_id uuid references public.food_analyses (id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index meals_user_date on public.meals (user_id, local_date desc, logged_at desc);
create trigger meals_updated_at before update on public.meals
  for each row execute function public.set_updated_at();

alter table public.food_analyses
  add constraint food_analyses_meal_fk foreign key (meal_id) references public.meals (id) on delete set null;

create table public.meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null default 0,
  canonical_food_name text not null check (char_length(canonical_food_name) between 1 and 200),
  display_name text not null check (char_length(display_name) between 1 and 200),
  quantity double precision check (quantity > 0),
  quantity_unit text check (char_length(quantity_unit) <= 60),
  weight_grams double precision not null check (weight_grams > 0 and weight_grams <= 5000),
  preparation_method text check (char_length(preparation_method) <= 80),
  nutrition_source text not null
    check (nutrition_source in ('usda_sr', 'usda_fdc', 'off', 'user_food', 'user_entered')),
  nutrition_source_id text not null,
  is_user_corrected boolean not null default false,
  analysis_item_ref text,
  confidence text check (confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meal_items_meal on public.meal_items (meal_id, position);
create index meal_items_user_source on public.meal_items (user_id, nutrition_source, nutrition_source_id);
create trigger meal_items_updated_at before update on public.meal_items
  for each row execute function public.set_updated_at();

create table public.nutrition_snapshots (
  id uuid primary key default gen_random_uuid(),
  meal_item_id uuid not null references public.meal_items (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  is_current boolean not null default true,
  weight_grams double precision not null check (weight_grams > 0),
  calories_kcal double precision,
  protein_g double precision,
  carbohydrates_g double precision,
  total_fat_g double precision,
  saturated_fat_g double precision,
  fiber_g double precision,
  sugars_g double precision,
  sodium_mg double precision,
  energy_source text not null check (energy_source in ('reported', 'derived_atwater', 'unknown')),
  per_100g jsonb not null,
  source_metadata jsonb not null default '{}'::jsonb,
  calculation_version text not null,
  created_at timestamptz not null default now()
);
create unique index nutrition_snapshots_one_current
  on public.nutrition_snapshots (meal_item_id) where is_current;
create index nutrition_snapshots_user on public.nutrition_snapshots (user_id);

-- Snapshots are immutable except for retiring them (is_current true → false).
create or replace function public.protect_nutrition_snapshot() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'is_current') is distinct from (to_jsonb(old) - 'is_current') then
    raise exception 'nutrition snapshots are immutable';
  end if;
  if new.is_current and not old.is_current then
    raise exception 'a retired snapshot cannot be made current again';
  end if;
  return new;
end;
$$;
create trigger nutrition_snapshots_immutable before update on public.nutrition_snapshots
  for each row execute function public.protect_nutrition_snapshot();

-- ---------------------------------------------------------------------------
-- Nutrition database cache (shared, written only by the server)
-- ---------------------------------------------------------------------------
create table public.food_database_cache (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('usda_fdc', 'off')),
  external_food_id text,
  normalized_query text,
  normalized_result jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint cache_key_present check (external_food_id is not null or normalized_query is not null)
);
create unique index food_database_cache_item on public.food_database_cache (provider, external_food_id)
  where external_food_id is not null;
create unique index food_database_cache_query on public.food_database_cache (provider, normalized_query)
  where normalized_query is not null;

-- ---------------------------------------------------------------------------
-- Reusable foods, recipes
-- ---------------------------------------------------------------------------
create table public.user_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  brand text check (char_length(brand) <= 120),
  barcode text check (barcode ~ '^[0-9]{6,14}$'),
  per_100g jsonb not null,
  serving_sizes jsonb not null default '[]'::jsonb,
  data_type text not null check (data_type in ('label', 'user_estimate', 'imported')),
  source text not null default 'manual' check (source in ('manual', 'off_import', 'recipe')),
  source_ref text,
  allergens text[] not null default '{}',
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_foods_user_name on public.user_foods (user_id, lower(name));
create index user_foods_user_used on public.user_foods (user_id, use_count desc);
create trigger user_foods_updated_at before update on public.user_foods
  for each row execute function public.set_updated_at();

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  servings double precision not null default 1 check (servings > 0 and servings <= 50),
  instructions jsonb not null default '[]'::jsonb,
  notes text,
  origin text not null default 'manual' check (origin in ('manual', 'suggestion')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_user on public.recipes (user_id, created_at desc);
create trigger recipes_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null default 0,
  display_name text not null,
  nutrition_source text not null check (nutrition_source in ('usda_sr', 'usda_fdc', 'off', 'user_food', 'user_entered')),
  nutrition_source_id text not null,
  grams double precision not null check (grams > 0 and grams <= 5000)
);
create index recipe_ingredients_recipe on public.recipe_ingredients (recipe_id, position);

create table public.meal_planning_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  max_prep_minutes integer check (max_prep_minutes between 5 and 240),
  budget text check (budget in ('low', 'medium', 'high')),
  cuisines text[] not null default '{}',
  available_ingredients text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Feedback, adaptive suggestions, coaching, usage, subscriptions
-- ---------------------------------------------------------------------------
create table public.analysis_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  analysis_id uuid references public.food_analyses (id) on delete cascade,
  meal_id uuid references public.meals (id) on delete set null,
  feedback_type text not null check (feedback_type in ('renamed', 'reweighed', 'removed', 'added', 'rematched', 'clarification')),
  original jsonb,
  corrected jsonb,
  created_at timestamptz not null default now()
);
create index analysis_feedback_analysis on public.analysis_feedback (analysis_id);
create index analysis_feedback_user on public.analysis_feedback (user_id, created_at desc);

create table public.adaptive_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_on date not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'postponed')),
  previous_target_kcal integer not null,
  suggested_target_kcal integer not null,
  reasons jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,
  postponed_until date,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index adaptive_suggestions_user on public.adaptive_suggestions (user_id, created_on desc);
create unique index adaptive_suggestions_one_pending on public.adaptive_suggestions (user_id) where status = 'pending';

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  grounding jsonb,
  is_mock boolean not null default false,
  created_at timestamptz not null default now()
);
create index coach_messages_user on public.coach_messages (user_id, created_at desc);

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  provider text not null,
  model text not null,
  operation text not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  estimated_cost_usd double precision,
  success boolean not null,
  error_code text,
  created_at timestamptz not null default now()
);
create index ai_usage_events_user on public.ai_usage_events (user_id, created_at desc);

create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'plus')),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled')),
  provider text,
  provider_customer_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table public.idempotency_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null,
  key text not null check (char_length(key) between 8 and 128),
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, scope, key)
);

create table public.rate_limit_counters (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);
create index rate_limit_counters_window on public.rate_limit_counters (window_start);
