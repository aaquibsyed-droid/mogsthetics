import { json, type Queryable } from "@/lib/db/types";
import type { NutrientValues } from "@/lib/nutrition/nutrients";
import type { FoodSource } from "@/lib/food-data/types";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "custom";

export interface SnapshotWrite {
  weightGrams: number;
  nutrients: NutrientValues;
  energySource: "reported" | "derived_atwater" | "unknown";
  per100g: NutrientValues;
  sourceMetadata: Record<string, unknown>;
  calculationVersion: string;
}

export interface ItemWrite {
  position: number;
  canonicalName: string;
  displayName: string;
  quantity: number | null;
  quantityUnit: string | null;
  weightGrams: number;
  preparationMethod: string | null;
  nutritionSource: FoodSource;
  nutritionSourceId: string;
  isUserCorrected: boolean;
  analysisItemRef: string | null;
  confidence: "high" | "medium" | "low" | null;
  snapshot: SnapshotWrite;
}

export interface MealWrite {
  mealType: MealType;
  customLabel: string | null;
  loggedAt: string;
  localDate: string;
  title: string;
  notes: string | null;
  originalImagePath: string | null;
  imageExpiresAt: string | null;
  sourceType: "photo" | "manual" | "barcode" | "suggestion" | "copy" | "quick_add";
  analysisStatus: "none" | "pending" | "completed" | "failed";
  analysisId: string | null;
  idempotencyKey: string | null;
}

export interface MealItemView {
  id: string;
  position: number;
  canonicalName: string;
  displayName: string;
  quantity: number | null;
  quantityUnit: string | null;
  weightGrams: number;
  preparationMethod: string | null;
  nutritionSource: FoodSource;
  nutritionSourceId: string;
  isUserCorrected: boolean;
  analysisItemRef: string | null;
  confidence: "high" | "medium" | "low" | null;
  snapshot: {
    id: string;
    caloriesKcal: number | null;
    proteinG: number | null;
    carbohydratesG: number | null;
    totalFatG: number | null;
    saturatedFatG: number | null;
    fiberG: number | null;
    sugarsG: number | null;
    sodiumMg: number | null;
    energySource: string;
    per100g: NutrientValues;
    sourceMetadata: Record<string, unknown>;
    calculationVersion: string;
    createdAt: string;
  } | null;
}

export interface MealView {
  id: string;
  mealType: MealType;
  customLabel: string | null;
  loggedAt: string;
  localDate: string;
  title: string;
  notes: string | null;
  originalImagePath: string | null;
  imageExpiresAt: string | null;
  sourceType: MealWrite["sourceType"];
  analysisStatus: MealWrite["analysisStatus"];
  analysisId: string | null;
  createdAt: string;
  updatedAt: string;
  items: MealItemView[];
}

export async function insertMeal(q: Queryable, userId: string, m: MealWrite): Promise<string> {
  const rows = await q.query<{ id: string }>(
    `insert into public.meals (user_id, meal_type, custom_label, logged_at, local_date, title, notes,
       original_image_path, image_expires_at, source_type, analysis_status, analysis_id, idempotency_key)
     values ($1::uuid, $2::text, $3::text, $4::timestamptz, $5::date, $6::text, $7::text, $8::text, $9::timestamptz,
       $10::text, $11::text, $12::uuid, $13::text)
     returning id`,
    [
      userId,
      m.mealType,
      m.customLabel,
      m.loggedAt,
      m.localDate,
      m.title,
      m.notes,
      m.originalImagePath,
      m.imageExpiresAt,
      m.sourceType,
      m.analysisStatus,
      m.analysisId,
      m.idempotencyKey,
    ],
  );
  return rows[0].id;
}

export async function findMealByIdempotencyKey(q: Queryable, userId: string, key: string): Promise<string | null> {
  const rows = await q.query<{ id: string }>(`select id from public.meals where user_id = $1::uuid and idempotency_key = $2::text`, [
    userId,
    key,
  ]);
  return rows[0]?.id ?? null;
}

