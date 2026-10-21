import type { Database } from "@/lib/db/types";
import { AppError } from "@/lib/errors";
import { evaluateAdaptiveTarget, type AdaptiveResult } from "@/lib/nutrition/adaptive";
import { addDays } from "@/lib/nutrition/dates";
import { calculateMacroTargets } from "@/lib/nutrition/macros";
import { analyzeTrend, projectToGoal, type GoalProjection, type TrendSummary } from "@/lib/nutrition/weight-trend";
import { applyGoal, getCurrentGoal, getLatestEnergyEstimate, insertEnergyEstimate } from "@/lib/repos/goals";
import { dailyTotals } from "@/lib/repos/meals";
import { listBodyMetrics, type BodyMetric } from "@/lib/repos/metrics";
import {
  decideAdaptiveSuggestion,
  getAdaptiveSuggestion,
  insertAdaptiveSuggestion,
  latestAdaptiveSuggestion,
  type AdaptiveSuggestionRow,
} from "@/lib/repos/misc";
import { getProfile, updateCurrentTargets } from "@/lib/repos/profiles";

export interface ProgressView {
  metrics: BodyMetric[];
  trend: TrendSummary;
  projection: GoalProjection;
  targetWeightKg: number | null;
}

export async function getProgress(db: Database, userId: string, today: string, days = 180): Promise<ProgressView> {
  return db.withUser(userId, async (q) => {
    const profile = await getProfile(q, userId);
    const metrics = await listBodyMetrics(q, userId, addDays(today, -days), today);
    const weighIns = metrics.filter((m) => m.weightKg != null).map((m) => ({ date: m.localDate, weightKg: m.weightKg! }));
    const trend = analyzeTrend(weighIns, 28);
    return {
      metrics,
      trend,
      projection: projectToGoal(trend, profile?.targetWeightKg ?? null),
      targetWeightKg: profile?.targetWeightKg ?? null,
    };
  });
}

export interface AdaptiveView {
  evaluation: AdaptiveResult | null;
  suggestion: AdaptiveSuggestionRow | null;
  trackingOnly: boolean;
}

/**
 * Evaluates the adaptive rules and, when warranted, records ONE pending
 * suggestion. Nothing changes until the user accepts it.
 */
export async function reviewAdaptiveTarget(db: Database, userId: string, today: string): Promise<AdaptiveView> {
  return db.withUser(userId, async (q) => {
    const profile = await getProfile(q, userId);
    const goal = await getCurrentGoal(q, userId);
    if (!profile || !goal) return { evaluation: null, suggestion: null, trackingOnly: false };
    if (goal.trackingOnly || goal.targetCaloriesKcal === null) return { evaluation: null, suggestion: null, trackingOnly: true };

    const latest = await latestAdaptiveSuggestion(q, userId);
    if (latest?.status === "pending") return { evaluation: null, suggestion: latest, trackingOnly: false };

    const from = addDays(today, -28);
    const totals = await dailyTotals(q, userId, from, addDays(today, -1));
    const metrics = await listBodyMetrics(q, userId, from, addDays(today, -1));
    const estimate = await getLatestEnergyEstimate(q, userId);
    const plan = (goal.assumptions as { energyPlan?: { tdeeKcal?: number; dailyAdjustmentKcal?: number } }).energyPlan;
    const priorTdee = estimate?.tdeeKcal ?? plan?.tdeeKcal ?? goal.targetCaloriesKcal;
    const plannedAdjustment = plan?.dailyAdjustmentKcal ?? goal.targetCaloriesKcal - priorTdee;

    const lastDecisionDate =
      latest && latest.status === "postponed" && latest.postponedUntil && latest.postponedUntil > today
        ? today
        : (latest?.createdOn ?? null);

    const evaluation = evaluateAdaptiveTarget({
      today,
      enabled: profile.adaptiveEnabled,
      goal: goal.goalType,
      sex: profile.sexParameter ?? "unspecified",
      currentTargetKcal: goal.targetCaloriesKcal,
      priorTdeeKcal: priorTdee,
      plannedAdjustmentKcal: plannedAdjustment,
      intake: totals.map((t) => ({ date: t.localDate, caloriesKcal: t.caloriesKcal ?? 0, mealCount: t.mealCount })),
      weighIns: metrics.filter((m) => m.weightKg != null).map((m) => ({ date: m.localDate, weightKg: m.weightKg! })),
      lastSuggestionDate: lastDecisionDate,
    });

    let suggestion: AdaptiveSuggestionRow | null = latest;
    if (evaluation.status === "suggest" && evaluation.suggestedTargetKcal !== null) {
      const id = await insertAdaptiveSuggestion(q, userId, {
        createdOn: today,
        previousTargetKcal: goal.targetCaloriesKcal,
        suggestedTargetKcal: evaluation.suggestedTargetKcal,
        reasons: evaluation.reasons,
        data: {
          ...evaluation.data,
          observedTdeeKcal: evaluation.observedTdeeKcal,
          blendedTdeeKcal: evaluation.blendedTdeeKcal,
          version: evaluation.version,
        },
      });
      suggestion = await getAdaptiveSuggestion(q, userId, id);
    }
    return { evaluation, suggestion, trackingOnly: false };
  });
}

