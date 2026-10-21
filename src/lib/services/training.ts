import "server-only";
import { getAiProviders } from "@/lib/ai";
import type { TrainingPlan } from "@/lib/ai/schemas";
import { AppError } from "@/lib/errors";
import { getProfile } from "@/lib/repos/profiles";
import { recordAiUsage } from "@/lib/repos/system";
import { getServices } from "@/lib/server/context";
import { templatePlan, type TrainingRequest } from "@/lib/training/template";

export type TrainingInput = Omit<TrainingRequest, "goal">;

/** Weekly training plan built on the user's nutrition goal. AI first; the template is the fallback. */
export async function getTrainingPlan(userId: string, input: TrainingInput): Promise<{ plan: TrainingPlan; goal: TrainingRequest["goal"]; source: "ai" | "template" }> {
  const { db } = await getServices();
  const profile = await db.withUser(userId, (q) => getProfile(q, userId));
  if (!profile) throw new AppError("onboarding_required", "Complete your profile first.");
  const goal: TrainingRequest["goal"] = profile.goalType === "lose" ? "lose" : profile.goalType === "gain" || profile.goalType === "muscle" ? "gain" : "maintain";
  const req: TrainingRequest = { ...input, goal };
  const ai = await getAiProviders();
  if (ai.text && !ai.text.isMock) {
    const requestJson = JSON.stringify({
      ...req,
      goalPace: profile.goalPace,
      ageYears: profile.ageYears,
      sex: profile.sexParameter,
      activityLevel: profile.activityLevel,
    });
    try {
      const out = await ai.text.trainingPlan({ requestJson });
      await db.withSystem((q) => recordAiUsage(q, { userId, ...out.usage, success: true, errorCode: null }));
      if (out.result.days.length === 7) return { plan: out.result, goal, source: "ai" };
    } catch (err) {
      console.warn("[training] AI plan failed:", err instanceof Error ? err.message : err);
    }
  }
  return { plan: templatePlan(req), goal, source: "template" };
}