export async function insertSnapshot(q: Queryable, userId: string, itemId: string, s: SnapshotWrite): Promise<void> {
  await q.query(
    `insert into public.nutrition_snapshots (meal_item_id, user_id, is_current, weight_grams, calories_kcal, protein_g,
       carbohydrates_g, total_fat_g, saturated_fat_g, fiber_g, sugars_g, sodium_mg, energy_source, per_100g,
       source_metadata, calculation_version)
     values ($1::uuid, $2::uuid, true, $3::double precision, $4::double precision, $5::double precision,
       $6::double precision, $7::double precision, $8::double precision, $9::double precision, $10::double precision,
       $11::double precision, $12::text, $13::text::jsonb, $14::text::jsonb, $15::text)`,
    [
      itemId,
      userId,
      s.weightGrams,
      s.nutrients.caloriesKcal,
      s.nutrients.proteinG,
      s.nutrients.carbohydratesG,
      s.nutrients.totalFatG,
      s.nutrients.saturatedFatG,
      s.nutrients.fiberG,
      s.nutrients.sugarsG,
      s.nutrients.sodiumMg,
      s.energySource,
      json(s.per100g),
      json(s.sourceMetadata),
      s.calculationVersion,
    ],
  );
}

export async function insertItem(q: Queryable, userId: string, mealId: string, it: ItemWrite): Promise<string> {
  const rows = await q.query<{ id: string }>(
    `insert into public.meal_items (meal_id, user_id, position, canonical_food_name, display_name, quantity, quantity_unit,
       weight_grams, preparation_method, nutrition_source, nutrition_source_id, is_user_corrected, analysis_item_ref, confidence)
     values ($1::uuid, $2::uuid, $3::int, $4::text, $5::text, $6::double precision, $7::text, $8::double precision,
       $9::text, $10::text, $11::text, $12::boolean, $13::text, $14::text)
     returning id`,
    [
      mealId,
      userId,
      it.position,
      it.canonicalName,
      it.displayName,
      it.quantity,
      it.quantityUnit,
      it.weightGrams,
      it.preparationMethod,
      it.nutritionSource,
      it.nutritionSourceId,
      it.isUserCorrected,
      it.analysisItemRef,
      it.confidence,
    ],
  );
  await insertSnapshot(q, userId, rows[0].id, it.snapshot);
  return rows[0].id;
}

/** Updates an item; when nutrition-relevant fields change, retires the old snapshot and writes a new one. */
export async function updateItem(q: Queryable, userId: string, itemId: string, it: ItemWrite, newSnapshot: boolean): Promise<void> {
  await q.query(
    `update public.meal_items set position = $2::int, canonical_food_name = $3::text, display_name = $4::text,
       quantity = $5::double precision, quantity_unit = $6::text, weight_grams = $7::double precision,
       preparation_method = $8::text, nutrition_source = $9::text, nutrition_source_id = $10::text,
       is_user_corrected = $11::boolean
     where id = $1::uuid`,
    [
      itemId,
      it.position,
      it.canonicalName,
      it.displayName,
      it.quantity,
      it.quantityUnit,
      it.weightGrams,
      it.preparationMethod,
      it.nutritionSource,
      it.nutritionSourceId,
      it.isUserCorrected,
    ],
  );
  if (newSnapshot) {
    await q.query(`update public.nutrition_snapshots set is_current = false where meal_item_id = $1::uuid and is_current`, [itemId]);
    await insertSnapshot(q, userId, itemId, it.snapshot);
  }
}

export async function deleteItems(q: Queryable, mealId: string, itemIds: string[]): Promise<void> {
  if (!itemIds.length) return;
  await q.query(`delete from public.meal_items where meal_id = $1::uuid and id::text = any(public.jsonb_to_text_array($2::text::jsonb))`, [
    mealId,
    json(itemIds),
  ]);
}

