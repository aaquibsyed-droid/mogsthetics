import { z } from "zod";
import type { NextRequest } from "next/server";
import { LocalDateSchema } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import { clientIp, enforceRateLimit, fail, LIMITS, ok, readJson } from "@/lib/server/api";
import { ingestWithToken } from "@/lib/services/health";

/** Shortcuts sends numbers as text, sometimes with a comma decimal or units; read the first number. */
const Num = z.preprocess((v) => {
  if (v === "" || v == null) return undefined;
  if (typeof v === "number") return v;
  let t = String(v).trim();
  // "3,200" / "12,450.5" are thousands separators; a lone "7,4" is a decimal comma.
  t = /^\d{1,3}(,\d{3})+(\.\d+)?\b/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}, z.number().optional());

const Body = z.object({
  date: LocalDateSchema.optional(),
  sleepHours: Num,
  sleepMinutes: Num,
  hrv: Num,
  restingHr: Num,
  steps: Num,
  activeKcal: Num,
});

/**
 * Apple Health → Ascend, called by an iPhone Shortcut with `Authorization: Bearer asc_…`.
 * Body: { sleepHours?, hrv?, restingHr?, steps?, activeKcal?, date? }.
 */
export async function POST(req: NextRequest) {
  try {
    await enforceRateLimit(`ip:${clientIp(req)}`, { ...LIMITS.write, bucket: "health-ingest" });
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token.startsWith("asc_")) throw new AppError("unauthorized", "Missing token. Create one in Ascend → Recovery.");
    const b = await readJson(req, Body);
    const sleep = b.sleepMinutes ?? (b.sleepHours != null ? b.sleepHours * 60 : undefined);
    const inRange = (v: number | undefined, lo: number, hi: number) => (v != null && v >= lo && v <= hi ? v : undefined);
    const patch = {
      sleepMinutes: inRange(sleep != null ? Math.round(sleep) : undefined, 1, 1440),
      hrvMs: inRange(b.hrv, 1, 400),
      restingHr: inRange(b.restingHr, 20, 200),
      steps: inRange(b.steps != null ? Math.round(b.steps) : undefined, 0, 200000),
      activeKcal: inRange(b.activeKcal != null ? Math.round(b.activeKcal) : undefined, 0, 20000),
    };
    const r = await ingestWithToken(token, patch, b.date);
    return ok({ saved: true, date: r.date, fields: Object.keys(patch).filter((k) => patch[k as keyof typeof patch] != null) });
  } catch (err) {
    return fail(err);
  }
}
