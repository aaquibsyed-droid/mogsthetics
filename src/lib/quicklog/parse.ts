/**
 * Plain-language food logging ("2 eggs, 1 slice toast with butter, 200g greek yogurt").
 * Deterministic: splits text into entries, reads quantities and units, then
 * converts to grams using the matched food's own serving sizes. No AI involved,
 * so it works offline and every assumption is reported.
 */
import type { FoodRecord, Portion } from "@/lib/food-data/types";

export interface ParsedEntry {
  raw: string;
  quantity: number;
  /** Normalised unit, or null for a bare count ("2 eggs"). */
  unit: Unit | null;
  foodText: string;
  quantityStated: boolean;
}

export type Unit =
  | "g"
  | "kg"
  | "oz"
  | "lb"
  | "ml"
  | "l"
  | "cup"
  | "tbsp"
  | "tsp"
  | "slice"
  | "piece"
  | "serving"
  | "small"
  | "medium"
  | "large"
  | "scoop"
  | "can"
  | "bottle"
  | "glass"
  | "handful";

const UNIT_ALIASES: Record<string, Unit> = {
  g: "g",
  gr: "g",
  gram: "g",
  grams: "g",
  gm: "g",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  l: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  cup: "cup",
  cups: "cup",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbs: "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  slice: "slice",
  slices: "slice",
  piece: "piece",
  pieces: "piece",
  pc: "piece",
  pcs: "piece",
  serving: "serving",
  servings: "serving",
  portion: "serving",
  portions: "serving",
  small: "small",
  medium: "medium",
  large: "large",
  big: "large",
  scoop: "scoop",
  scoops: "scoop",
  can: "can",
  cans: "can",
  bottle: "bottle",
  bottles: "bottle",
  glass: "glass",
  glasses: "glass",
  handful: "handful",
  handfuls: "handful",
};

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  half: 0.5,
  quarter: 0.25,
  couple: 2,
  few: 3,
  some: 1,
};

const UNICODE_FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

export const MAX_ENTRIES = 15;

/** Splits on newlines, commas, semicolons, "+", "&", " and ", " with ", " plus ". */
export function splitEntries(text: string): string[] {
  return text
    .replace(/[\u2028\u2029]/g, "\n")
    .split(/\n|,|;|\+|&|\band\b|\bwith\b|\bplus\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_ENTRIES);
}