export async function updateMealMeta(
  q: Queryable,
  mealId: string,
  m: Partial<Pick<MealWrite, "mealType" | "customLabel" | "title" | "notes" | "localDate" | "loggedAt">>,
): Promise<void> {
  await q.query(
    `update public.meals set
       meal_type = coalesce($2::text, meal_type),
       custom_label = case when $2::text is null then custom_label else $3::text end,
       title = coalesce($4::text, title),
       notes = case when $5::boolean then $6::text else notes end,
       local_date = coalesce($7::date, local_date),
       logged_at = coalesce($8::timestamptz, logged_at)
     where id = $1::uuid`,
    [
      mealId,
      m.mealType ?? null,
      m.customLabel ?? null,
      m.title ?? null,
      m.notes !== undefined,
      m.notes ?? null,
      m.localDate ?? null,
      m.loggedAt ?? null,
    ],
  );
}

const MEAL_SELECT = `
  select m.id, m.meal_type as "mealType", m.custom_label as "customLabel", m.logged_at as "loggedAt",
    m.local_date::text as "localDate", m.title, m.notes, m.original_image_path as "originalImagePath",
    m.image_expires_at as "imageExpiresAt", m.source_type as "sourceType", m.analysis_status as "analysisStatus",
    m.analysis_id as "analysisId", m.created_at as "createdAt", m.updated_at as "updatedAt",
    coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'position', i.position, 'canonicalName', i.canonical_food_name, 'displayName', i.display_name,
        'quantity', i.quantity, 'quantityUnit', i.quantity_unit, 'weightGrams', i.weight_grams,
        'preparationMethod', i.preparation_method, 'nutritionSource', i.nutrition_source,
        'nutritionSourceId', i.nutrition_source_id, 'isUserCorrected', i.is_user_corrected,
        'analysisItemRef', i.analysis_item_ref, 'confidence', i.confidence,
        'snapshot', (select json_build_object(
            'id', s.id, 'caloriesKcal', s.calories_kcal, 'proteinG', s.protein_g, 'carbohydratesG', s.carbohydrates_g,
            'totalFatG', s.total_fat_g, 'saturatedFatG', s.saturated_fat_g, 'fiberG', s.fiber_g, 'sugarsG', s.sugars_g,
            'sodiumMg', s.sodium_mg, 'energySource', s.energy_source, 'per100g', s.per_100g,
            'sourceMetadata', s.source_metadata, 'calculationVersion', s.calculation_version, 'createdAt', s.created_at)
          from public.nutrition_snapshots s where s.meal_item_id = i.id and s.is_current)
      ) order by i.position, i.created_at)
      from public.meal_items i where i.meal_id = m.id
    ), '[]'::json) as items
  from public.meals m`;

export async function getMeal(q: Queryable, userId: string, mealId: string): Promise<MealView | null> {
  const rows = await q.query<MealView>(`${MEAL_SELECT} where m.user_id = $1::uuid and m.id = $2::uuid`, [userId, mealId]);
  return rows[0] ?? null;
}

