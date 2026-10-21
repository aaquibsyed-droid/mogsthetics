/**
 * Bundled reference foods: a curated subset of USDA FoodData Central SR Legacy
 * (public domain), built by scripts/build-reference-foods.ts. Works offline, so
 * manual logging never depends on an external API.
 */
import data from "@/data/usda-reference-foods.json";
import type { NutrientValues } from "@/lib/nutrition/nutrients";
import { phraseSimilarity } from "./text";
import type { Allergen, FoodKind, FoodRecord, FoodState } from "./types";

interface RawRef {
  id: string;
  fdcId: number;
  name: string;
  usdaDescription: string;
  aliases: string[];
  state: FoodState;
  kind: FoodKind;
  category: string;
  allergens: Allergen[];
  tags: string[];
  per100g: NutrientValues;
  portions: Array<{ label: string; grams: number }>;
}

export const REFERENCE_META = {
  source: data.source,
  license: data.license,
  citation: data.citation,
  generatedAt: data.generatedAt,
};

const RECORDS: FoodRecord[] = (data.foods as RawRef[]).map((f) => ({
  ref: { source: "usda_sr", id: String(f.fdcId) },
  name: f.name,
  description: f.usdaDescription,
  brand: null,
  per100g: f.per100g,
  portions: f.portions,
  state: f.state,
  kind: f.kind,
  category: f.category,
  allergens: f.allergens,
  allergensKnown: true,
  tags: f.tags,
  aliases: f.aliases,
  dataType: "analytical_or_calculated",
  provenance: {
    provider: "USDA FoodData Central (SR Legacy)",
    externalId: String(f.fdcId),
    retrievedAt: data.generatedAt,
    license: "Public domain (CC0 1.0)",
    url: `https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`,
  },
}));

const BY_ID = new Map(RECORDS.map((r) => [r.ref.id, r]));

export function allReferenceFoods(): readonly FoodRecord[] {
  return RECORDS;
}

export function getReferenceFood(fdcId: string): FoodRecord | null {
  return BY_ID.get(fdcId) ?? null;
}

export function referenceScore(query: string, r: FoodRecord): number {
  let best = phraseSimilarity(query, r.name);
  for (const a of r.aliases ?? []) best = Math.max(best, phraseSimilarity(query, a) * 0.98);
  if (r.description) best = Math.max(best, phraseSimilarity(query, r.description) * 0.85);
  return best;
}

export function searchReferenceFoods(query: string, limit = 20): Array<{ food: FoodRecord; score: number }> {
  if (!query.trim()) return [];
  return RECORDS.map((food) => ({ food, score: referenceScore(query, food) }))
    .filter((r) => r.score >= 0.3)
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .slice(0, limit);
}
