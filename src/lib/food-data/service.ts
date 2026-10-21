import type { Database } from "@/lib/db/types";
import {
  cacheGetItem,
  cacheGetQuery,
  cachePutItem,
  cachePutQuery,
  getUserFood,
  getUserFoodByBarcode,
  searchUserFoods,
  userFoodToRecord,
} from "@/lib/repos/foods";
import { getReferenceFood, referenceScore, searchReferenceFoods } from "./reference";
import { normalizeQuery } from "./text";
import { FoodProviderError, type FoodRecord, type FoodRef } from "./types";
import type { UsdaClient } from "./usda";

export interface FoodServiceDeps {
  db: Database;
  usda: UsdaClient | null;
  offLookup: ((barcode: string) => Promise<FoodRecord | null>) | null;
  /** Open Food Facts text search (branded products); optional. */
  offSearch?: ((query: string) => Promise<FoodRecord[]>) | null;
}

export interface FoodSearchResult {
  results: Array<FoodRecord & { score: number }>;
  /** Providers that failed or were unavailable (results may be incomplete). */
  warnings: string[];
}

const USDA_QUERY_TTL_DAYS = 30;
const USDA_ITEM_TTL_DAYS = 90;
const OFF_TTL_DAYS = 7;

export function createFoodService(deps: FoodServiceDeps) {
  async function usdaSearchCached(query: string): Promise<FoodRecord[]> {
    if (!deps.usda) return [];
    const key = normalizeQuery(query);
    const cached = await deps.db.withSystem((q) => cacheGetQuery(q, "usda_fdc", key));
    if (cached) return cached;
    const results = await deps.usda.search(query, 10);
    await deps.db.withSystem((q) => cachePutQuery(q, "usda_fdc", key, results, USDA_QUERY_TTL_DAYS));
    return results;
  }

  async function offSearchCached(query: string): Promise<FoodRecord[]> {
    if (!deps.offSearch) return [];
    const key = normalizeQuery(query);
    const cached = await deps.db.withSystem((q) => cacheGetQuery(q, "off", key));
    if (cached) return cached;
    const results = await deps.offSearch(query);
    await deps.db.withSystem((q) => cachePutQuery(q, "off", key, results, OFF_TTL_DAYS));
    // Cache each product so picking one doesn't need a second request.
    await deps.db.withSystem(async (q) => {
      for (const r of results) await cachePutItem(q, "off", r.ref.id, r, OFF_TTL_DAYS);
    });
    return results;
  }

  async function search(
    userId: string,
    query: string,
    opts: { limit?: number; includeExternal?: boolean } = {},
  ): Promise<FoodSearchResult> {
    const limit = opts.limit ?? 20;
    const trimmed = query.trim().slice(0, 100);
    const warnings: string[] = [];
    if (!trimmed) return { results: [], warnings };

    const reference = searchReferenceFoods(trimmed, limit).map(({ food, score }) => ({ ...food, score }));
    const userFoods = (await deps.db.withUser(userId, (q) => searchUserFoods(q, userId, trimmed, 10))).map((r) => {
      const rec = userFoodToRecord(r);
      return { ...rec, score: Math.max(0.6, referenceScore(trimmed, rec)) + 0.05 };
    });

    // Every database is queried in parallel; one failing never blocks the others.
    let external: Array<FoodRecord & { score: number }> = [];
    if (opts.includeExternal !== false) {
      const [usda, off] = await Promise.allSettled([
        deps.usda ? usdaSearchCached(trimmed) : Promise.resolve([]),
        deps.offSearch ? offSearchCached(trimmed) : Promise.resolve([]),
      ]);
      if (usda.status === "fulfilled") external.push(...usda.value.map((r) => ({ ...r, score: referenceScore(trimmed, r) * 0.95 })));
      else
        warnings.push(
          usda.reason instanceof FoodProviderError && usda.reason.retryable
            ? "Some results may be missing — one of our food databases is busy. Try again in a moment."
            : "Some results may be missing — one of our food databases is busy. Try again in a moment.",
        );
      if (off.status === "fulfilled") external.push(...off.value.map((r) => ({ ...r, score: referenceScore(trimmed, r) * 0.9 })));
      else warnings.push("Branded products are loading slowly right now. Try again in a moment.");
      if (!deps.usda && !deps.offSearch) warnings.push("Showing our core food list.");
      external = external.filter((r) => r.score > 0.2);
    }

    const seen = new Set<string>();
    const merged = [...userFoods, ...reference, ...external]
      .sort((a, b) => b.score - a.score)
      .filter((r) => {
        const k = `${r.ref.source}:${r.ref.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, limit);
    return { results: merged, warnings };
  }

  /** Resolves a stored reference to a nutrition record; throws if it cannot be resolved. */
  async function get(userId: string, ref: FoodRef): Promise<FoodRecord | null> {
    switch (ref.source) {
      case "usda_sr":
        return getReferenceFood(ref.id);
      case "user_food": {
        const row = await deps.db.withUser(userId, (q) => getUserFood(q, userId, ref.id));
        return row ? userFoodToRecord(row) : null;
      }
      case "usda_fdc": {
        const cached = await deps.db.withSystem((q) => cacheGetItem(q, "usda_fdc", ref.id));
        if (cached) return "notFound" in cached ? null : cached;
        if (!deps.usda) throw new FoodProviderError("usda_fdc", "USDA FoodData Central is not configured", false);
        const rec = await deps.usda.get(ref.id);
        await deps.db.withSystem((q) => cachePutItem(q, "usda_fdc", ref.id, rec, USDA_ITEM_TTL_DAYS));
        return rec;
      }
      case "off": {
        const cached = await deps.db.withSystem((q) => cacheGetItem(q, "off", ref.id));
        if (cached) return "notFound" in cached ? null : cached;
        if (!deps.offLookup) throw new FoodProviderError("off", "Open Food Facts lookups are disabled", false);
        const rec = await deps.offLookup(ref.id);
        await deps.db.withSystem((q) => cachePutItem(q, "off", ref.id, rec, OFF_TTL_DAYS));
        return rec;
      }
      case "user_entered":
        return null;
    }
  }

  async function lookupBarcode(userId: string, barcode: string): Promise<{ food: FoodRecord | null; warnings: string[] }> {
    const own = await deps.db.withUser(userId, (q) => getUserFoodByBarcode(q, userId, barcode));
    if (own) return { food: userFoodToRecord(own), warnings: [] };
    try {
      return { food: await get(userId, { source: "off", id: barcode }), warnings: [] };
    } catch (err) {
      return {
        food: null,
        warnings: [err instanceof Error ? `${err.message}. You can enter the nutrition label manually.` : "Lookup failed."],
      };
    }
  }

  return { search, get, lookupBarcode };
}

export type FoodService = ReturnType<typeof createFoodService>;
