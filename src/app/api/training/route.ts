import { z } from "zod";
import { LocalDateSchema } from "@/lib/domain/schemas";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { userToday } from "@/lib/server/today";
import { buildTrainingPlan, getTrainingState, markWorkout } from "@/lib/services/training";

export const maxDuration = 60;

export const GET = authed(
  async ({ user }) => {
    const { today } = await userToday(user.id);
    return ok(await getTrainingState(user.id, today));
  },
  { rateLimit: LIMITS.read },
);

const Body = z
  .object({
    daysPerWeek: z.number().int().min(2).max(6),
    minutes: z.number().int().min(15).max(120),
    equipment: z.enum(["none", "dumbbells", "gym"]),
    experience: z.enum(["beginner", "intermediate", "advanced"]),
    limitations: z.string().trim().max(300).default(""),
  })
  .strict();

/** Builds (and saves) a new plan. */
export const POST = authed(
  async ({ req, user }) => {
    const { today } = await userToday(user.id);
    return ok(await buildTrainingPlan(user.id, await readJson(req, Body), today));
  },
  { rateLimit: LIMITS.ai },
);

const Done = z.object({ date: LocalDateSchema, focus: z.string().max(200).default(""), done: z.boolean() }).strict();

/** Marks a day's workout as done or not done. */
export const PATCH = authed(
  async ({ req, user }) => {
    const { today } = await userToday(user.id);
    const b = await readJson(req, Done);
    return ok(await markWorkout(user.id, b.date, b.focus, b.done, today));
  },
  { rateLimit: LIMITS.write },
);
