import { z } from "zod";
import { addSupplement, removeSupplement, setSupplementTaken } from "@/lib/repos/habits";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { briefingFor } from "@/lib/server/briefing-response";
import { getServices } from "@/lib/server/context";
import { userToday } from "@/lib/server/today";

const Add = z.object({ name: z.string().trim().min(1).max(80), dose: z.string().trim().max(60).default(""), hour: z.number().int().optional() }).strict();
const Tick = z.object({ id: z.string().uuid(), taken: z.boolean(), hour: z.number().int().optional() }).strict();

export const POST = authed(
  async ({ req, user }) => {
    const b = await readJson(req, Add);
    const { db } = await getServices();
    await db.withUser(user.id, (q) => addSupplement(q, user.id, b.name, b.dose));
    return ok(await briefingFor(user.id, b.hour), { status: 201 });
  },
  { rateLimit: LIMITS.write },
);

export const PATCH = authed(
  async ({ req, user }) => {
    const b = await readJson(req, Tick);
    const { db } = await getServices();
    const { today } = await userToday(user.id);
    await db.withUser(user.id, (q) => setSupplementTaken(q, user.id, b.id, today, b.taken));
    return ok(await briefingFor(user.id, b.hour));
  },
  { rateLimit: LIMITS.write },
);

export const DELETE = authed(
  async ({ req, user }) => {
    const id = z.string().uuid().parse(req.nextUrl.searchParams.get("id"));
    const { db } = await getServices();
    await db.withUser(user.id, (q) => removeSupplement(q, user.id, id));
    return ok(await briefingFor(user.id, Number(req.nextUrl.searchParams.get("hour") ?? NaN)));
  },
  { rateLimit: LIMITS.write },
);
