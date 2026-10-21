/**
 * Calorie-requirements engine (deterministic, unit tested).
 *
 * BMR: Mifflin–St Jeor (1990)
 *   male:   10·kg + 6.25·cm − 5·age + 5
 *   female: 10·kg + 6.25·cm − 5·age − 161
 * When the user prefers not to specify the sex parameter, both variants are
 * computed; the midpoint is used and the full range (≈166 kcal) is shown.
 *
 * TDEE = BMR × a single activity multiplier. Steps, occupation and workouts are
 * used only to *suggest* which multiplier fits; they are never added on top
 * (which would double-count activity).
 *
 * The equation was developed in healthy adults and predicts measured resting
 * metabolic rate within ±10% for roughly 70–80% of people; individual error can
 * be larger. All outputs are estimates.
 */
import { bmi } from "./units";

export const ENERGY_ENGINE_VERSION = "energy-engine@1.0.0";

export type SexParameter = "male" | "female" | "unspecified";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very" | "extra";
export type GoalType = "lose" | "maintain" | "gain" | "muscle";
export type Pace = "gentle" | "moderate" | "faster";
export type ClinicalFlag =
  | "pregnant"
  | "breastfeeding"
  | "kidney_disease"
  | "eating_disorder_history"
  | "diabetes_medication"
  | "other_medical"
  | "prefers_no_targets";

export const ACTIVITY_LEVELS: Record<ActivityLevel, { multiplier: number; label: string; description: string }> = {
  sedentary: { multiplier: 1.2, label: "Sedentary", description: "Mostly sitting, little intentional exercise" },
  light: { multiplier: 1.375, label: "Lightly active", description: "Light exercise 1–3 days/week or on your feet some of the day" },
  moderate: { multiplier: 1.55, label: "Moderately active", description: "Moderate exercise 3–5 days/week" },
  very: { multiplier: 1.725, label: "Very active", description: "Hard exercise 6–7 days/week or a physical job" },
  extra: { multiplier: 1.9, label: "Extra active", description: "Very hard training or physical job plus training" },
};

/** kcal per kg of body-mass change used for planning (a common approximation, not a constant of nature). */
export const KCAL_PER_KG = 7700;

/** Weekly loss as a fraction of body weight, by pace. */
export const LOSS_PACE_PCT: Record<Pace, number> = { gentle: 0.0025, moderate: 0.005, faster: 0.0075 };
/** Weekly gain in kg, by pace. */
export const GAIN_PACE_KG: Record<Pace, number> = { gentle: 0.1, moderate: 0.25, faster: 0.5 };

export const SAFETY = {
  /** Deficit never exceeds this share of estimated TDEE. */
  maxDeficitFraction: 0.25,
  /** Surplus never exceeds this share of estimated TDEE. */
  maxSurplusFraction: 0.2,
  /** Minimum daily target without clinical supervision (commonly cited general guidance). */
  minTargetKcal: { male: 1500, female: 1200, unspecified: 1350 } as Record<SexParameter, number>,
  /** BMI below which weight-loss targets are not offered. */
  minBmiForLoss: 18.5,
  /** BMI required before the faster loss pace is offered. */
  minBmiForFasterLoss: 25,
} as const;

export const LIMITS = {
  ageMin: 13,
  ageMax: 110,
  heightCmMin: 120,
  heightCmMax: 250,
  weightKgMin: 30,
  weightKgMax: 350,
} as const;

export interface EnergyInput {
  ageYears: number;
  sex: SexParameter;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: GoalType;
  pace?: Pace;
  targetWeightKg?: number | null;
  /** Weeks the user wants to reach the target weight in (optional). */
  targetWeeks?: number | null;
  clinicalFlags?: ClinicalFlag[];
}

export class EnergyInputError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "EnergyInputError";
  }
}

