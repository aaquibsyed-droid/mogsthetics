import { listAdaptiveSuggestions } from "@/lib/repos/misc";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { userToday } from "@/lib/server/today";
import { reviewAdaptiveTarget } from "@/lib/services/progress";

/** Evaluates adaptive-target rules (may create one pending suggestion) and returns history. */
export const GET = authed(
  async ({ user }) => {
    const { db } = await getServices();
    const { today } = await userToday(user.id);
    const view = await reviewAdaptiveTarget(db, user.id, today);
    const history = await db.withUser(user.id, (q) => listAdaptiveSuggestions(q, user.id, 10));
    return ok({ ...view, history });
  },
  { rateLimit: LIMITS.read },
);
