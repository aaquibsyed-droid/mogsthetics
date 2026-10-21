import type { Queryable } from "@/lib/db/types";

/** Every user-owned table and the columns exported (RLS still applies). */
const EXPORT_QUERIES: Record<string, string> = {
  profile: `select * from public.profiles where user_id = $1::uuid`,
  goalHistory: `select * from public.nutrition_goal_history where user_id = $1::uuid order by effective_from`,
  energyEstimates: `select * from public.energy_estimates where user_id = $1::uuid order by calculated_at`,
  bodyMetrics: `select * from public.user_body_metrics where user_id = $1::uuid order by local_date`,
  meals: `select * from public.meals where user_id = $1::uuid order by local_date, logged_at`,
  mealItems: `select * from public.meal_items where user_id = $1::uuid order by created_at`,
  nutritionSnapshots: `select * from public.nutrition_snapshots where user_id = $1::uuid order by created_at`,
  foodAnalyses: `select id, meal_id, image_count, model_provider, model_version, prompt_version, is_mock, status, stage,
    quality, structured_result, uncertainty_metadata, user_context, usage, error_code, created_at, completed_at
    from public.food_analyses where user_id = $1::uuid order by created_at`,
  analysisFeedback: `select * from public.analysis_feedback where user_id = $1::uuid order by created_at`,
  userFoods: `select * from public.user_foods where user_id = $1::uuid order by created_at`,
  recipes: `select * from public.recipes where user_id = $1::uuid order by created_at`,
  recipeIngredients: `select * from public.recipe_ingredients where user_id = $1::uuid`,
  mealPlanningPreferences: `select * from public.meal_planning_preferences where user_id = $1::uuid`,
  adaptiveSuggestions: `select * from public.adaptive_suggestions where user_id = $1::uuid order by created_on`,
  coachMessages: `select id, role, content, is_mock, created_at from public.coach_messages where user_id = $1::uuid order by created_at`,
  aiUsageEvents: `select provider, model, operation, input_tokens, output_tokens, latency_ms, success, created_at
    from public.ai_usage_events where user_id = $1::uuid order by created_at`,
  subscription: `select plan, status, current_period_end from public.subscriptions where user_id = $1::uuid`,
  waterLogs: `select local_date, ml, logged_at from public.water_logs where user_id = $1::uuid order by logged_at`,
  trainingPlan: `select plan, settings, goal, source, updated_at from public.training_plans where user_id = $1::uuid`,
  dailyHealth: `select * from public.daily_health where user_id = $1::uuid order by local_date`,
  fasts: `select started_at, ended_at, goal_hours from public.fasts where user_id = $1::uuid order by started_at`,
  supplements: `select * from public.supplements where user_id = $1::uuid order by created_at`,
  supplementLogs: `select * from public.supplement_logs where user_id = $1::uuid order by local_date`,
  workoutLogs: `select local_date, focus, completed_at from public.workout_logs where user_id = $1::uuid order by local_date`,
};

export async function exportUserData(q: Queryable, userId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [key, sql] of Object.entries(EXPORT_QUERIES)) out[key] = await q.query(sql, [userId]);
  return out;
}

/** All storage object paths the user owns (for deletion before the account is removed). */
export async function userImagePaths(q: Queryable, userId: string): Promise<string[]> {
  const rows = await q.query<{ p: string }>(
    `select original_image_path as p from public.meals where user_id = $1::uuid and original_image_path is not null
     union select image_path as p from public.food_analyses where user_id = $1::uuid and image_path is not null`,
    [userId],
  );
  return rows.map((r) => r.p);
}

/** Deletes the auth user; every user-owned row cascades. System connection only. */
export async function deleteAuthUser(q: Queryable, userId: string): Promise<void> {
  await q.query(`delete from auth.users where id = $1::uuid`, [userId]);
}
