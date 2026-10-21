/**
 * Profile & target orchestration: deterministic engines + transactional writes.
 * The LLM is never involved in these calculations.
 */
import type { Database } from "@/lib/db/types";
import type { ManualTargets, ProfileInput } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import { calculateMacroTargets, checkMacroConsistency, type MacroTargets } from "@/lib/nutrition/macros";
import { EnergyInputError, planEnergy, SAFETY, suggestActivityLevel, type EnergyPlan } from "@/lib/nutrition/energy";
import { applyGoal, getCurrentGoal, insertEnergyEstimate, type GoalPeriod } from "@/lib/repos/goals";
import { addBodyMetric } from "@/lib/repos/metrics";
import { getProfile, updateCurrentTargets, upsertProfile, type Profile } from "@/lib/repos/profiles";

export interface TargetPreview {
  plan: EnergyPlan;
  macros: MacroTargets | null;
  activitySuggestion: ReturnType<typeof suggestActivityLevel>;
}

export function previewTargets(input: ProfileInput): TargetPreview {
  let plan: EnergyPlan;
  try {
    plan = planEnergy({
      ageYears: input.ageYears,
      sex: input.sexParameter,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      activityLevel: input.activityLevel,
      goal: input.goalType,
      pace: input.goalPace ?? undefined,
      targetWeightKg: input.targetWeightKg ?? null,
      clinicalFlags: input.clinicalFlags,
    });
  } catch (err) {
    if (err instanceof EnergyInputError) throw new AppError("validation_failed", err.message, err.issues);
    throw err;
  }
  const macros =
    plan.status === "standard" && plan.targetKcal
      ? calculateMacroTargets({
          targetKcal: plan.targetKcal,
          weightKg: input.weightKg,
          heightCm: input.heightCm,
          goal: plan.goal,
          clinicalFlags: input.clinicalFlags,
          preferredProteinGPerKg: input.preferredProteinGPerKg ?? null,
          fatPercent: input.fatPercent ?? null,
        })
      : null;
  return { plan, macros, activitySuggestion: suggestActivityLevel(input.activityEvidence ?? {}) };
}

/**
 * Saves the profile and, in the same transaction, opens a new goal period
 * effective `today` (previous periods are preserved), records the energy
 * estimate and logs the entered weight.
 */
export async function applyProfileAndTargets(
  db: Database,
  userId: string,
  input: ProfileInput,
  today: string,
  nowIso: string,
): Promise<{ profile: Profile; goal: GoalPeriod; preview: TargetPreview }> {
  const preview = previewTargets(input);
  const { plan, macros } = preview;
  return db.withUser(userId, async (q) => {
    const before = await getProfile(q, userId);
    await upsertProfile(q, userId, {
      displayName: input.displayName ?? null,
      ageYears: input.ageYears,
      ageRecordedOn: today,
      sexParameter: input.sexParameter,
      heightCm: input.heightCm,
      preferredUnits: input.preferredUnits,
      timezone: input.timezone,
      activityLevel: input.activityLevel,
      activityEvidence: input.activityEvidence ?? {},
      goalType: plan.goal,
      goalPace: plan.pace,
      targetWeightKg: input.targetWeightKg ?? null,
      dietaryPattern: input.dietaryPattern,
      allergies: input.allergies,
      dislikedFoods: input.dislikedFoods,
      likedFoods: input.likedFoods,
      mealFrequency: input.mealFrequency ?? null,
      sleepHours: input.sleepHours ?? null,
      preferredProteinGPerKg: input.preferredProteinGPerKg ?? null,
      fatPercent: input.fatPercent ?? null,
      clinicalFlags: input.clinicalFlags,
      targets: {
        caloriesKcal: macros?.caloriesKcal ?? null,
        proteinG: macros?.proteinG ?? null,
        carbohydratesG: macros?.carbohydratesG ?? null,
        fatG: macros?.fatG ?? null,
        fiberG: macros?.fiberG ?? null,
      },
      completeOnboarding: true,
    });

    const goal = await applyGoal(q, userId, today, {
      goalType: plan.goal,
      goalPace: plan.pace,
      targetWeightKg: input.targetWeightKg ?? null,
      targetCaloriesKcal: macros?.caloriesKcal ?? null,
      targetProteinG: macros?.proteinG ?? null,
      targetCarbohydratesG: macros?.carbohydratesG ?? null,
      targetFatG: macros?.fatG ?? null,
      targetFiberG: macros?.fiberG ?? null,
      targetSaturatedFatMaxG: macros?.saturatedFatMaxG ?? null,
      targetSodiumMaxMg: macros?.sodiumMaxMg ?? null,
      trackingOnly: plan.status === "tracking_only",
      calculationMethod: plan.status === "tracking_only" ? "tracking_only" : "equation",
      activityLevel: input.activityLevel,
      assumptions: {
        energyPlan: plan,
        macroNotes: macros?.notes ?? [],
        macroRulesVersion: macros?.version ?? null,
        proteinGPerKg: macros?.proteinGPerKg ?? null,
        fatPercent: macros?.fatPercent ?? null,
      },
    });

    await insertEnergyEstimate(q, userId, {
      bmrKcal: plan.bmrKcal,
      tdeeKcal: plan.tdeeKcal,
      targetKcal: plan.targetKcal,
      equation: plan.equation,
      activityMultiplier: plan.activityMultiplier,
      source: "equation",
      inputs: {
        ageYears: input.ageYears,
        sexParameter: input.sexParameter,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        activityLevel: input.activityLevel,
        goal: plan.goal,
        pace: plan.pace,
      },
      uncertaintyNotes: [...plan.assumptions, ...plan.limitations].join(" "),
    });

    // Record the weight the plan is based on (first onboarding or when it changed).
    const lastWeight = before
      ? await q.query<{ w: number }>(
          `select weight_kg as w from public.user_body_metrics where user_id = $1::uuid and weight_kg is not null order by local_date desc, measured_at desc limit 1`,
          [userId],
        )
      : [];
    if (!lastWeight.length || Math.abs(lastWeight[0].w - input.weightKg) >= 0.05) {
      await addBodyMetric(q, userId, { measuredAt: nowIso, localDate: today, weightKg: input.weightKg, notes: "Entered with profile" });
    }

    const profile = (await getProfile(q, userId))!;
    return { profile, goal, preview };
  });
}

