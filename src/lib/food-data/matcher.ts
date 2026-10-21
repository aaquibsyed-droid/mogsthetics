/**
 * Matches AI-detected food components to nutrition records.
 *
 * Score = text similarity of the canonical name / search terms against record
 * names and aliases, adjusted for preparation state:
 *   +0.15 when the record's state matches (cooked vs raw), −0.35 on a clear
 *   mismatch (e.g. "cooked rice" vs a raw-rice record) because cooked foods
 *   gain or lose water and per-100 g values differ several-fold.
 * Composite dishes: a whole-dish record is used only if it matches strongly;
 * its components are then shown for transparency but excluded from totals.
 * Otherwise the components are counted individually and the dish is not.
 */
import type { FoodRecord, FoodState } from "./types";
import { phraseSimilarity } from "./text";

export type MatchMethod = "alias_exact" | "text_similarity" | "user_selected" | "label_input" | "barcode";

export interface MatchQuery {
  canonicalName: string;
  searchTerms?: string[];
  state?: FoodState | "unknown" | null;
  preparation?: string | null;
}

export interface ScoredCandidate {
  food: FoodRecord;
  score: number;
  method: MatchMethod;
  stateAgreement: "match" | "mismatch" | "unknown";
}

const COOKED_WORDS = /cook|boil|roast|bake|fried|fry|grill|broil|steam|stew|braise|saute|toast|poach|scrambl/;

export function inferQueryState(q: MatchQuery): FoodState | null {
  if (q.state && q.state !== "unknown") return q.state;
  const text = `${q.canonicalName} ${q.preparation ?? ""}`.toLowerCase();
  if (/\braw\b|uncooked|fresh salad/.test(text)) return "raw";
  if (COOKED_WORDS.test(text)) return "cooked";
  return null;
}

function stateAgreement(queryState: FoodState | null, recordState: FoodState | null): ScoredCandidate["stateAgreement"] {
  if (!queryState || !recordState) return "unknown";
  const norm = (s: FoodState) => (s === "prepared" ? "cooked" : s);
  if (recordState === "processed") return "unknown";
  return norm(queryState) === norm(recordState) ? "match" : "mismatch";
}

export function scoreCandidate(q: MatchQuery, food: FoodRecord): ScoredCandidate {
  const phrases = [q.canonicalName, ...(q.searchTerms ?? [])].filter(Boolean);
  const names = [food.name, ...(food.aliases ?? []), ...(food.description ? [food.description] : [])];
  let best = 0;
  let aliasExact = false;
  for (const p of phrases) {
    for (const n of names) {
      const s = phraseSimilarity(p, n);
      if (s > best) best = s;
      if (p.trim().toLowerCase() === n.trim().toLowerCase()) aliasExact = true;
    }
  }
  const agreement = stateAgreement(inferQueryState(q), food.state);
  let score = best + (agreement === "match" ? 0.15 : agreement === "mismatch" ? -0.35 : 0);
  if (aliasExact) score += 0.1;
  score = Math.max(0, Math.min(1.25, score));
  return { food, score, method: aliasExact ? "alias_exact" : "text_similarity", stateAgreement: agreement };
}

export function rankCandidates(q: MatchQuery, foods: FoodRecord[], limit = 6): ScoredCandidate[] {
  const seen = new Set<string>();
  return foods
    .filter((f) => {
      const k = `${f.ref.source}:${f.ref.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((f) => scoreCandidate(q, f))
    .filter((c) => c.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Thresholds documented for review/eval. */
export const MATCH_THRESHOLDS = {
  /** Below this, the item is flagged "needs review" and the user must confirm. */
  confident: 0.7,
  /** A whole-dish record must reach this to replace component decomposition. */
  wholeDish: 0.8,
} as const;

export interface CompositeDecision<T> {
  strategy: "whole_dish" | "components";
  dish: ScoredCandidate | null;
  components: T[];
  reason: string;
}

/**
 * Decides whether a composite dish is represented by one prepared-dish record or
 * by its components, never both (prevents double counting).
 */
export function decideComposite<T>(dishMatch: ScoredCandidate | null, components: T[]): CompositeDecision<T> {
  const strongDish =
    dishMatch !== null &&
    dishMatch.score >= MATCH_THRESHOLDS.wholeDish &&
    (dishMatch.food.kind === "dish" || dishMatch.food.kind === null) &&
    dishMatch.stateAgreement !== "mismatch";
  if (strongDish && dishMatch) {
    return {
      strategy: "whole_dish",
      dish: dishMatch,
      components,
      reason: `Matched the whole dish to "${dishMatch.food.name}"; listed components are already included in that record and are not added again.`,
    };
  }
  if (components.length === 0 && dishMatch) {
    return { strategy: "whole_dish", dish: dishMatch, components, reason: "No components identified; using the closest dish record." };
  }
  return {
    strategy: "components",
    dish: null,
    components,
    reason: "No sufficiently close whole-dish record; nutrition is the sum of the identified components.",
  };
}
