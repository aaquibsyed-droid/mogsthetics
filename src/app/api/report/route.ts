import { authed, LIMITS, ok } from "@/lib/server/api";
import { userToday } from "@/lib/server/today";
import { getWeeklyReport } from "@/lib/services/briefing";

export const GET = authed(
  async ({ user }) => {
    const { today } = await userToday(user.id);
    return ok(await getWeeklyReport(user.id, today));
  },
  { rateLimit: LIMITS.read },
);