export async function listMeals(
  q: Queryable,
  userId: string,
  opts: {
    from: string;
    to: string;
    search?: string | null;
    limit?: number;
    before?: { localDate: string; loggedAt: string; id: string } | null;
  },
): Promise<MealView[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const params: unknown[] = [userId, opts.from, opts.to, limit];
  let where = `m.user_id = $1::uuid and m.local_date between $2::date and $3::date`;
  if (opts.search) {
    params.push(`%${opts.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}::text`;
    where += ` and (m.title ilike ${p} or exists (select 1 from public.meal_items si where si.meal_id = m.id and si.display_name ilike ${p}))`;
  }
  if (opts.before) {
    params.push(opts.before.localDate, opts.before.loggedAt, opts.before.id);
    const n = params.length;
    where += ` and (m.local_date, m.logged_at, m.id) < ($${n - 2}::date, $${n - 1}::timestamptz, $${n}::uuid)`;
  }
  return q.query<MealView>(`${MEAL_SELECT} where ${where} order by m.local_date desc, m.logged_at desc, m.id desc limit $4::int`, params);
}

export async function deleteMeal(q: Queryable, userId: string, mealId: string): Promise<{ imagePath: string | null } | null> {
  const rows = await q.query<{ imagePath: string | null }>(
    `delete from public.meals where user_id = $1::uuid and id = $2::uuid returning original_image_path as "imagePath"`,
    [userId, mealId],
  );
  return rows[0] ?? null;
}

export interface DailyTotalsRow {
  localDate: string;
  mealCount: number;
  itemCount: number;
  caloriesKcal: number | null;
  proteinG: number | null;
  carbohydratesG: number | null;
  totalFatG: number | null;
  saturatedFatG: number | null;
  fiberG: number | null;
  sugarsG: number | null;
  sodiumMg: number | null;
  missingCalories: number;
  missingFiber: number;
  missingSugars: number;
  missingSaturatedFat: number;
  missingSodium: number;
}

/** Per-day totals over current snapshots (single aggregate query). */
export async function dailyTotals(q: Queryable, userId: string, from: string, to: string): Promise<DailyTotalsRow[]> {
  return q.query<DailyTotalsRow>(
    `select m.local_date::text as "localDate", count(distinct m.id)::int as "mealCount", count(s.id)::int as "itemCount",
       sum(s.calories_kcal) as "caloriesKcal", sum(s.protein_g) as "proteinG", sum(s.carbohydrates_g) as "carbohydratesG",
       sum(s.total_fat_g) as "totalFatG", sum(s.saturated_fat_g) as "saturatedFatG", sum(s.fiber_g) as "fiberG",
       sum(s.sugars_g) as "sugarsG", sum(s.sodium_mg) as "sodiumMg",
       count(s.id) filter (where s.calories_kcal is null)::int as "missingCalories",
       count(s.id) filter (where s.fiber_g is null)::int as "missingFiber",
       count(s.id) filter (where s.sugars_g is null)::int as "missingSugars",
       count(s.id) filter (where s.saturated_fat_g is null)::int as "missingSaturatedFat",
       count(s.id) filter (where s.sodium_mg is null)::int as "missingSodium"
     from public.meals m
     left join public.meal_items i on i.meal_id = m.id
     left join public.nutrition_snapshots s on s.meal_item_id = i.id and s.is_current
     where m.user_id = $1::uuid and m.local_date between $2::date and $3::date
     group by m.local_date
     order by m.local_date`,
    [userId, from, to],
  );
}

export interface FrequentFood {
  nutritionSource: FoodSource;
  nutritionSourceId: string;
  displayName: string;
  timesLogged: number;
  typicalWeightGrams: number;
  lastLoggedAt: string;
}

export async function frequentFoods(q: Queryable, userId: string, limit = 12): Promise<FrequentFood[]> {
  return q.query<FrequentFood>(
    `select i.nutrition_source as "nutritionSource", i.nutrition_source_id as "nutritionSourceId",
       (array_agg(i.display_name order by i.created_at desc))[1] as "displayName",
       count(*)::int as "timesLogged",
       round(percentile_cont(0.5) within group (order by i.weight_grams)::numeric, 0)::double precision as "typicalWeightGrams",
       max(i.created_at) as "lastLoggedAt"
     from public.meal_items i
     where i.user_id = $1::uuid and i.nutrition_source <> 'user_entered'
     group by i.nutrition_source, i.nutrition_source_id
     order by count(*) desc, max(i.created_at) desc
     limit $2::int`,
    [userId, limit],
  );
}

export async function recentMealsWithImages(
  q: Queryable,
  userId: string,
  limit = 8,
): Promise<Array<{ id: string; title: string; localDate: string; imagePath: string }>> {
  return q.query(
    `select id, title, local_date::text as "localDate", original_image_path as "imagePath"
     from public.meals where user_id = $1::uuid and original_image_path is not null
     order by logged_at desc limit $2::int`,
    [userId, limit],
  );
}

export async function clearMealImage(q: Queryable, mealId: string): Promise<void> {
  await q.query(`update public.meals set original_image_path = null, image_expires_at = null where id = $1::uuid`, [mealId]);
}