export function validateEnergyInput(input: EnergyInput): string[] {
  const issues: string[] = [];
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!num(input.ageYears) || !Number.isInteger(input.ageYears) || input.ageYears < LIMITS.ageMin || input.ageYears > LIMITS.ageMax)
    issues.push(`Age must be a whole number between ${LIMITS.ageMin} and ${LIMITS.ageMax}`);
  if (!num(input.heightCm) || input.heightCm < LIMITS.heightCmMin || input.heightCm > LIMITS.heightCmMax)
    issues.push(`Height must be between ${LIMITS.heightCmMin} and ${LIMITS.heightCmMax} cm`);
  if (!num(input.weightKg) || input.weightKg < LIMITS.weightKgMin || input.weightKg > LIMITS.weightKgMax)
    issues.push(`Weight must be between ${LIMITS.weightKgMin} and ${LIMITS.weightKgMax} kg`);
  if (!(input.activityLevel in ACTIVITY_LEVELS)) issues.push("Unknown activity level");
  if (!["male", "female", "unspecified"].includes(input.sex)) issues.push("Unknown sex parameter");
  if (!["lose", "maintain", "gain", "muscle"].includes(input.goal)) issues.push("Unknown goal");
  if (input.pace && !["gentle", "moderate", "faster"].includes(input.pace)) issues.push("Unknown pace");
  if (input.targetWeightKg !== undefined && input.targetWeightKg !== null) {
    if (!num(input.targetWeightKg) || input.targetWeightKg < LIMITS.weightKgMin || input.targetWeightKg > LIMITS.weightKgMax)
      issues.push(`Target weight must be between ${LIMITS.weightKgMin} and ${LIMITS.weightKgMax} kg`);
  }
  return issues;
}

export function mifflinStJeor(sex: "male" | "female", weightKg: number, heightCm: number, ageYears: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}

export interface BmrEstimate {
  bmrKcal: number;
  range: [number, number] | null;
  equation: "mifflin_st_jeor" | "mifflin_st_jeor_sex_averaged";
}

export function estimateBmr(input: Pick<EnergyInput, "sex" | "weightKg" | "heightCm" | "ageYears">): BmrEstimate {
  if (input.sex === "unspecified") {
    const f = mifflinStJeor("female", input.weightKg, input.heightCm, input.ageYears);
    const m = mifflinStJeor("male", input.weightKg, input.heightCm, input.ageYears);
    return { bmrKcal: (f + m) / 2, range: [f, m], equation: "mifflin_st_jeor_sex_averaged" };
  }
  return {
    bmrKcal: mifflinStJeor(input.sex, input.weightKg, input.heightCm, input.ageYears),
    range: null,
    equation: "mifflin_st_jeor",
  };
}

export interface ActivityEvidence {
  averageDailySteps?: number | null;
  occupationActivity?: "desk" | "standing" | "physical" | null;
  workoutsPerWeek?: number | null;
  workoutMinutes?: number | null;
}

/**
 * Suggests one activity level from optional evidence. Heuristic, documented,
 * and only a suggestion: the user's chosen level is what is used.
 */
export function suggestActivityLevel(e: ActivityEvidence): { level: ActivityLevel; rationale: string[] } | null {
  const hasAny = e.averageDailySteps != null || e.occupationActivity != null || e.workoutsPerWeek != null || e.workoutMinutes != null;
  if (!hasAny) return null;
  const rationale: string[] = [];
  let score = 0;
  if (e.averageDailySteps != null) {
    const s = e.averageDailySteps;
    const pts = s < 5000 ? 0 : s < 7500 ? 0.5 : s < 10000 ? 1 : s < 12500 ? 1.5 : 2;
    score += pts;
    rationale.push(`~${Math.round(s).toLocaleString("en-US")} steps/day`);
  }
  if (e.occupationActivity) {
    score += { desk: 0, standing: 0.5, physical: 1.5 }[e.occupationActivity];
    rationale.push(`${e.occupationActivity} work`);
  }
  if (e.workoutsPerWeek != null) {
    const minutes = (e.workoutsPerWeek ?? 0) * (e.workoutMinutes ?? 45);
    const pts = minutes < 60 ? 0 : minutes < 150 ? 0.5 : minutes < 300 ? 1 : minutes < 450 ? 1.5 : 2;
    score += pts;
    rationale.push(`~${minutes} workout minutes/week`);
  }
  const levels: ActivityLevel[] = ["sedentary", "light", "moderate", "very", "extra"];
  const idx = Math.max(0, Math.min(4, Math.round(score)));
  return { level: levels[idx], rationale };
}

export interface EnergyPlan {
  version: string;
  status: "standard" | "tracking_only";
  /** When status is tracking_only, why standard targets are not provided. */
  trackingOnlyReasons: string[];
  equation: BmrEstimate["equation"];
  bmrKcal: number | null;
  bmrRange: [number, number] | null;
  activityLevel: ActivityLevel;
  activityMultiplier: number;
  tdeeKcal: number | null;
  tdeeRange: [number, number] | null;
  requestedGoal: GoalType;
  goal: GoalType;
  pace: Pace | null;
  plannedRateKgPerWeek: number | null;
  /** Plan built from the user's chosen timeline, when target weight and weeks are given. */
  timeline: GoalTimeline | null;
  /** Negative = deficit, positive = surplus. */
  dailyAdjustmentKcal: number | null;
  targetKcal: number | null;
  bmi: number;
  adjustments: string[];
  assumptions: string[];
  limitations: string[];
  warnings: string[];
}

