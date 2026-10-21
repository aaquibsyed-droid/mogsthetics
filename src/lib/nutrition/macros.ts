/**
 * Macronutrient targets (deterministic, configurable, documented).
 *
 * Rules (general guidance for healthy adults — not medical prescriptions):
 * - Protein: grams per kg of reference body weight, by goal.
 *     lose 1.6 g/kg · maintain 1.2 g/kg · gain 1.4 g/kg · muscle 1.8 g/kg
 *   Reference weight = actual weight, or the weight at BMI 25 when BMI > 30
 *   (avoids inflated targets at higher body weights).
 *   With kidney disease flagged, the default is 0.8 g/kg and the user is asked
 *   to confirm any target with their clinician.
 * - Fat: 30% of energy by default (allowed 20–40%).
 * - Carbohydrate: remaining energy.
 * - Fiber: 14 g per 1,000 kcal (Dietary Guidelines for Americans).
 * - Saturated fat: < 10% of energy. Added sugars: < 10% of energy. Sodium: < 2,300 mg.
 * Energy factors 4/4/9 kcal per g. Carbs absorb rounding so macros reproduce the
 * calorie target within ±2 kcal.
 */
import { bmi, weightAtBmi } from "./units";
import type { ClinicalFlag, GoalType } from "./energy";

export const MACRO_RULES_VERSION = "macro-rules@1.0.0";

export const PROTEIN_G_PER_KG: Record<GoalType, number> = { lose: 1.6, maintain: 1.2, gain: 1.4, muscle: 1.8 };
export const PROTEIN_G_PER_KG_RANGE = { min: 0.8, max: 2.4 } as const;
export const FAT_PERCENT = { default: 0.3, min: 0.2, max: 0.4 } as const;
export const FIBER_G_PER_1000_KCAL = 14;
export const SODIUM_MAX_MG = 2300;
export const MIN_CARB_G_RECOMMENDED = 130;

export interface MacroInput {
  targetKcal: number;
  weightKg: number;
  heightCm: number;
  goal: GoalType;
  clinicalFlags?: ClinicalFlag[];
  /** User-preferred protein, g per kg of reference weight. */
  preferredProteinGPerKg?: number | null;
  fatPercent?: number | null;
}

export interface MacroTargets {
  version: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydratesG: number;
  fatG: number;
  fiberG: number;
  saturatedFatMaxG: number;
  addedSugarsMaxG: number;
  sodiumMaxMg: number;
  proteinGPerKg: number;
  proteinReferenceWeightKg: number;
  fatPercent: number;
  energyFromMacrosKcal: number;
  notes: string[];
}

export function macroEnergy(proteinG: number, carbohydratesG: number, fatG: number): number {
  return proteinG * 4 + carbohydratesG * 4 + fatG * 9;
}

