import "server-only";
import { requireUser } from "@/lib/auth";
import { latestWeight } from "@/lib/repos/metrics";
import { getProfile } from "@/lib/repos/profiles";
import { getServices } from "./context";

export async function loadProfileForEdit() {
  const user = await requireUser();
  const { db } = await getServices();
  return db.withUser(user.id, async (q) => ({
    user,
    profile: await getProfile(q, user.id),
    weightKg: (await latestWeight(q, user.id))?.weightKg ?? null,
  }));
}