export interface GoalTimeline {
  requestedWeeks: number;
  /** Weeks needed at the planned (safe) rate; null if the plan can't move toward the target. */
  plannedWeeks: number | null;
  requestedRateKgPerWeek: number;
  /** True when the requested pace was faster than the safe maximum, so the plan is slower. */
  slowedForSafety: boolean;
  startWeightKg: number;
  targetWeightKg: number;
  milestones: Array<{ week: number; weightKg: number }>;
}

/** Fastest rate the planner will use (kg/week). */
export function maxSafeRateKgPerWeek(goal: GoalType, weightKg: number, bmiValue: number): number {
  if (goal === "lose") return weightKg * (bmiValue >= SAFETY.minBmiForFasterLoss ? LOSS_PACE_PCT.faster : LOSS_PACE_PCT.moderate);
  if (goal === "muscle") return GAIN_PACE_KG.moderate;
  if (goal === "gain") return GAIN_PACE_KG.faster;
  return 0;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

export function planEnergy(input: EnergyInput): EnergyPlan {
  const issues = validateEnergyInput(input);
  if (issues.length) throw new EnergyInputError(issues);

  const flags = new Set(input.clinicalFlags ?? []);
  const bodyMassIndex = bmi(input.weightKg, input.heightCm);
  const activity = ACTIVITY_LEVELS[input.activityLevel];
  const adjustments: string[] = [];
  const warnings: string[] = [];
  const assumptions: string[] = [
    `Basal metabolic rate estimated with the Mifflin–St Jeor equation from age, height and weight.`,
    `Daily energy expenditure = BMR × ${activity.multiplier} (${activity.label.toLowerCase()}). Activity is counted once; steps and workouts only inform which level fits.`,
    `Planning uses about ${KCAL_PER_KG.toLocaleString("en-US")} kcal per kg of body-weight change.`,
  ];
  const limitations: string[] = [
    "This is an estimate, not a measurement. Real energy needs commonly differ from equation estimates by 10% or more.",
    "Weight changes include water, glycogen and gut content, so day-to-day scale changes are not a direct readout of fat change.",
    "Use your logged intake and weight trend over several weeks to refine the target.",
  ];

  const trackingOnlyReasons: string[] = [];
  if (input.ageYears < 18)
    trackingOnlyReasons.push(
      "Calorie targets for people under 18 need to support growth and should come from a pediatrician or registered dietitian.",
    );
  if (flags.has("pregnant"))
    trackingOnlyReasons.push("Energy needs during pregnancy change by trimester and should be set with your midwife, doctor or dietitian.");
  if (flags.has("breastfeeding"))
    trackingOnlyReasons.push(
      "Breastfeeding raises energy needs in ways that vary a lot between people; a clinician or dietitian can help set a target.",
    );
  if (flags.has("prefers_no_targets"))
    trackingOnlyReasons.push("You chose not to see calorie targets. You can still log meals and see what you ate.");
  if (flags.has("eating_disorder_history"))
    trackingOnlyReasons.push(
      "Because you mentioned a history of disordered eating, Mogsthetics won't set calorie targets. Logging can still be used with a care team's guidance, or not at all.",
    );

  const bmrEst = estimateBmr(input);

  if (trackingOnlyReasons.length) {
    return {
      version: ENERGY_ENGINE_VERSION,
      status: "tracking_only",
      trackingOnlyReasons,
      equation: bmrEst.equation,
      bmrKcal: null,
      bmrRange: null,
      activityLevel: input.activityLevel,
      activityMultiplier: activity.multiplier,
      tdeeKcal: null,
      tdeeRange: null,
      requestedGoal: input.goal,
      goal: "maintain",
      pace: null,
      plannedRateKgPerWeek: null,
      timeline: null,
      dailyAdjustmentKcal: null,
      targetKcal: null,
      bmi: bodyMassIndex,
      adjustments,
      assumptions: [],
      limitations,
      warnings,
    };
  }

  if (input.sex === "unspecified") {
    assumptions.push(
      "You chose not to specify the sex parameter, so Mogsthetics averages the two Mifflin–St Jeor variants. This adds about ±83 kcal/day of extra uncertainty to the estimate.",
    );
  }
  if (input.ageYears > 80) limitations.push("The equation was validated mostly in adults under 80; estimates may be less accurate.");
  if (bodyMassIndex >= 40)
    limitations.push("Prediction equations are less accurate at higher body weights; consider professional guidance.");
  if (flags.has("diabetes_medication") || flags.has("kidney_disease") || flags.has("other_medical"))
    warnings.push(
      "You noted a medical condition. Calorie and protein targets here are general and may not suit your situation — please check them with your clinician.",
    );

  const tdee = bmrEst.bmrKcal * activity.multiplier;
  const tdeeRange: [number, number] | null = bmrEst.range
    ? [bmrEst.range[0] * activity.multiplier, bmrEst.range[1] * activity.multiplier]
    : null;

  let goal = input.goal;
  let pace: Pace | null = goal === "maintain" ? null : (input.pace ?? "moderate");

  if (goal === "lose" && bodyMassIndex < SAFETY.minBmiForLoss) {
    adjustments.push(
      `Weight loss isn't offered at a BMI below ${SAFETY.minBmiForLoss} (yours is about ${bodyMassIndex.toFixed(1)}). Showing a maintenance estimate instead — a clinician can advise if you have specific reasons.`,
    );
    goal = "maintain";
    pace = null;
  }
  if (goal === "lose" && pace === "faster" && bodyMassIndex < SAFETY.minBmiForFasterLoss) {
    adjustments.push(`The faster pace is offered only at a BMI of ${SAFETY.minBmiForFasterLoss} or above, so the moderate pace is used.`);
    pace = "moderate";
  }
  if (goal === "muscle" && pace === "faster") {
    adjustments.push("For muscle gain a larger surplus mostly adds fat rather than muscle, so the moderate pace is used.");
    pace = "moderate";
  }
  if (goal === "lose" && input.targetWeightKg != null && bmi(input.targetWeightKg, input.heightCm) < SAFETY.minBmiForLoss) {
    warnings.push(
      `Your target weight corresponds to a BMI below ${SAFETY.minBmiForLoss}. Mogsthetics won't plan toward it; consider discussing goals with a professional.`,
    );
  }
  if (goal === "lose" && input.targetWeightKg != null && input.targetWeightKg >= input.weightKg) {
    warnings.push("Your target weight isn't below your current weight. Consider the maintain or gain goal.");
  }
  if ((goal === "gain" || goal === "muscle") && input.targetWeightKg != null && input.targetWeightKg <= input.weightKg) {
    warnings.push("Your target weight isn't above your current weight. Consider the maintain or lose goal.");
  }

  // A chosen timeline sets the rate directly (capped at the safe maximum); otherwise the pace does.
  let timelineRate: number | null = null;
  let requestedRate: number | null = null;
  const diffKg = input.targetWeightKg != null ? input.targetWeightKg - input.weightKg : null;
  const towardTarget =
    diffKg !== null && ((goal === "lose" && diffKg < -0.1) || ((goal === "gain" || goal === "muscle") && diffKg > 0.1));
  if (input.targetWeeks && input.targetWeeks > 0 && towardTarget && goal !== "maintain") {
    requestedRate = Math.abs(diffKg!) / input.targetWeeks;
    const max = maxSafeRateKgPerWeek(goal, input.weightKg, bodyMassIndex);
    timelineRate = Math.min(requestedRate, max);
    if (requestedRate > max) {
      adjustments.push(
        `Reaching your target in ${input.targetWeeks} weeks would need about ${requestedRate.toFixed(2)} kg/week. Mogsthetics plans at most ${max.toFixed(2)} kg/week for you, so the timeline is longer.`,
      );
    }
    pace = null;
  }

  let rateKgPerWeek: number | null = null;
  let adjustment = 0;
  if (goal === "lose" && (pace || timelineRate !== null)) {
    rateKgPerWeek = timelineRate ?? input.weightKg * LOSS_PACE_PCT[pace!];
    adjustment = -(rateKgPerWeek * KCAL_PER_KG) / 7;
    const maxDeficit = tdee * SAFETY.maxDeficitFraction;
    if (-adjustment > maxDeficit) {
      adjustment = -maxDeficit;
      rateKgPerWeek = (maxDeficit * 7) / KCAL_PER_KG;
      adjustments.push(`The deficit was limited to ${Math.round(SAFETY.maxDeficitFraction * 100)}% of your estimated expenditure.`);
    }
  } else if ((goal === "gain" || goal === "muscle") && (pace || timelineRate !== null)) {
    rateKgPerWeek = timelineRate ?? GAIN_PACE_KG[pace!];
    adjustment = (rateKgPerWeek * KCAL_PER_KG) / 7;
    const maxSurplus = tdee * SAFETY.maxSurplusFraction;
    if (adjustment > maxSurplus) {
      adjustment = maxSurplus;
      rateKgPerWeek = (maxSurplus * 7) / KCAL_PER_KG;
      adjustments.push(`The surplus was limited to ${Math.round(SAFETY.maxSurplusFraction * 100)}% of your estimated expenditure.`);
    }
    if (goal === "muscle") {
      assumptions.push(
        "A modest surplus supports muscle gain only alongside progressive resistance training and enough protein; extra calories alone don't build muscle.",
      );
    }
  }

  let target = tdee + adjustment;
  const floor = SAFETY.minTargetKcal[input.sex];
  if (goal === "lose" && target < floor) {
    // Never plan below the floor, and never push a "loss" target above estimated expenditure.
    target = Math.min(floor, tdee);
    adjustment = target - tdee;
    rateKgPerWeek = Math.max(0, (-adjustment * 7) / KCAL_PER_KG);
    if (tdee <= floor) {
      adjustments.push(
        `Your estimated expenditure is at or below ${floor} kcal, the minimum Mogsthetics sets without clinical supervision, so no deficit is planned. A registered dietitian can help with an individual plan.`,
      );
    } else {
      adjustments.push(
        `Your target was raised to ${floor} kcal, the minimum Mogsthetics sets without clinical supervision. Expected progress is slower as a result.`,
      );
    }
  }

  const targetKcal = round10(target);

  let timeline: GoalTimeline | null = null;
  if (requestedRate !== null && diffKg !== null && input.targetWeeks) {
    const finalRate = rateKgPerWeek ?? 0;
    const plannedWeeks = finalRate > 0.01 ? Math.ceil(Math.abs(diffKg) / finalRate) : null;
    const step = plannedWeeks ? Math.max(1, Math.ceil(plannedWeeks / 8)) : 1;
    const milestones: GoalTimeline["milestones"] = [];
    if (plannedWeeks) {
      for (let w = step; w < plannedWeeks; w += step) {
        milestones.push({ week: w, weightKg: Math.round((input.weightKg + Math.sign(diffKg) * finalRate * w) * 10) / 10 });
      }
      milestones.push({ week: plannedWeeks, weightKg: Math.round(input.targetWeightKg! * 10) / 10 });
    }
    timeline = {
      requestedWeeks: input.targetWeeks,
      plannedWeeks,
      requestedRateKgPerWeek: Math.round(requestedRate * 100) / 100,
      slowedForSafety: plannedWeeks === null || plannedWeeks > input.targetWeeks,
      startWeightKg: input.weightKg,
      targetWeightKg: input.targetWeightKg!,
      milestones,
    };
    if (plannedWeeks === null) adjustments.push("Within the safety limits there's no meaningful deficit available, so a timeline can't be planned. A registered dietitian can help.");
    limitations.push("Weekly milestones assume steady progress; real weight changes fluctuate and usually slow over time.");
  }

  return {
    version: ENERGY_ENGINE_VERSION,
    status: "standard",
    trackingOnlyReasons: [],
    equation: bmrEst.equation,
    bmrKcal: Math.round(bmrEst.bmrKcal),
    bmrRange: bmrEst.range ? [Math.round(bmrEst.range[0]), Math.round(bmrEst.range[1])] : null,
    activityLevel: input.activityLevel,
    activityMultiplier: activity.multiplier,
    tdeeKcal: Math.round(tdee),
    tdeeRange: tdeeRange ? [Math.round(tdeeRange[0]), Math.round(tdeeRange[1])] : null,
    requestedGoal: input.goal,
    goal,
    pace,
    plannedRateKgPerWeek: rateKgPerWeek === null ? null : Math.round(rateKgPerWeek * 100) / 100,
    timeline,
    dailyAdjustmentKcal: goal === "maintain" ? 0 : Math.round(targetKcal - tdee),
    targetKcal,
    bmi: Math.round(bodyMassIndex * 10) / 10,
    adjustments,
    assumptions,
    limitations,
    warnings,
  };
}

/** Age today from an age recorded on a given date (no birth date is stored). */
export function currentAge(ageAtRecord: number, recordedAt: Date, now: Date = new Date()): number {
  const years = (now.getTime() - recordedAt.getTime()) / (365.2425 * 24 * 3600 * 1000);
  return ageAtRecord + Math.max(0, Math.floor(years));
}
