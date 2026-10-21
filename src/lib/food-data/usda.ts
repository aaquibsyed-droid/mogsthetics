/**
 * USDA FoodData Central API adapter (https://fdc.nal.usda.gov/api-guide).
 * Requires a free api.data.gov key. Default rate limit: 1,000 requests/hour per
 * key — responses are cached in food_database_cache. Data is public domain.
 */
import { emptyNutrients, type NutrientValues } from "@/lib/nutrition/nutrients";
import { FoodProviderError, type FoodRecord, type FoodState } from "./types";

const BASE = "https://api.nal.usda.gov/fdc/v1";

// nutrientNumber → field. Energy: 208 (kcal), else Atwater specific (958), else general (957).
const NUTRIENT_NUMBERS: Record<string, keyof NutrientValues> = {
  "203": "proteinG",
  "205": "carbohydratesG",
  "204": "totalFatG",
  "606": "saturatedFatG",
  "291": "fiberG",
  "269": "sugarsG",
  "307": "sodiumMg",
};

interface FdcNutrient {
  nutrientNumber?: string;
  unitName?: string;
  value?: number;
  amount?: number;
  nutrient?: { number?: string; unitName?: string };
}
interface FdcFood {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  foodCategory?: string | { description?: string };
  foodNutrients?: FdcNutrient[];
  foodPortions?: Array<{
    gramWeight?: number;
    modifier?: string;
    portionDescription?: string;
    amount?: number;
    measureUnit?: { name?: string };
  }>;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
}

export function parseFdcNutrients(list: FdcNutrient[] = []): NutrientValues {
  const out = emptyNutrients();
  let kcal208: number | null = null;
  let kcal958: number | null = null;
  let kcal957: number | null = null;
  for (const n of list) {
    const num = n.nutrientNumber ?? n.nutrient?.number;
    const unit = (n.unitName ?? n.nutrient?.unitName ?? "").toLowerCase();
    const val = typeof n.value === "number" ? n.value : typeof n.amount === "number" ? n.amount : null;
    if (!num || val === null) continue;
    if (num === "208" && unit === "kcal") kcal208 = val;
    else if (num === "958" && unit === "kcal") kcal958 = val;
    else if (num === "957" && unit === "kcal") kcal957 = val;
    else if (NUTRIENT_NUMBERS[num]) out[NUTRIENT_NUMBERS[num]] = val;
  }
  out.caloriesKcal = kcal208 ?? kcal958 ?? kcal957;
  return out;
}

function inferState(description: string): FoodState | null {
  const d = description.toLowerCase();
  if (/\braw\b|uncooked/.test(d)) return "raw";
  if (/cooked|boiled|roasted|baked|fried|grilled|broiled|steamed|braised|stewed|sauteed|toasted/.test(d)) return "cooked";
  return null;
}

export function fdcToRecord(f: FdcFood, retrievedAt: string): FoodRecord {
  const portions = (f.foodPortions ?? [])
    .filter((p) => (p.gramWeight ?? 0) > 0)
    .slice(0, 6)
    .map((p) => ({
      label:
        (
          p.portionDescription ||
          [p.amount, p.measureUnit?.name !== "undetermined" ? p.measureUnit?.name : "", p.modifier].filter(Boolean).join(" ")
        ).trim() || "portion",
      grams: Math.round((p.gramWeight ?? 0) * 10) / 10,
    }));
  if (!portions.length && f.servingSize && f.servingSizeUnit?.toLowerCase() === "g") {
    portions.push({ label: f.householdServingFullText || "1 serving", grams: f.servingSize });
  }
  const category = typeof f.foodCategory === "string" ? f.foodCategory : (f.foodCategory?.description ?? null);
  const branded = f.dataType === "Branded";
  return {
    ref: { source: "usda_fdc", id: String(f.fdcId) },
    name: f.description,
    description: f.description,
    brand: f.brandOwner ?? f.brandName ?? null,
    per100g: parseFdcNutrients(f.foodNutrients),
    portions,
    state: inferState(f.description),
    kind: f.dataType === "Survey (FNDDS)" ? "dish" : null,
    category,
    allergens: [],
    allergensKnown: false,
    tags: [],
    dataType: branded ? "label" : "analytical_or_calculated",
    provenance: {
      provider: `USDA FoodData Central (${f.dataType ?? "unknown"})`,
      externalId: String(f.fdcId),
      retrievedAt,
      license: "Public domain (CC0 1.0)",
      url: `https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`,
    },
  };
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" }, cache: "no-store" });
    if (res.status === 429) throw new FoodProviderError("usda_fdc", "USDA rate limit reached", true);
    if (res.status === 404) return null;
    if (!res.ok) throw new FoodProviderError("usda_fdc", `USDA responded ${res.status}`, res.status >= 500);
    return await res.json();
  } catch (err) {
    if (err instanceof FoodProviderError) throw err;
    throw new FoodProviderError("usda_fdc", err instanceof Error ? err.message : "USDA request failed", true);
  } finally {
    clearTimeout(t);
  }
}

export interface UsdaClient {
  search(query: string, pageSize?: number): Promise<FoodRecord[]>;
  get(fdcId: string): Promise<FoodRecord | null>;
}

export function createUsdaClient(apiKey: string, timeoutMs = 8000): UsdaClient {
  return {
    async search(query, pageSize = 10) {
      const params = new URLSearchParams({ api_key: apiKey, query, pageSize: String(Math.min(25, pageSize)) });
      // The GET endpoint expects one dataType parameter per type (comma-separated values are rejected).
      for (const t of ["Foundation", "SR Legacy", "Survey (FNDDS)"]) params.append("dataType", t);
      const body = (await fetchJson(`${BASE}/foods/search?${params}`, timeoutMs)) as { foods?: FdcFood[] } | null;
      const now = new Date().toISOString();
      return (body?.foods ?? [])
        .map((f) => fdcToRecord(f, now))
        .filter((r) => r.per100g.caloriesKcal !== null || r.per100g.proteinG !== null);
    },
    async get(fdcId) {
      if (!/^\d{1,10}$/.test(fdcId)) return null;
      const body = (await fetchJson(`${BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`, timeoutMs)) as FdcFood | null;
      return body ? fdcToRecord(body, new Date().toISOString()) : null;
    },
  };
}