function readNumber(token: string): number | null {
  if (token in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[token];
  const mixed = token.match(/^(\d+)([½¼¾⅓⅔⅛])$/);
  if (mixed) return Number(mixed[1]) + UNICODE_FRACTIONS[mixed[2]];
  const frac = token.match(/^(\d+)\/(\d+)$/);
  if (frac && Number(frac[2]) > 0) return Number(frac[1]) / Number(frac[2]);
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  const w = token.toLowerCase();
  return w in WORD_NUMBERS ? WORD_NUMBERS[w] : null;
}

export function parseEntry(raw: string): ParsedEntry {
  // "200g" / "1.5kg" / "8oz" → "200 g"
  let text = raw
    .toLowerCase()
    .replace(/(\d)([a-z]+)\b/g, (m, d, u) => (u in UNIT_ALIASES ? `${d} ${u}` : m))
    .replace(/\s+/g, " ")
    .trim();
  const tokens = text.split(" ");
  let quantity = 1;
  let quantityStated = false;
  let i = 0;

  const first = tokens[0] ? readNumber(tokens[0]) : null;
  if (first !== null) {
    quantity = first;
    quantityStated = tokens[0] !== "some";
    i = 1;
    // "1 1/2", "2 and a half" are rare; support "1 1/2"
    const second = tokens[1] ? readNumber(tokens[1]) : null;
    if (second !== null && second < 1 && /\//.test(tokens[1])) {
      quantity += second;
      i = 2;
    }
  }
  // "a couple of", "a few"
  if (tokens[i] === "couple" || tokens[i] === "few") {
    quantity = WORD_NUMBERS[tokens[i]];
    quantityStated = true;
    i++;
  }
  let unit: Unit | null = null;
  if (tokens[i] && tokens[i] in UNIT_ALIASES) {
    unit = UNIT_ALIASES[tokens[i]];
    i++;
  }
  if (tokens[i] === "of") i++;
  text = tokens.slice(i).join(" ").trim();
  // A trailing size word ("egg large") is treated as the unit.
  if (!unit) {
    const sizeMatch = text.match(/\b(small|medium|large|big)\b/);
    if (sizeMatch) {
      unit = UNIT_ALIASES[sizeMatch[1]];
      text = text.replace(sizeMatch[0], "").replace(/\s+/g, " ").trim();
    }
  }
  if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
  const measured = unit !== null && ["g", "kg", "oz", "lb", "ml", "l"].includes(unit);
  const cap = measured ? 5000 : 100; // counts/servings are capped harder than weights
  return { raw: raw.trim(), quantity: Math.min(quantity, cap), unit, foodText: text || raw.trim(), quantityStated };
}

export function parseText(text: string): ParsedEntry[] {
  return splitEntries(text.slice(0, 1000)).map(parseEntry);
}

export type GramBasis = "mass" | "volume_as_water" | "serving_size" | "count_serving" | "default_serving" | "assumed_100g";

const MASS_G: Partial<Record<Unit, number>> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
const VOLUME_ML: Partial<Record<Unit, number>> = { ml: 1, l: 1000, cup: 240, tbsp: 15, tsp: 5, glass: 250, can: 355, bottle: 500 };

/** Leading amount of a USDA portion label ("0.5 cup" → 0.5). */
function portionAmount(p: Portion): number {
  const m = p.label.match(/^(\d+(?:\.\d+)?)/);
  const n = m ? Number(m[1]) : 1;
  return n > 0 ? n : 1;
}

const UNIT_LABEL_PATTERNS: Partial<Record<Unit, RegExp>> = {
  cup: /\bcup/,
  tbsp: /\btbsp|tablespoon/,
  tsp: /\btsp|teaspoon/,
  slice: /\bslice/,
  piece: /\bpiece|\bunit|\bitem|\bfruit|\bpatty|\bfillet|\bbreast|\bthigh|\bdrumstick|\bwing/,
  small: /\bsmall/,
  medium: /\bmedium/,
  large: /\blarge/,
  serving: /\bserving/,
  scoop: /\bscoop/,
  can: /\bcan\b/,
};

function findPortion(food: FoodRecord, unit: Unit | null): Portion | null {
  const portions = food.portions ?? [];
  if (!portions.length) return null;
  if (unit && UNIT_LABEL_PATTERNS[unit]) {
    const hit = portions.find((p) => UNIT_LABEL_PATTERNS[unit]!.test(p.label.toLowerCase()));
    if (hit) return hit;
  }
  if (unit === null || unit === "piece") {
    // Count: prefer a per-item serving (medium, large, slice, unit) over volume measures.
    const countable = portions.filter((p) => !/cup|tbsp|tsp|oz|fl|ml|gram|\bg\b|package|container/.test(p.label.toLowerCase()));
    return (
      countable.find((p) => /medium/.test(p.label.toLowerCase())) ??
      countable.find((p) => /large/.test(p.label.toLowerCase())) ??
      countable[0] ??
      null
    );
  }
  return null;
}

export interface GramEstimate {
  grams: number;
  basis: GramBasis;
  note: string;
  confidence: "high" | "medium" | "low";
}

/** Converts a parsed amount into edible grams for a specific food, reporting the assumption used. */
export function estimateGrams(entry: ParsedEntry, food: FoodRecord): GramEstimate {
  const q = entry.quantity;
  const round = (g: number) => Math.max(1, Math.min(5000, Math.round(g)));
  if (entry.unit && MASS_G[entry.unit]) {
    return { grams: round(q * MASS_G[entry.unit]!), basis: "mass", note: "", confidence: "high" };
  }
  const portion = findPortion(food, entry.unit);
  if (portion) {
    const grams = round((q * portion.grams) / portionAmount(portion));
    return {
      grams,
      basis: entry.unit === null ? "count_serving" : "serving_size",
      note: `${q} × ${portion.label} (${Math.round(portion.grams)} g each, USDA serving size)`,
      confidence: entry.quantityStated ? "medium" : "low",
    };
  }
  if (entry.unit && VOLUME_ML[entry.unit]) {
    return {
      grams: round(q * VOLUME_ML[entry.unit]!),
      basis: "volume_as_water",
      note: `Converted ${q} ${entry.unit} at ~1 g per ml — check the amount for dense or airy foods.`,
      confidence: "low",
    };
  }
  const fallback = food.portions?.[0];
  if (fallback) {
    return {
      grams: round((q * fallback.grams) / portionAmount(fallback)),
      basis: "default_serving",
      note: `Assumed ${q} × ${fallback.label} (${Math.round(fallback.grams)} g). Adjust if different.`,
      confidence: "low",
    };
  }
  return {
    grams: round(q * 100),
    basis: "assumed_100g",
    note: "No serving size known — assumed 100 g per item. Please adjust.",
    confidence: "low",
  };
}
