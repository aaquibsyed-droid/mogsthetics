-- NutriLens AI — Row Level Security and privileges
--
-- Principles:
--  * RLS is enabled on every table in the public schema.
--  * `anon` has no table privileges at all.
--  * `authenticated` may only touch rows whose user_id = auth.uid(); child rows
--    must additionally reference a parent owned by the same user.
--  * System tables (cache, rate limits) are readable/writable only by the
--    server's privileged connection, which bypasses RLS as table owner.
--  * Subscriptions and usage events are read-only for users.

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'nutrition_goal_history', 'energy_estimates', 'user_body_metrics', 'food_analyses',
    'meals', 'meal_items', 'nutrition_snapshots', 'food_database_cache', 'user_foods', 'recipes',
    'recipe_ingredients', 'meal_planning_preferences', 'analysis_feedback', 'adaptive_suggestions',
    'coach_messages', 'ai_usage_events', 'subscriptions', 'idempotency_keys', 'rate_limit_counters'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Simple owner-scoped tables: full CRUD on own rows.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'nutrition_goal_history', 'energy_estimates', 'user_body_metrics', 'user_foods',
    'recipes', 'meal_planning_preferences', 'adaptive_suggestions', 'coach_messages', 'idempotency_keys'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t || '_owner', t
    );
  end loop;
end $$;

-- Meals: owner rows; a linked analysis must belong to the same user.
grant select, insert, update, delete on public.meals to authenticated;
create policy meals_owner on public.meals for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      analysis_id is null
      or exists (select 1 from public.food_analyses a where a.id = analysis_id and a.user_id = (select auth.uid()))
    )
  );

-- Food analyses: owner rows; a linked meal must belong to the same user.
grant select, insert, update, delete on public.food_analyses to authenticated;
create policy food_analyses_owner on public.food_analyses for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (meal_id is null or exists (select 1 from public.meals m where m.id = meal_id and m.user_id = (select auth.uid())))
  );

-- Meal items: must belong to a meal the user owns.
grant select, insert, update, delete on public.meal_items to authenticated;
create policy meal_items_owner on public.meal_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.meals m where m.id = meal_id and m.user_id = (select auth.uid()))
  );

-- Snapshots: insert and read only (immutability is enforced by trigger); the
-- only permitted update is retiring a snapshot. Deletion happens by cascade.
grant select, insert on public.nutrition_snapshots to authenticated;
grant update (is_current) on public.nutrition_snapshots to authenticated;
create policy nutrition_snapshots_select on public.nutrition_snapshots for select to authenticated
  using (user_id = (select auth.uid()));
create policy nutrition_snapshots_insert on public.nutrition_snapshots for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.meal_items i where i.id = meal_item_id and i.user_id = (select auth.uid()))
  );
create policy nutrition_snapshots_retire on public.nutrition_snapshots for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Recipe ingredients: must belong to a recipe the user owns.
grant select, insert, update, delete on public.recipe_ingredients to authenticated;
create policy recipe_ingredients_owner on public.recipe_ingredients for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = (select auth.uid()))
  );

-- Analysis feedback: insert/read own; must reference own analysis.
grant select, insert, delete on public.analysis_feedback to authenticated;
create policy analysis_feedback_owner on public.analysis_feedback for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (analysis_id is null or exists (select 1 from public.food_analyses a where a.id = analysis_id and a.user_id = (select auth.uid())))
  );

-- Read-only for users.
grant select on public.subscriptions to authenticated;
create policy subscriptions_read_own on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.ai_usage_events to authenticated;
create policy ai_usage_events_read_own on public.ai_usage_events for select to authenticated
  using (user_id = (select auth.uid()));

-- Shared nutrition cache: readable by signed-in users, written only by the server.
grant select on public.food_database_cache to authenticated;
create policy food_database_cache_read on public.food_database_cache for select to authenticated using (true);

-- rate_limit_counters: no grants, no policies → inaccessible to anon/authenticated.

grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.jsonb_to_text_array(jsonb) to authenticated;
grant execute on function public.protect_nutrition_snapshot() to authenticated;
