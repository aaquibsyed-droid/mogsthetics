/**
 * Open Food Facts adapter (packaged foods by barcode).
 * API guidelines: identify the app with a User-Agent, keep request rates low
 * (product reads ≤ 100/min), cache results. Data licence: ODbL — attribution
 * "Data from Open Food Facts" is shown wherever OFF values are displayed.
 * Values are manufacturer label data as transcribed by contributors.
 */
import { emptyNutrients, type NutrientValues } from "@/lib/nutrition/nutrients";
import { FoodProviderError, type Allergen, type FoodRecord } from "./types";

const BASE = "https://world.openfoodfacts.org/api/v2/product";
const FIELDS = "code,product_name,brands,nutriments,serving_size,serving_quantity,allergens_tags,categories_tags";

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  nutriments?: Record<string, number | string | undefined>;
  serving_size?: string;
  serving_quantity?: number | string;
  allergens_tags?: string[];
}

const ALLERGEN_MAP: Record<string, Allergen> = {
  "en:milk": "milk",
  "en:eggs": "egg",
  "en:fish": "fish",
  "en:crustaceans": "shellfish",
  "en:molluscs": "shellfish",
  "en:nuts": "tree_nuts",
  "en:peanuts": "peanuts",
  "en:gluten": "gluten",
  "en:soybeans": "soy",
  "en:sesame-seeds": "sesame",
};

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

export function offNutrients(n: OffProduct["nutriments"] = {}): NutrientValues {
  const out = emptyNutrients();
  out.caloriesKcal = num(n["energy-kcal_100g"]);
  if (out.caloriesKcal === null) {
    const kj = num(n["energy-kj_100g"]) ?? (n["energy_unit"] === "kJ" ? num(n["energy_100g"]) : null);
    if (kj !== null) out.caloriesKcal = kj / 4.184; // label kJ → kcal (1 kcal = 4.184 kJ)
  }
  out.proteinG = num(n["proteins_100g"]);
  out.carbohydratesG = num(n["carbohydrates_100g"]);
  out.totalFatG = num(n["fat_100g"]);
  out.saturatedFatG = num(n["saturated-fat_100g"]);
  out.fiberG = num(n["fiber_100g"]);
  out.sugarsG = num(n["sugars_100g"]);
  const sodiumG = num(n["sodium_100g"]);
  const saltG = num(n["salt_100g"]);
  out.sodiumMg = sodiumG !== null ? sodiumG * 1000 : saltG !== null ? (saltG / 2.5) * 1000 : null;
  return out;
}

export function offToRecord(p: OffProduct, barcode: string, retrievedAt: string): FoodRecord | null {
  const per100g = offNutrients(p.nutriments);
  if (per100g.caloriesKcal === null && per100g.proteinG === null) return null;
  const servingG = num(p.serving_quantity);
  const allergens = [...new Set((p.allergens_tags ?? []).map((t) => ALLERGEN_MAP[t]).filter(Boolean))] as Allergen[];
  return {
    ref: { source: "off", id: barcode },
    name: p.product_name?.trim() || `Product ${barcode}`,
    description: null,
    brand: p.brands?.split(",")[0]?.trim() || null,
    per100g,
    portions: servingG ? [{ label: p.serving_size || "1 serving", grams: servingG }] : [],
    state: "processed",
    kind: null,
    category: null,
    allergens,
    allergensKnown: Array.isArray(p.allergens_tags),
    tags: [],
    dataType: "label",
    provenance: {
      provider: "Open Food Facts",
      externalId: barcode,
      retrievedAt,
      license: "ODbL — Data from Open Food Facts",
      url: `https://world.openfoodfacts.org/product/${barcode}`,
    },
  };
}

export function isValidBarcode(code: string): boolean {
  return /^[0-9]{6,14}$/.test(code);
}

export async function fetchOffProduct(barcode: string, userAgent: string, timeoutMs = 8000): Promise<FoodRecord | null> {
  if (!isValidBarcode(barcode)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${barcode}?fields=${FIELDS}`, {
      headers: { "User-Agent": userAgent, accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (res.status === 429) throw new FoodProviderError("off", "Open Food Facts rate limit reached", true);
    if (!res.ok) throw new FoodProviderError("off", `Open Food Facts responded ${res.status}`, res.status >= 500);
    const body = (await res.json()) as { status?: number; product?: OffProduct };
    if (body.status !== 1 || !body.product) return null;
    return offToRecord(body.product, barcode, new Date().toISOString());
  } catch (err) {
    if (err instanceof FoodProviderError) throw err;
    throw new FoodProviderError("off", err instanceof Error ? err.message : "Open Food Facts request failed", true);
  } finally {
    clearTimeout(t);
  }
}

/** Text search across Open Food Facts (branded/packaged products worldwide). Search is limited to ~10 req/min — callers cache. */
export async function searchOffProducts(query: string, userAgent: string, limit = 15, timeoutMs = 8000): Promise<FoodRecord[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const params = new URLSearchParams({ search_terms: query, search_simple: "1", action: "process", json: "1", page_size: String(limit), fields: FIELDS });
    const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, {
      headers: { "User-Agent": userAgent, accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (res.status === 429) throw new FoodProviderError("off", "Open Food Facts rate limit reached", true);
    if (!res.ok) throw new FoodProviderError("off", `Open Food Facts responded ${res.status}`, res.status >= 500);
    const body = (await res.json()) as { products?: OffProduct[] };
    const now = new Date().toISOString();
    return (body.products ?? [])
      .filter((p) => p.code && p.product_name?.trim())
      .map((p) => offToRecord(p, p.code!, now))
      .filter((r): r is FoodRecord => r !== null);
  } catch (err) {
    if (err instanceof FoodProviderError) throw err;
    throw new FoodProviderError("off", err instanceof Error ? err.message : "Open Food Facts search failed", true);
  } finally {
    clearTimeout(t);
  }
}
