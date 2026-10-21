import { z } from "zod";
import { AdaptiveDecisionSchema } from "@/lib/domain/schemas";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { userToday } from "@/lib/server/today";
import { decideAdaptive } from "@/lib/services/progress";

export const POST = authed<{ id: string }>(
  async ({ req, user, params }) => {
    const { decision } = await readJson(req, AdaptiveDecisionSchema);
    const { db } = await getServices();
    const { today } = await userToday(user.id);
    return ok({ suggestion: await decideAdaptive(db, user.id, z.string().uuid().parse(params.id), decision, today) });
  },
  { rateLimit: LIMITS.write },
);