/** Manually edited targets: validated for energy consistency, stored as a new goal period. */
export async function applyManualTargets(db: Database, userId: string, t: ManualTargets, today: string): Promise<GoalPeriod> {
  const check = checkMacroConsistency(t);
  if (!check.ok) {
    throw new AppError(
      "validation_failed",
      `Protein, carbohydrate and fat add up to ${Math.round(check.macroKcal)} kcal, which doesn't match ${t.caloriesKcal} kcal. Adjust so they're within 5%.`,
      check,
    );
  }
  return db.withUser(userId, async (q) => {
    const current = await getCurrentGoal(q, userId);
    const profile = await getProfile(q, userId);
    if (!current || !profile) throw new AppError("onboarding_required", "Complete your profile first.");
    if (current.trackingOnly) {
      throw new AppError("forbidden", "Calorie targets aren't set for your situation. Please use targets from your care team.");
    }
    const floor = SAFETY.minTargetKcal[profile.sexParameter ?? "unspecified"];
    if (t.caloriesKcal < floor) {
      throw new AppError(
        "validation_failed",
        `Mogsthetics doesn't set targets below ${floor} kcal/day without clinical supervision. If a clinician has given you a lower target, follow their plan.`,
      );
    }
    const goal = await applyGoal(q, userId, today, {
      goalType: current.goalType,
      goalPace: current.goalPace,
      targetWeightKg: current.targetWeightKg,
      targetCaloriesKcal: t.caloriesKcal,
      targetProteinG: t.proteinG,
      targetCarbohydratesG: t.carbohydratesG,
      targetFatG: t.fatG,
      targetFiberG: t.fiberG,
      targetSaturatedFatMaxG: Math.round((t.caloriesKcal * 0.1) / 9),
      targetSodiumMaxMg: 2300,
      trackingOnly: false,
      calculationMethod: "manual",
      activityLevel: current.activityLevel,
      assumptions: { previousGoalId: current.id, note: "Targets edited manually by the user." },
    });
    await updateCurrentTargets(q, userId, {
      caloriesKcal: t.caloriesKcal,
      proteinG: t.proteinG,
      carbohydratesG: t.carbohydratesG,
      fatG: t.fatG,
      fiberG: t.fiberG,
    });
    return goal;
  });
}

/** Builds ProfileInput from a stored profile (for recalculation on profile edits). */
export function profileToInput(p: Profile, weightKg: number): ProfileInput | null {
  if (!p.ageYears || !p.sexParameter || !p.heightCm || !p.activityLevel || !p.goalType) return null;
  return {
    displayName: p.displayName,
    ageYears: p.ageYears,
    sexParameter: p.sexParameter,
    heightCm: p.heightCm,
    weightKg,
    preferredUnits: p.preferredUnits,
    timezone: p.timezone,
    activityLevel: p.activityLevel,
    activityEvidence: p.activityEvidence as ProfileInput["activityEvidence"],
    goalType: p.goalType,
    goalPace: p.goalPace,
    targetWeightKg: p.targetWeightKg,
    dietaryPattern: p.dietaryPattern,
    allergies: p.allergies,
    dislikedFoods: p.dislikedFoods,
    likedFoods: p.likedFoods,
    mealFrequency: p.mealFrequency,
    sleepHours: p.sleepHours,
    preferredProteinGPerKg: p.preferredProteinGPerKg,
    fatPercent: p.fatPercent,
    clinicalFlags: p.clinicalFlags,
  };
}
