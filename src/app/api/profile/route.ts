import { ProfileInputSchema } from "@/lib/domain/schemas";
import { getCurrentGoal, getLatestEnergyEstimate } from "@/lib/repos/goals";
import { latestWeight } from "@/lib/repos/metrics";
import { getProfile } from "@/lib/repos/profiles";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { applyProfileAndTargets } from "@/lib/services/targets";
import { toLocalDate } from "@/lib/nutrition/dates";

export const GET = authed(
  async ({ user }) => {
    const { db } = await getServices();
    const data = await db.withUser(user.id, async (q) => ({
      profile: await getProfile(q, user.id),
      goal: await getCurrentGoal(q, user.id),
      energy: await getLatestEnergyEstimate(q, user.id),
      latestWeight: await latestWeight(q, user.id),
    }));
    return ok({ ...data, email: user.email });
  },
  { rateLimit: LIMITS.read },
);

/** Saves the profile and applies newly calculated targets from today (history preserved). */
export const PUT = authed(
  async ({ req, user }) => {
    const input = await readJson(req, ProfileInputSchema);
    const { db } = await getServices();
    const now = new Date();
    const res = await applyProfileAndTargets(db, user.id, input, toLocalDate(now, input.timezone), now.toISOString());
    return ok(res);
  },
  { rateLimit: LIMITS.write },
);
