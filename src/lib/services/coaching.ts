import "server-only";
import { getAiProviders } from "@/lib/ai";
import { AiError } from "@/lib/ai/provider";
import type { MealSuggestion, PersonalizedCoachingContext } from "@/lib/ai/schemas";
import { getEnv } from "@/lib/config/env";
import type { SuggestionRequest } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import { aiIngredientFood } from "@/lib/food-data/ai-food";
import { getLatestEnergyEstimate } from "@/lib/repos/goals";
import {
  getPlanningPreferences,
  insertCoachMessage,
  listCoachMessages,
  upsertPlanningPreferences,
  type CoachMessageRow,
} from "@/lib/repos/misc";
import type { Profile } from "@/lib/repos/profiles";
import { recordAiUsage } from "@/lib/repos/system";
import { getServices } from "@/lib/server/context";
import { buildSuggestion, isFoodAllowed, suggestFromTemplates, type SuggestionPrefs } from "@/lib/suggestions/engine";
import { getHealthOverview } from "./health";
import { getProgress } from "./progress";
import { getTrainingState } from "./training";
import { fmtHm } from "@/lib/health/recovery";
import { getDay, getWeekStats } from "./summary";
import { enforceRateLimit } from "@/lib/server/api";
import { safetyReplyFor } from "./coaching-safety";

function prefsFromProfile(p: Profile, extra: Partial<SuggestionPrefs> = {}): SuggestionPrefs {
  return {
    allergies: p.allergies,
    dietaryPattern: p.dietaryPattern,
    dislikedFoods: p.dislikedFoods,
    likedFoods: p.likedFoods,
    ...extra,
  };
}

export async function getMealSuggestions(
  userId: string,
  req: SuggestionRequest,
  today: string,
): Promise<{
  suggestions: MealSuggestion[];
  remaining: { caloriesKcal: number | null; proteinG: number | null };
  notes: string[];
  aiUsed: boolean;
  aiStatus: string;
}> {
  const { db } = await getServices();
  const date = req.localDate ?? today;
  const { summary, profile } = await getDay(db, userId, date);
  if (!profile) throw new AppError("onboarding_required", "Complete your profile first.");
  const saved = await db.withUser(userId, (q) => getPlanningPreferences(q, userId));
  const available = req.availableIngredients ?? saved?.availableIngredients ?? [];
  const maxPrep = req.maxPrepMinutes !== undefined ? req.maxPrepMinutes : (saved?.maxPrepMinutes ?? null);
  const budget = req.budget !== undefined ? req.budget : ((saved?.budget as SuggestionPrefs["budget"]) ?? null);
  if (req.availableIngredients || req.maxPrepMinutes !== undefined || req.budget !== undefined) {
    await db.withUser(userId, (q) =>
      upsertPlanningPreferences(q, userId, { maxPrepMinutes: maxPrep, budget: budget ?? null, availableIngredients: available }),
    );
  }
  const prefs = prefsFromProfile(profile, { availableIngredients: available, maxPrepMinutes: maxPrep, budget });
  const remaining = { caloriesKcal: summary.remaining.caloriesKcal, proteinG: summary.remaining.proteinG };
  const mealType = req.mealType === "custom" ? undefined : req.mealType;
  const notes: string[] = [];
  if (summary.targets.trackingOnly) notes.push("Targets aren't set for your situation, so suggestions use typical portions.");

  let suggestions = suggestFromTemplates(prefs, remaining, { mealType, limit: 4 });
  let aiUsed = false;
  const ai = await getAiProviders();
  if (req.useAi && ai.text && !ai.text.isMock) {
    await enforceRateLimit(userId, { bucket: "suggest-ai", limit: getEnv().QUOTA_SUGGESTIONS_PER_DAY, windowSeconds: 86400 });
    try {
      const out = await ai.text.mealIdeas({
        catalogJson: JSON.stringify({ allergies: prefs.allergies, dietaryPattern: prefs.dietaryPattern }),
        requestJson: JSON.stringify({
          mealType: mealType ?? "any",
          remainingCaloriesKcal: remaining.caloriesKcal,
          remainingProteinG: remaining.proteinG,
          dietaryPattern: prefs.dietaryPattern,
          allergies: prefs.allergies,
          dislikedFoods: prefs.dislikedFoods,
          likedFoods: prefs.likedFoods,
          availableIngredients: available,
          maxPrepMinutes: maxPrep,
          budget,
        }),
      });
      await db.withSystem((q) => recordAiUsage(q, { userId, ...out.usage, success: true, errorCode: null }));
      const aiSuggestions: MealSuggestion[] = [];
      for (const [idx, idea] of out.result.ideas.slice(0, 4).entries()) {
        const ings = idea.ingredients
          .filter((i) => i.name.trim() && i.grams > 0 && i.grams <= 1500)
          .map((i) => ({ food: aiIngredientFood(i), grams: Math.round(i.grams), note: i.note }));
        if (!ings.length) continue;
        // Safety net on top of the prompt: drop ideas that name one of the user's allergens.
        if (ings.some((i) => i.food.allergens.some((a) => prefs.allergies.includes(a)))) continue;
        if (maxPrep && idea.prepMinutes > maxPrep) continue;
        const built = buildSuggestion(
          {
            id: `ai-${idx + 1}`,
            name: idea.name.slice(0, 100),
            mealType: idea.mealType,
            prepMinutes: Math.max(1, Math.round(idea.prepMinutes)),
            instructions: idea.instructions.slice(0, 8).map((x) => x.slice(0, 300)),
            substitutions: idea.substitutions.slice(0, 3).map((x) => x.slice(0, 200)),
            source: "ai",
          },
          ings,
          [idea.whyItFits.slice(0, 200)],
        );
        aiSuggestions.push({ ...built, nutritionNote: "Nutrition estimated by AI for the listed amounts. Actual values depend on brands and preparation." });
      }
      suggestions = [...aiSuggestions, ...suggestions].slice(0, 6);
      aiUsed = aiSuggestions.length > 0;
    } catch (err) {
      notes.push("AI meal ideas are unavailable right now; showing Ascend recipes instead.");
      if (err instanceof AiError && err.usage)
        await db.withSystem((q) => recordAiUsage(q, { userId, ...err.usage!, success: false, errorCode: err.code }));
    }
  }
  if (!suggestions.length)
    notes.push("No suggestions match all your preferences and allergies. Try loosening the prep-time limit or available ingredients.");
  return { suggestions, remaining, notes, aiUsed, aiStatus: ai.status };
}

