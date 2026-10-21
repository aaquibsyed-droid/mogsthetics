import { json, type Queryable } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------
export async function getIdempotentResponse<T>(q: Queryable, userId: string, scope: string, key: string): Promise<T | null> {
  const rows = await q.query<{ response: T }>(
    `select response from public.idempotency_keys where user_id = $1::uuid and scope = $2::text and key = $3::text`,
    [userId, scope, key],
  );
  return rows[0]?.response ?? null;
}

export async function saveIdempotentResponse(q: Queryable, userId: string, scope: string, key: string, response: unknown): Promise<void> {
  await q.query(
    `insert into public.idempotency_keys (user_id, scope, key, response) values ($1::uuid, $2::text, $3::text, $4::text::jsonb)
     on conflict (user_id, scope, key) do nothing`,
    [userId, scope, key, json(response)],
  );
}

// ---------------------------------------------------------------------------
// Adaptive suggestions
// ---------------------------------------------------------------------------
export interface AdaptiveSuggestionRow {
  id: string;
  createdOn: string;
  status: "pending" | "accepted" | "rejected" | "postponed";
  previousTargetKcal: number;
  suggestedTargetKcal: number;
  reasons: string[];
  data: Record<string, unknown>;
  postponedUntil: string | null;
  decidedAt: string | null;
}

const ADAPTIVE_SELECT = `select id, created_on::text as "createdOn", status, previous_target_kcal as "previousTargetKcal",
  suggested_target_kcal as "suggestedTargetKcal", reasons, data, postponed_until::text as "postponedUntil",
  decided_at as "decidedAt" from public.adaptive_suggestions`;

