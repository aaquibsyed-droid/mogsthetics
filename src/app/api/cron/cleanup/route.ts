import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import { getDb } from "@/lib/db";
import { purgeExpiredCache } from "@/lib/repos/foods";
import { clearAnalysisImage, clearMealImageSystem, expiredMealImages, orphanAnalysisImages, purgeRateLimits } from "@/lib/repos/system";
import { getStorage } from "@/lib/storage";

export const maxDuration = 300;

/**
 * Scheduled maintenance (Vercel Cron, see vercel.json). Requires
 * `Authorization: Bearer $CRON_SECRET`.
 * - Deletes meal images past their retention date.
 * - Deletes analysis photos that were never saved to a meal (older than 1 day).
 * - Purges expired nutrition-cache rows and old rate-limit counters.
 */
export async function GET(req: NextRequest) {
  const env = getEnv();
  const header = req.headers.get("authorization") ?? "";
  const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
  if (!expected || header.length !== expected.length || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  }
  const db = await getDb();
  const storage = await getStorage();
  const expired = await db.withSystem((q) => expiredMealImages(q));
  for (const m of expired) {
    await storage.remove([m.imagePath]).catch(() => undefined);
    await db.withSystem(async (q) => {
      await clearMealImageSystem(q, m.id);
      await q.query(`update public.food_analyses set image_path = null where image_path = $1::text`, [m.imagePath]);
    });
  }
  const orphans = await db.withSystem((q) => orphanAnalysisImages(q));
  for (const a of orphans) {
    await storage.remove([a.imagePath]).catch(() => undefined);
    await db.withSystem((q) => clearAnalysisImage(q, a.id));
  }
  const purged = await db.withSystem((q) => purgeExpiredCache(q));
  await db.withSystem((q) => purgeRateLimits(q));
  return NextResponse.json({
    ok: true,
    data: { expiredMealImages: expired.length, orphanAnalysisImages: orphans.length, purgedCacheRows: purged },
  });
}
