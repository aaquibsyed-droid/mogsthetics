import { kgToLb } from "@/lib/nutrition/units";

export type Units = "metric" | "imperial";

export function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtKcal(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${fmtNum(Math.round(n))}`;
}

export function fmtGrams(n: number | null | undefined, decimals = 0): string {
  return n === null || n === undefined ? "—" : `${fmtNum(n, decimals)} g`;
}

export function fmtWeight(kg: number | null | undefined, units: Units, decimals = 1): string {
  if (kg === null || kg === undefined) return "—";
  return units === "imperial" ? `${fmtNum(kgToLb(kg), decimals)} lb` : `${fmtNum(kg, decimals)} kg`;
}

export function fmtWeightDelta(kg: number | null | undefined, units: Units, decimals = 1): string {
  if (kg === null || kg === undefined) return "—";
  const v = units === "imperial" ? kgToLb(kg) : kg;
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmtNum(Math.abs(v), decimals)} ${units === "imperial" ? "lb" : "kg"}`;
}

export const MEAL_TYPE_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
  custom: "Other",
};

export function guessMealType(date = new Date()): "breakfast" | "lunch" | "dinner" | "snack" {
  const h = date.getHours();
  if (h < 10.5) return "breakfast";
  if (h < 14.5) return "lunch";
  if (h < 17) return "snack";
  if (h < 21.5) return "dinner";
  return "snack";
}

export function todayLocal(tz?: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
