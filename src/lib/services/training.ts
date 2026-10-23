import "server-only";
import { getAiProviders } from "@/lib/ai";
import type { TrainingPlan } from "@/lib/ai/schemas";
import { AppError } from "@/lib/errors";
import { addDays } from "@/lib/nutrition/dates";
import { getProfile } from "@/lib/repos/profiles";
import { recordAiUsage } from "@/lib/repos/system";
import { getTrainingPlanRow, listWorkoutDates, saveTrainingPlan, setWorkoutDone } from "@/lib/repos/training";
import { getServices } from "@/lib/server/context";
import { templatePlan, type TrainingRequest } from "@/lib/training/template";

export type TrainingInput = Omit<TrainingRequest, "goal">;
type Goal = TrainingRequest["goal"];

export interface TrainingState {
  plan: TrainingPlan | null;
  settings: Record<string, unknown> | null;
  goal: Goal;
  source: "ai" | "template" | null;
  /** Monday–Sunday dates of the current week, and which of them have a completed workout. */
  week: Array<{ date: string; done: boolean }>;
  today: string;
  /** False until the training tables exist in the database; plans then live on the device only. */
  synced: boolean;
}

/** Postgres "undefined_table": the training migration hasn't been applied yet. */
function isMissingTable(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "42P01";
}

function goalOf(goalType: string | null): Goal {
  return goalType === "lose" ? "lose" : goalType === "gain" || goalType === "muscle" ? "gain" : "maintain";
}

function weekOf(today: string): string[] {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export async function getTrainingState(userId: string, today: string): Promise<TrainingState> {
  const { db } = await getServices();
  const profile = await db.withUser(userId, (q) => getProfile(q, userId));
  if (!profile) throw new AppError("onboarding_required", "Complete your profile first.");
  const dates = weekOf(today);
  try {
    const [row, done] = await db.withUser(userId, async (q) =>
      Promise.all([getTrainingPlanRow(q, userId), listWorkoutDates(q, userId, dates[0], dates[6])]),
    );
    return {
      plan: row?.plan ?? null,
      settings: row?.settings ?? null,
      goal: row?.goal ?? goalOf(profile.goalType),
      source: row?.source ?? null,
      week: dates.map((date) => ({ date, done: done.includes(date) })),
      today,
      synced: true,
    };
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return { plan: null, settings: null, goal: goalOf(profile.goalType), source: null, week: dates.map((date) => ({ date, done: false })), today, synced: false };
  }
}

/** Weekly training plan built on the user's nutrition goal. AI first; the template is the fallback. Saved to the account. */
export async function buildTrainingPlan(userId: string, input: TrainingInput, today: string): Promise<TrainingState> {
  const { db } = await getServices();
  const profile = await db.withUser(userId, (q) => getProfile(q, userId));
  if (!profile) throw new AppError("onboarding_required", "Complete your profile first.");
  // The training focus the user picked overrides the nutrition goal for shaping workouts.
  const goal = input.focus === "fat_loss" ? "lose" : input.focus === "muscle" || input.focus === "strength" ? "gain" : goalOf(profile.goalType);
  const req: TrainingRequest = { ...input, goal };
  let plan: TrainingPlan | null = null;
  const ai = await getAiProviders();
  if (ai.text && !ai.text.isMock) {
    const requestJson = JSON.stringify({ ...req, goal: goalOf(profile.goalType), goalPace: profile.goalPace, ageYears: profile.ageYears, sex: profile.sexParameter, activityLevel: profile.activityLevel });
    try {
      const out = await ai.text.trainingPlan({ requestJson });
      await db.withSystem((q) => recordAiUsage(q, { userId, ...out.usage, success: true, errorCode: null }));
      if (out.result.days.length === 7) plan = out.result;
    } catch (err) {
      console.warn("[training] AI plan failed:", err instanceof Error ? err.message : err);
    }
  }
  const source = plan ? "ai" : "template";
  plan ??= templatePlan(req);
  try {
    await db.withUser(userId, (q) => saveTrainingPlan(q, userId, { plan: plan!, settings: { ...input }, goal, source }));
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    const state = await getTrainingState(userId, today);
    return { ...state, plan, settings: { ...input }, goal, source };
  }
  return getTrainingState(userId, today);
}

export async function markWorkout(userId: string, date: string, focus: string, done: boolean, today: string): Promise<TrainingState> {
  if (date > today) throw new AppError("validation_failed", "Can't complete a workout in the future.");
  const { db } = await getServices();
  try {
    await db.withUser(userId, (q) => setWorkoutDone(q, userId, date, focus, done));
  } catch (err) {
    if (isMissingTable(err)) throw new AppError("validation_failed", "Workout tracking isn't set up on the server yet.");
    throw err;
  }
  return getTrainingState(userId, today);
}
