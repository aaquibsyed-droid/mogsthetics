import { ManualTargetsSchema } from "@/lib/domain/schemas";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { userToday } from "@/lib/server/today";
import { applyManualTargets } from "@/lib/services/targets";

export const PUT = authed(
  async ({ req, user }) => {
    const input = await readJson(req, ManualTargetsSchema);
    const { db } = await getServices();
    const { today } = await userToday(user.id);
    return ok({ goal: await applyManualTargets(db, user.id, input, today) });
  },
  { rateLimit: LIMITS.write },
);