/** Deterministic, authorised user facts for the coach. Nothing here comes from the LLM. */
export async function buildCoachingContext(userId: string, today: string): Promise<PersonalizedCoachingContext> {
  const { db } = await getServices();
  const [{ summary, meals, profile }, week, progress, estimate, health, training] = await Promise.all([
    getDay(db, userId, today),
    getWeekStats(db, userId, today),
    getProgress(db, userId, today, 90),
    db.withUser(userId, (q) => getLatestEnergyEstimate(q, userId)),
    getHealthOverview(userId, today).catch(() => null),
    getTrainingState(userId, today).catch(() => null),
  ]);
  const hToday = health?.days.find((d) => d.date === today);
  const tIdx = training ? training.week.findIndex((w) => w.date === today) : -1;
  const tDay = training?.plan && tIdx >= 0 ? training.plan.days[tIdx] : null;
  if (!profile) throw new AppError("onboarding_required", "Complete your profile first.");
  const suggestions = suggestFromTemplates(
    prefsFromProfile(profile),
    { caloriesKcal: summary.remaining.caloriesKcal, proteinG: summary.remaining.proteinG },
    { limit: 3 },
  );
  const r1 = (n: number | null) => (n === null ? null : Math.round(n));
  return {
    generatedAt: new Date().toISOString(),
    today,
    profile: {
      displayName: profile.displayName,
      goal: summary.targets.goalType,
      pace: profile.goalPace,
      units: profile.preferredUnits,
      dietaryPattern: profile.dietaryPattern,
      allergies: profile.allergies,
      likedFoods: profile.likedFoods,
      dislikedFoods: profile.dislikedFoods,
      trackingOnly: summary.targets.trackingOnly,
      clinicalFlagsPresent: profile.clinicalFlags.length > 0,
    },
    targets: {
      caloriesKcal: summary.targets.caloriesKcal,
      proteinG: summary.targets.proteinG,
      carbohydratesG: summary.targets.carbohydratesG,
      fatG: summary.targets.fatG,
      fiberG: summary.targets.fiberG,
    },
    today_totals: {
      caloriesKcal: r1(summary.totals.caloriesKcal),
      proteinG: r1(summary.totals.proteinG),
      carbohydratesG: r1(summary.totals.carbohydratesG),
      fatG: r1(summary.totals.totalFatG),
      fiberG: r1(summary.totals.fiberG),
      mealsLogged: summary.totals.mealCount,
    },
    remaining: {
      caloriesKcal: r1(summary.remaining.caloriesKcal),
      proteinG: r1(summary.remaining.proteinG),
      carbohydratesG: r1(summary.remaining.carbohydratesG),
      fatG: r1(summary.remaining.fatG),
      fiberG: r1(summary.remaining.fiberG),
    },
    todayMeals: meals.map((m) => ({
      title: m.title,
      mealType: m.mealType,
      caloriesKcal: r1(m.items.reduce((s, i) => s + (i.snapshot?.caloriesKcal ?? 0), 0)),
    })),
    last7Days: {
      loggedDays: week.loggedDays,
      avgCaloriesKcal: r1(week.avgCaloriesKcal),
      avgProteinG: r1(week.avgProteinG),
      previous7AvgCaloriesKcal: r1(week.previousAvgCaloriesKcal),
    },
    weight: {
      latestTrendKg: progress.trend.latestTrendKg === null ? null : Math.round(progress.trend.latestTrendKg * 10) / 10,
      ratePerWeekKg: progress.trend.ratePerWeekKg === null ? null : Math.round(progress.trend.ratePerWeekKg * 100) / 100,
      change30dKg: progress.trend.change30dKg === null ? null : Math.round(progress.trend.change30dKg * 10) / 10,
      targetWeightKg: progress.targetWeightKg,
      projection: progress.projection.weeksRange
        ? `${progress.projection.weeksRange[0]}–${progress.projection.weeksRange[1]} weeks if the recent trend continued (uncertain)`
        : progress.projection.message,
      sufficientData: progress.trend.sufficient,
    },
    energy: { estimatedTdeeKcal: estimate?.tdeeKcal ?? null, bmrKcal: estimate?.bmrKcal ?? null, source: estimate?.source ?? null },
    recovery: health?.synced && hToday
      ? {
          recoveryPct: health.todayRecovery.score,
          zone: health.todayRecovery.zone,
          sleepLastNight: hToday.sleepMinutes != null ? fmtHm(hToday.sleepMinutes) : null,
          hrvMs: hToday.hrvMs,
          restingHr: hToday.restingHr,
          strain: health.todayStrain,
          sleepDebtThisWeek: health.sleepDebtMinutes ? fmtHm(health.sleepDebtMinutes) : null,
        }
      : null,
    trainingToday: tDay ? { focus: tDay.focus, kind: tDay.kind, minutes: Math.round(tDay.minutes), done: !!training?.week[tIdx]?.done } : null,
    suggestions: suggestions.map((s) => ({ name: s.name, caloriesKcal: s.nutrients.caloriesKcal, proteinG: s.nutrients.proteinG })),
  };
}