export async function latestAdaptiveSuggestion(q: Queryable, userId: string): Promise<AdaptiveSuggestionRow | null> {
  const rows = await q.query<AdaptiveSuggestionRow>(
    `${ADAPTIVE_SELECT} where user_id = $1::uuid order by created_on desc, created_at desc limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function listAdaptiveSuggestions(q: Queryable, userId: string, limit = 20): Promise<AdaptiveSuggestionRow[]> {
  return q.query<AdaptiveSuggestionRow>(
    `${ADAPTIVE_SELECT} where user_id = $1::uuid order by created_on desc, created_at desc limit $2::int`,
    [userId, limit],
  );
}

export async function getAdaptiveSuggestion(q: Queryable, userId: string, id: string): Promise<AdaptiveSuggestionRow | null> {
  const rows = await q.query<AdaptiveSuggestionRow>(`${ADAPTIVE_SELECT} where user_id = $1::uuid and id = $2::uuid`, [userId, id]);
  return rows[0] ?? null;
}

export async function insertAdaptiveSuggestion(
  q: Queryable,
  userId: string,
  s: { createdOn: string; previousTargetKcal: number; suggestedTargetKcal: number; reasons: string[]; data: Record<string, unknown> },
): Promise<string> {
  const rows = await q.query<{ id: string }>(
    `insert into public.adaptive_suggestions (user_id, created_on, previous_target_kcal, suggested_target_kcal, reasons, data)
     values ($1::uuid, $2::date, $3::int, $4::int, $5::text::jsonb, $6::text::jsonb) returning id`,
    [userId, s.createdOn, s.previousTargetKcal, s.suggestedTargetKcal, json(s.reasons), json(s.data)],
  );
  return rows[0].id;
}

export async function decideAdaptiveSuggestion(
  q: Queryable,
  id: string,
  status: "accepted" | "rejected" | "postponed",
  postponedUntil: string | null,
): Promise<void> {
  await q.query(
    `update public.adaptive_suggestions set status = $2::text, postponed_until = $3::date, decided_at = now() where id = $1::uuid`,
    [id, status, postponedUntil],
  );
}

// ---------------------------------------------------------------------------
// Coach conversation
// ---------------------------------------------------------------------------
export interface CoachMessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  grounding: unknown;
  isMock: boolean;
  createdAt: string;
}

export async function listCoachMessages(q: Queryable, userId: string, limit = 30): Promise<CoachMessageRow[]> {
  const rows = await q.query<CoachMessageRow>(
    `select id, role, content, grounding, is_mock as "isMock", created_at as "createdAt" from public.coach_messages
     where user_id = $1::uuid order by created_at desc limit $2::int`,
    [userId, limit],
  );
  return rows.reverse();
}

export async function insertCoachMessage(
  q: Queryable,
  userId: string,
  m: { role: "user" | "assistant"; content: string; grounding?: unknown; isMock?: boolean },
): Promise<CoachMessageRow> {
  const rows = await q.query<CoachMessageRow>(
    `insert into public.coach_messages (user_id, role, content, grounding, is_mock)
     values ($1::uuid, $2::text, $3::text, $4::text::jsonb, $5::boolean)
     returning id, role, content, grounding, is_mock as "isMock", created_at as "createdAt"`,
    [userId, m.role, m.content, m.grounding === undefined ? null : json(m.grounding), m.isMock ?? false],
  );
  return rows[0];
}

export async function clearCoachMessages(q: Queryable, userId: string): Promise<void> {
  await q.query(`delete from public.coach_messages where user_id = $1::uuid`, [userId]);
}

// ---------------------------------------------------------------------------
// Recipes (saved meal suggestions)
// ---------------------------------------------------------------------------
export interface RecipeRow {
  id: string;
  name: string;
  servings: number;
  instructions: string[];
  notes: string | null;
  origin: string;
  createdAt: string;
  ingredients: Array<{ displayName: string; nutritionSource: string; nutritionSourceId: string; grams: number }>;
}

export async function insertRecipe(
  q: Queryable,
  userId: string,
  r: {
    name: string;
    servings: number;
    instructions: string[];
    notes: string | null;
    origin: "manual" | "suggestion";
    ingredients: Array<{ displayName: string; nutritionSource: string; nutritionSourceId: string; grams: number }>;
  },
): Promise<string> {
  const rows = await q.query<{ id: string }>(
    `insert into public.recipes (user_id, name, servings, instructions, notes, origin)
     values ($1::uuid, $2::text, $3::double precision, $4::text::jsonb, $5::text, $6::text) returning id`,
    [userId, r.name, r.servings, json(r.instructions), r.notes, r.origin],
  );
  let pos = 0;
  for (const ing of r.ingredients) {
    await q.query(
      `insert into public.recipe_ingredients (recipe_id, user_id, position, display_name, nutrition_source, nutrition_source_id, grams)
       values ($1::uuid, $2::uuid, $3::int, $4::text, $5::text, $6::text, $7::double precision)`,
      [rows[0].id, userId, pos++, ing.displayName, ing.nutritionSource, ing.nutritionSourceId, ing.grams],
    );
  }
  return rows[0].id;
}

export async function listRecipes(q: Queryable, userId: string, limit = 50): Promise<RecipeRow[]> {
  return q.query<RecipeRow>(
    `select r.id, r.name, r.servings, r.instructions, r.notes, r.origin, r.created_at as "createdAt",
       coalesce((select json_agg(json_build_object('displayName', i.display_name, 'nutritionSource', i.nutrition_source,
         'nutritionSourceId', i.nutrition_source_id, 'grams', i.grams) order by i.position)
         from public.recipe_ingredients i where i.recipe_id = r.id), '[]'::json) as ingredients
     from public.recipes r where r.user_id = $1::uuid order by r.created_at desc limit $2::int`,
    [userId, limit],
  );
}

export async function deleteRecipe(q: Queryable, userId: string, id: string): Promise<boolean> {
  return (await q.query(`delete from public.recipes where user_id = $1::uuid and id = $2::uuid returning id`, [userId, id])).length > 0;
}

// ---------------------------------------------------------------------------
// Meal planning preferences
// ---------------------------------------------------------------------------
export async function upsertPlanningPreferences(
  q: Queryable,
  userId: string,
  p: { maxPrepMinutes: number | null; budget: string | null; availableIngredients: string[] },
): Promise<void> {
  await q.query(
    `insert into public.meal_planning_preferences (user_id, max_prep_minutes, budget, available_ingredients, updated_at)
     values ($1::uuid, $2::int, $3::text, public.jsonb_to_text_array($4::text::jsonb), now())
     on conflict (user_id) do update set max_prep_minutes = excluded.max_prep_minutes, budget = excluded.budget,
       available_ingredients = excluded.available_ingredients, updated_at = now()`,
    [userId, p.maxPrepMinutes, p.budget, json(p.availableIngredients)],
  );
}

export async function getPlanningPreferences(
  q: Queryable,
  userId: string,
): Promise<{ maxPrepMinutes: number | null; budget: string | null; availableIngredients: string[] } | null> {
  const rows = await q.query<{ maxPrepMinutes: number | null; budget: string | null; availableIngredients: string[] }>(
    `select max_prep_minutes as "maxPrepMinutes", budget, available_ingredients as "availableIngredients"
     from public.meal_planning_preferences where user_id = $1::uuid`,
    [userId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Subscriptions (read-only for users)
// ---------------------------------------------------------------------------
export async function getSubscription(q: Queryable, userId: string): Promise<{ plan: "free" | "plus"; status: string } | null> {
  const rows = await q.query<{ plan: "free" | "plus"; status: string }>(
    `select plan, status from public.subscriptions where user_id = $1::uuid`,
    [userId],
  );
  return rows[0] ?? null;
}
