import { z } from "zod";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getAnalysisView } from "@/lib/services/analysis";

export const GET = authed<{ id: string }>(
  async ({ user, params }) => ok({ analysis: await getAnalysisView(user.id, z.string().uuid().parse(params.id)) }),
  {
    rateLimit: LIMITS.read,
  },
);
