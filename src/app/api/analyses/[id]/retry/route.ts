import { after } from "next/server";
import { z } from "zod";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { retryAnalysis } from "@/lib/services/analysis";

export const maxDuration = 300;

export const POST = authed<{ id: string }>(
  async ({ user, params }) => {
    await retryAnalysis(user.id, z.string().uuid().parse(params.id), (task) => after(task));
    return ok({ retrying: true }, { status: 202 });
  },
  { rateLimit: LIMITS.ai },
);