export function calculateMacroTargets(input: MacroInput): MacroTargets {
  if (!(input.targetKcal > 0)) throw new RangeError("Calorie target must be positive");
  const flags = new Set(input.clinicalFlags ?? []);
  const notes: string[] = [];

  const bodyMassIndex = bmi(input.weightKg, input.heightCm);
  const refWeight = bodyMassIndex > 30 ? weightAtBmi(25, input.heightCm) : input.weightKg;
  if (bodyMassIndex > 30) {
    notes.push(
      `Protein is based on a reference weight of ${refWeight.toFixed(1)} kg (BMI 25 for your height) rather than total body weight.`,
    );
  }

  let gPerKg = PROTEIN_G_PER_KG[input.goal];
  if (flags.has("kidney_disease")) {
    gPerKg = PROTEIN_G_PER_KG_RANGE.min;
    notes.push(
      "Because kidney disease was noted, protein defaults to 0.8 g/kg. Protein needs in kidney disease are individual — please confirm with your care team.",
    );
  }
  if (input.preferredProteinGPerKg != null) {
    const p = input.preferredProteinGPerKg;
    if (!(p >= PROTEIN_G_PER_KG_RANGE.min && p <= PROTEIN_G_PER_KG_RANGE.max)) {
      throw new RangeError(`Preferred protein must be between ${PROTEIN_G_PER_KG_RANGE.min} and ${PROTEIN_G_PER_KG_RANGE.max} g/kg`);
    }
    gPerKg = p;
    if (flags.has("kidney_disease") && p > PROTEIN_G_PER_KG_RANGE.min) {
      notes.push("You chose a protein target above 0.8 g/kg with kidney disease noted — please review it with your clinician.");
    }
  }

  let fatPct = input.fatPercent ?? FAT_PERCENT.default;
  if (!(fatPct >= FAT_PERCENT.min && fatPct <= FAT_PERCENT.max)) {
    throw new RangeError(`Fat share must be between ${FAT_PERCENT.min * 100}% and ${FAT_PERCENT.max * 100}%`);
  }

  const kcal = Math.round(input.targetKcal);
  let proteinG = Math.round(gPerKg * refWeight);
  let fatG = Math.round((kcal * fatPct) / 9);
  let carbKcal = kcal - proteinG * 4 - fatG * 9;

  // Keep carbohydrate at a sensible minimum by trimming fat toward its floor first.
  const minCarbKcal = MIN_CARB_G_RECOMMENDED * 4;
  if (carbKcal < minCarbKcal && fatPct > FAT_PERCENT.min) {
    const newFatPct = Math.max(FAT_PERCENT.min, (kcal - proteinG * 4 - minCarbKcal) / kcal);
    if (newFatPct < fatPct) {
      fatPct = newFatPct;
      fatG = Math.round((kcal * fatPct) / 9);
      carbKcal = kcal - proteinG * 4 - fatG * 9;
      notes.push(`Fat was reduced to ${Math.round(fatPct * 100)}% of calories to leave room for carbohydrate.`);
    }
  }
  if (carbKcal < 0) {
    // Protein alone would exceed the budget: scale protein to fit with fat at its floor.
    fatPct = FAT_PERCENT.min;
    fatG = Math.round((kcal * fatPct) / 9);
    proteinG = Math.max(0, Math.floor((kcal - fatG * 9) / 4));
    carbKcal = kcal - proteinG * 4 - fatG * 9;
    notes.push("Protein was reduced to fit within your calorie target.");
  }

  const carbohydratesG = Math.max(0, Math.round(carbKcal / 4));
  if (carbohydratesG < MIN_CARB_G_RECOMMENDED) {
    notes.push(
      `Carbohydrate is below ${MIN_CARB_G_RECOMMENDED} g/day, the general recommended minimum for adults. Consider adjusting protein or fat.`,
    );
  }

  return {
    version: MACRO_RULES_VERSION,
    caloriesKcal: kcal,
    proteinG,
    carbohydratesG,
    fatG,
    fiberG: Math.round((kcal / 1000) * FIBER_G_PER_1000_KCAL),
    saturatedFatMaxG: Math.round((kcal * 0.1) / 9),
    addedSugarsMaxG: Math.round((kcal * 0.1) / 4),
    sodiumMaxMg: SODIUM_MAX_MG,
    proteinGPerKg: Math.round((proteinG / refWeight) * 100) / 100,
    proteinReferenceWeightKg: Math.round(refWeight * 10) / 10,
    fatPercent: Math.round(fatPct * 1000) / 1000,
    energyFromMacrosKcal: macroEnergy(proteinG, carbohydratesG, fatG),
    notes,
  };
}

/** Validates user-edited macro targets against the calorie target. */
export function checkMacroConsistency(
  t: { caloriesKcal: number; proteinG: number; carbohydratesG: number; fatG: number },
  tolerance = 0.05,
): { ok: boolean; macroKcal: number; differenceKcal: number } {
  const macroKcal = macroEnergy(t.proteinG, t.carbohydratesG, t.fatG);
  const differenceKcal = macroKcal - t.caloriesKcal;
  return { ok: Math.abs(differenceKcal) <= Math.max(10, t.caloriesKcal * tolerance), macroKcal, differenceKcal };
}
