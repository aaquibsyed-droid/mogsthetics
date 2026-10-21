import { findCandidates } from "@/lib/analysis/pipeline";
import type { FoodService } from "@/lib/food-data/service";
import type { FoodRecord } from "@/lib/food-data/types";
import { scaleNutrients, type NutrientValues } from "@/lib/nutrition/nutrients";
import { estimateGrams, parseText, type GramBasis, type ParsedEntry } from "./parse";

export const MIN_MATCH_SCORE = 0.45;

export interface QuickLogItem {
  raw: string;
  parsed: ParsedEntry;
  food: FoodRecord | null;
  alternatives: FoodRecord[];
  grams: number;
  basis: GramBasis | null;
  note: string;
  confidence: "high" | "medium" | "low";
  nutrients: NutrientValues | null;
}

export async function resolveQuickLog(
  foods: FoodService,
  userId: string,
  text: string,
): Promise<{ items: QuickLogItem[]; warnings: string[] }> {
  const entries = parseText(text);
  const warnings = new Set<string>();
  const items: QuickLogItem[] = [];
  for (const entry of entries) {
    const found = await findCandidates(foods, userId, { canonicalName: entry.foodText, searchTerms: [] });
    found.warnings.forEach((w) => warnings.add(w));
    const best = found.ranked[0];
    const alternatives = found.ranked.slice(best && best.score >= MIN_MATCH_SCORE ? 1 : 0, 5).map((c) => c.food);
    if (!best || best.score < MIN_MATCH_SCORE) {
      items.push({
        raw: entry.raw,
        parsed: entry,
        food: null,
        alternatives,
        grams: 0,
        basis: null,
        note: `Couldn't confidently match “${entry.foodText}”. Pick a food below or search.`,
        confidence: "low",
        nutrients: null,
      });
      continue;
    }
    const est = estimateGrams(entry, best.food);
    items.push({
      raw: entry.raw,
      parsed: entry,
      food: best.food,
      alternatives,
      grams: est.grams,
      basis: est.basis,
      note: est.note,
      confidence: best.score >= 0.85 ? est.confidence : "low",
      nutrients: scaleNutrients(best.food.per100g, est.grams),
    });
  }
  return { items, warnings: [...warnings] };
}
