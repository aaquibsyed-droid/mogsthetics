import { z } from "zod";
import { LocalDateSchema } from "@/lib/domain/schemas";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { userToday } from "@/lib/server/today";
import { getHealthOverview, logHealth } from "@/lib/services/health";

export const maxDuration = 60;

export const GET = authed(
  async ({ user }) => {
    const { today } = await userToday(user.id);
    return ok(await getHealthOverview(user.id, today));
  },
  { rateLimit: LIMITS.read },
);

const Time = z.string().regex(/^\d{2}:\d{2}$/);
const Body = z
  .object({
    localDate: LocalDateSchema.optional(),
    sleepMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    bedTime: Time.nullable().optional(),
    wakeTime: Time.nullable().optional(),
    hrvMs: z.number().min(1).max(400).nullable().optional(),
    restingHr: z.number().min(20).max(200).nullable().optional(),
    steps: z.number().int().min(0).max(200000).nullable().optional(),
  })
  .strict();

/** Manual entry for a day (merges with what's stored). */
export const POST = authed(
  async ({ req, user }) => {
    const { today } = await userToday(user.id);
    const { localDate, ...patch } = await readJson(req, Body);
    return ok(await logHealth(user.id, localDate ?? today, patch, today));
  },
  { rateLimit: LIMITS.write },
);
