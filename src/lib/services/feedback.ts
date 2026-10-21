/**
 * Compares the AI draft with what the user saved. Differences are stored as
 * feedback for evaluation (and optional future personalisation) — never as
 * verified nutritional ground truth.
 */
export interface AnalysisDraftItem {
  ref: string;
  displayName: string;
  weightGrams: number;
  foodRef: string | null;
}

export interface SavedItemSummary {
  ref: string | null;
  displayName: string;
  weightGrams: number;
  foodRef: string;
}

export interface FeedbackEntry {
  type: "renamed" | "reweighed" | "removed" | "added" | "rematched";
  original: unknown;
  corrected: unknown;
}

export function diffAnalysisFeedback(draft: AnalysisDraftItem[], saved: SavedItemSummary[]): FeedbackEntry[] {
  const out: FeedbackEntry[] = [];
  const savedByRef = new Map(saved.filter((s) => s.ref).map((s) => [s.ref!, s]));
  for (const d of draft) {
    const s = savedByRef.get(d.ref);
    if (!s) {
      out.push({ type: "removed", original: d, corrected: null });
      continue;
    }
    if (s.displayName !== d.displayName)
      out.push({ type: "renamed", original: { ref: d.ref, name: d.displayName }, corrected: { name: s.displayName } });
    if (d.foodRef !== s.foodRef)
      out.push({ type: "rematched", original: { ref: d.ref, foodRef: d.foodRef }, corrected: { foodRef: s.foodRef } });
    if (Math.abs(d.weightGrams - s.weightGrams) > 0.5) {
      out.push({
        type: "reweighed",
        original: { ref: d.ref, weightGrams: d.weightGrams },
        corrected: { weightGrams: s.weightGrams, ratio: Math.round((s.weightGrams / d.weightGrams) * 1000) / 1000 },
      });
    }
  }
  const draftRefs = new Set(draft.map((d) => d.ref));
  for (const s of saved) {
    if (!s.ref || !draftRefs.has(s.ref)) out.push({ type: "added", original: null, corrected: s });
  }
  return out;
}
