import { z } from "zod";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getTrainingPlan } from "@/lib/services/training";

export const maxDuration = 60;

const Body = z
  .object({
    daysPerWeek: z.number().int().min(2).max(6),
    minutes: z.number().int().min(15).max(120),
    equipment: z.enum(["none", "dumbbells", "gym"]),
    experience: z.enum(["beginner", "intermediate", "advanced"]),
    limitations: z.string().trim().max(300).default(""),
  })
  .strict();

export const POST = authed(
  async ({ req, user }) => ok(await getTrainingPlan(user.id, await readJson(req, Body))),
  { rateLimit: LIMITS.ai },
);
