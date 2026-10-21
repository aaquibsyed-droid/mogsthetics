import { addDays } from "@/lib/nutrition/dates";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { userToday } from "@/lib/server/today";
import { computeInsights } from "@/lib/services/insights";
import { getRangeSummaries } from "@/lib/services/summary";

/** Weekly check-in: streak, logging consistency and gentle nutrient notes. */
export const GET = authed(
  async ({ user }) => {
    const { db } = await getServices();
    const { today } = await userToday(user.id);
    const days = await getRangeSummaries(db, user.id, addDays(today, -59), today);
    return ok(computeInsights(days, today));
  },
  { rateLimit: LIMITS.read },
);