export async function decideAdaptive(
  db: Database,
  userId: string,
  suggestionId: string,
  decision: "accept" | "reject" | "postpone",
  today: string,
): Promise<AdaptiveSuggestionRow> {
  return db.withUser(userId, async (q) => {
    const s = await getAdaptiveSuggestion(q, userId, suggestionId);
    if (!s) throw new AppError("not_found", "Suggestion not found.");
    if (s.status !== "pending") throw new AppError("conflict", "This suggestion was already decided.");
    if (decision === "reject") {
      await decideAdaptiveSuggestion(q, s.id, "rejected", null);
    } else if (decision === "postpone") {
      await decideAdaptiveSuggestion(q, s.id, "postponed", addDays(today, 7));
    } else {
      const profile = await getProfile(q, userId);
      const goal = await getCurrentGoal(q, userId);
      if (!profile || !goal || goal.trackingOnly) throw new AppError("conflict", "Your goal changed; this suggestion no longer applies.");
      if (goal.targetCaloriesKcal !== s.previousTargetKcal) {
        throw new AppError("conflict", "Your target changed since this suggestion was made, so it no longer applies.");
      }
      const weight = await q.query<{ w: number }>(
        `select weight_kg as w from public.user_body_metrics where user_id = $1::uuid and weight_kg is not null order by local_date desc, measured_at desc limit 1`,
        [userId],
      );
      if (!weight[0] || !profile.heightCm) throw new AppError("conflict", "A current weight and height are needed to recalculate targets.");
      const macros = calculateMacroTargets({
        targetKcal: s.suggestedTargetKcal,
        weightKg: weight[0].w,
        heightCm: profile.heightCm,
        goal: goal.goalType,
        clinicalFlags: profile.clinicalFlags,
        preferredProteinGPerKg: profile.preferredProteinGPerKg,
        fatPercent: profile.fatPercent,
      });
      await applyGoal(q, userId, today, {
        goalType: goal.goalType,
        goalPace: goal.goalPace,
        targetWeightKg: goal.targetWeightKg,
        targetCaloriesKcal: macros.caloriesKcal,
        targetProteinG: macros.proteinG,
        targetCarbohydratesG: macros.carbohydratesG,
        targetFatG: macros.fatG,
        targetFiberG: macros.fiberG,
        targetSaturatedFatMaxG: macros.saturatedFatMaxG,
        targetSodiumMaxMg: macros.sodiumMaxMg,
        trackingOnly: false,
        calculationMethod: "adaptive",
        activityLevel: goal.activityLevel,
        assumptions: {
          adaptiveSuggestionId: s.id,
          previousTargetKcal: s.previousTargetKcal,
          reasons: s.reasons,
          energyPlan: {
            ...(goal.assumptions as { energyPlan?: object }).energyPlan,
            tdeeKcal: (s.data as { blendedTdeeKcal?: number }).blendedTdeeKcal ?? null,
          },
          macroNotes: macros.notes,
        },
      });
      await insertEnergyEstimate(q, userId, {
        bmrKcal: null,
        tdeeKcal: (s.data as { blendedTdeeKcal?: number }).blendedTdeeKcal ?? null,
        targetKcal: s.suggestedTargetKcal,
        equation: "adaptive_energy_balance",
        activityMultiplier: null,
        source: "adaptive",
        inputs: s.data,
        uncertaintyNotes: "Estimated from logged intake and weight trend; both are noisy. Not a laboratory measurement.",
      });
      await updateCurrentTargets(q, userId, {
        caloriesKcal: macros.caloriesKcal,
        proteinG: macros.proteinG,
        carbohydratesG: macros.carbohydratesG,
        fatG: macros.fatG,
        fiberG: macros.fiberG,
      });
      await decideAdaptiveSuggestion(q, s.id, "accepted", null);
    }
    return (await getAdaptiveSuggestion(q, userId, s.id))!;
  });
}
