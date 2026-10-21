import "server-only";
import { toLocalDate } from "@/lib/nutrition/dates";
import { getProfile, type Profile } from "@/lib/repos/profiles";
import { getServices } from "./context";

/** The user's current local date (their profile timezone). */
export async function userToday(userId: string): Promise<{ today: string; profile: Profile | null }> {
  const { db } = await getServices();
  const profile = await db.withUser(userId, (q) => getProfile(q, userId));
  return { today: toLocalDate(new Date(), profile?.timezone ?? "UTC"), profile };
}
