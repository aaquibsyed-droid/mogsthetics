import { listGoalHistory } from "@/lib/repos/goals";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

export const GET = authed(
  async ({ user }) => {
    const { db } = await getServices();
    return ok({ history: await db.withUser(user.id, (q) => listGoalHistory(q, user.id)) });
  },
  { rateLimit: LIMITS.read },
);
