import "server-only";
import { getBriefing } from "@/lib/services/briefing";
import { userToday } from "./today";

/** Fresh briefing for the user's local "now" (hour comes from the device; defaults to noon). */
export async function briefingFor(userId: string, hour?: number | null) {
  const { today } = await userToday(userId);
  return getBriefing(userId, today, hour != null && hour >= 0 && hour <= 23 ? hour : 12);
}
