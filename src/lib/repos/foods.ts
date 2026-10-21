import { json, type Queryable } from "@/lib/db/types";
import type { NutrientValues } from "@/lib/nutrition/nutrients";
import type { Allergen, FoodRecord } from "@/lib/food-data/types";
import type { UserFoodInput } from "@/lib/domain/schemas";

export interface UserFoodRow {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  per100g: NutrientValues;
  servingSizes: Array<{ label: string; grams: number }>;
  dataType: "label" | "user_estimate" | "imported";
  source: string;
  sourceRef: string | null;
  allergens: Allergen[];
  useCount: number;
  createdAt: string;
}

const SELECT = `select id, name, brand, barcode, per_100g as "per100g", serving_sizes as "servingSizes", data_type as "dataType",
  source, source_ref as "sourceRef", allergens, use_count as "useCount", created_at as "createdAt" from public.user_foods`;

export function userFoodToRecord(r: UserFoodRow): FoodRecord {
  return {
    ref: { source: "user_food", id: r.id },
    name: r.name,
    description: null,
    brand: r.brand,
    per100g: r.per100g,
    portions: r.servingSizes,
    state: null,
    kind: null,
    category: null,
    allergens: r.allergens,
    allergensKnown: r.dataType === "label",
    tags: [],
    dataType: r.dataType === "user_estimate" ? "user_estimate" : "label",
    provenance: {
      provider: r.source === "off_import" ? "Your foods (imported from Open Food Facts)" : "Your foods",
      externalId: r.id,
      retrievedAt: r.createdAt,
      license: r.source === "off_import" ? "ODbL — Data from Open Food Facts" : null,
      url: null,
    },
  };
}

export async function createUserFood(
  q: Queryable,
  userId: string,
  f: UserFoodInput & { source?: string; sourceRef?: string | null },
): Promise<UserFoodRow> {
  const rows = await q.query<{ id: string }>(
    `insert into public.user_foods (user_id, name, brand, barcode, per_100g, serving_sizes, data_type, source, source_ref, allergens)
     values ($1::uuid, $2::text, $3::text, $4::text, $5::text::jsonb, $6::text::jsonb, $7::text, $8::text, $9::text,
       public.jsonb_to_text_array($10::text::jsonb)) returning id`,
    [
      userId,
      f.name,
      f.brand ?? null,
      f.barcode ?? null,
      json(f.per100g),
      json(f.servingSizes ?? []),
      f.dataType,
      f.source ?? "manual",
      f.sourceRef ?? null,
      json(f.allergens ?? []),
    ],
  );
  return (await q.query<UserFoodRow>(`${SELECT} where id = $1::uuid`, [rows[0].id]))[0];
}

export async function getUserFood(q: Queryable, userId: string, id: string): Promise<UserFoodRow | null> {
  const rows = await q.query<UserFoodRow>(`${SELECT} where user_id = $1::uuid and id = $2::uuid`, [userId, id]);
  return rows[0] ?? null;
}

export async function getUserFoodByBarcode(q: Queryable, userId: string, barcode: string): Promise<UserFoodRow | null> {
  const rows = await q.query<UserFoodRow>(`${SELECT} where user_id = $1::uuid and barcode = $2::text order by created_at desc limit 1`, [
    userId,
    barcode,
  ]);
  return rows[0] ?? null;
}

export async function searchUserFoods(q: Queryable, userId: string, query: string, limit = 10): Promise<UserFoodRow[]> {
  const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return q.query<UserFoodRow>(
    `${SELECT} where user_id = $1::uuid and (name ilike $2::text or brand ilike $2::text or barcode = $3::text)
     order by use_count desc, name asc limit $4::int`,
    [userId, like, query.trim(), limit],
  );
}

export async function listUserFoods(q: Queryable, userId: string, limit = 100): Promise<UserFoodRow[]> {
  return q.query<UserFoodRow>(`${SELECT} where user_id = $1::uuid order by use_count desc, name asc limit $2::int`, [userId, limit]);
}

export async function deleteUserFood(q: Queryable, userId: string, id: string): Promise<boolean> {
  return (await q.query(`delete from public.user_foods where user_id = $1::uuid and id = $2::uuid returning id`, [userId, id])).length > 0;
}

export async function touchUserFood(q: Queryable, id: string): Promise<void> {
  await q.query(`update public.user_foods set use_count = use_count + 1, last_used_at = now() where id = $1::uuid`, [id]);
}

// ---------------------------------------------------------------------------
// Shared provider cache (system connection only).
// ---------------------------------------------------------------------------

export async function cacheGetItem(q: Queryable, provider: "usda_fdc" | "off", externalId: string): Promise<FoodRecord | null> {
  const rows = await q.query<{ r: FoodRecord }>(
    `select normalized_result as r from public.food_database_cache
     where provider = $1::text and external_food_id = $2::text and expires_at > now()`,
    [provider, externalId],
  );
  return rows[0]?.r ?? null;
}

export async function cachePutItem(
  q: Queryable,
  provider: "usda_fdc" | "off",
  externalId: string,
  record: FoodRecord | null,
  ttlDays: number,
): Promise<void> {
  await q.query(
    `insert into public.food_database_cache (provider, external_food_id, normalized_result, expires_at)
     values ($1::text, $2::text, $3::text::jsonb, now() + ($4::int * interval '1 day'))
     on conflict (provider, external_food_id) where external_food_id is not null
     do update set normalized_result = excluded.normalized_result, fetched_at = now(), expires_at = excluded.expires_at`,
    [provider, externalId, json(record ?? { notFound: true }), ttlDays],
  );
}

export async function cacheGetQuery(q: Queryable, provider: "usda_fdc" | "off", query: string): Promise<FoodRecord[] | null> {
  const rows = await q.query<{ r: FoodRecord[] }>(
    `select normalized_result as r from public.food_database_cache
     where provider = $1::text and normalized_query = $2::text and expires_at > now()`,
    [provider, query],
  );
  return rows[0]?.r ?? null;
}

export async function cachePutQuery(
  q: Queryable,
  provider: "usda_fdc" | "off",
  query: string,
  records: FoodRecord[],
  ttlDays: number,
): Promise<void> {
  await q.query(
    `insert into public.food_database_cache (provider, normalized_query, normalized_result, expires_at)
     values ($1::text, $2::text, $3::text::jsonb, now() + ($4::int * interval '1 day'))
     on conflict (provider, normalized_query) where normalized_query is not null
     do update set normalized_result = excluded.normalized_result, fetched_at = now(), expires_at = excluded.expires_at`,
    [provider, query, json(records), ttlDays],
  );
}

export async function purgeExpiredCache(q: Queryable): Promise<number> {
  return (await q.query(`delete from public.food_database_cache where expires_at < now() returning id`)).length;
}