export async function askCoach(
  userId: string,
  message: string,
  today: string,
): Promise<{ reply: CoachMessageRow; userMessage: CoachMessageRow }> {
  const { db } = await getServices();
  const env = getEnv();
  await enforceRateLimit(userId, { bucket: "coach-day", limit: env.QUOTA_COACH_MESSAGES_PER_DAY, windowSeconds: 86400 });

  const userMessage = await db.withUser(userId, (q) => insertCoachMessage(q, userId, { role: "user", content: message }));
  const safety = safetyReplyFor(message);
  if (safety) {
    const reply = await db.withUser(userId, (q) =>
      insertCoachMessage(q, userId, { role: "assistant", content: safety, grounding: { safety: true } }),
    );
    return { reply, userMessage };
  }

  const ai = await getAiProviders();
  if (!ai.text) {
    throw new AppError("ai_unavailable", "The coach isn't available right now. Your dashboard still shows today's numbers.");
  }
  const context = await buildCoachingContext(userId, today);
  const history = (await db.withUser(userId, (q) => listCoachMessages(q, userId, 9)))
    .filter((m) => m.id !== userMessage.id)
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));
  // The API requires alternating turns starting with the user.
  while (history.length && history[0].role !== "user") history.shift();
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const h of history) {
    const last = merged.at(-1);
    if (last && last.role === h.role) last.content += `\n\n${h.content}`;
    else merged.push({ ...h });
  }
  if (merged.at(-1)?.role === "user") merged.pop();

  try {
    const out = await ai.text.coachReply({ contextJson: JSON.stringify(context), history: merged, message });
    await db.withSystem((q) => recordAiUsage(q, { userId, ...out.usage, success: true, errorCode: null }));
    const reply = await db.withUser(userId, (q) =>
      insertCoachMessage(q, userId, {
        role: "assistant",
        content: out.text.slice(0, 8000),
        isMock: ai.text!.isMock,
        grounding: {
          contextGeneratedAt: context.generatedAt,
          today: context.today,
          targets: context.targets,
          remaining: context.remaining,
        },
      }),
    );
    return { reply, userMessage };
  } catch (err) {
    if (err instanceof AiError) {
      if (err.usage) await db.withSystem((q) => recordAiUsage(q, { userId, ...err.usage!, success: false, errorCode: err.code }));
      throw new AppError(
        err.code === "refusal" ? "ai_failed" : "ai_unavailable",
        err.code === "refusal"
          ? "The coach couldn't answer that. Try rephrasing your question."
          : "The coach is unavailable right now. Please try again shortly.",
      );
    }
    throw err;
  }
}
