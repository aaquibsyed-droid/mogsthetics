const STOP = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "with",
  "in",
  "on",
  "or",
  "style",
  "fresh",
  "plain",
  "regular",
  "piece",
  "pieces",
  "slice",
  "slices",
]);

export function normalizeQuery(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9%\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singular(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 3 && t.endsWith("oes")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokens(s: string): string[] {
  return normalizeQuery(s)
    .split(/[\s-]+/)
    .filter((t) => t && !STOP.has(t))
    .map(singular);
}

/** Similarity in [0, 1] between a query and a candidate phrase. */
export function phraseSimilarity(query: string, candidate: string): number {
  const q = tokens(query);
  const c = tokens(candidate);
  if (!q.length || !c.length) return 0;
  const cs = new Set(c);
  const qs = new Set(q);
  let hit = 0;
  for (const t of qs) if (cs.has(t)) hit += 1;
  if (hit === 0) {
    // prefix credit for partial words ("chick" → "chicken")
    for (const t of qs) if (t.length >= 3 && c.some((x) => x.startsWith(t))) hit += 0.5;
  }
  const recall = hit / qs.size;
  const precision = hit / cs.size;
  const exact = normalizeQuery(query) === normalizeQuery(candidate) ? 0.15 : 0;
  return Math.min(1, 0.7 * recall + 0.3 * precision + exact);
}
