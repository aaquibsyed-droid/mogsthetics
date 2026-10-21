import { randomUUID } from "node:crypto";
import { getAiProviders } from "@/lib/ai";
import { IMAGE_LIMITS } from "@/lib/analysis/image";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { analysisQuota } from "@/lib/services/analysis";

/**
 * Upload session: returns an idempotency key for this capture plus limits and
 * remaining quota, so the client can validate before uploading.
 */
export const POST = authed(
  async ({ user }) => {
    const ai = await getAiProviders();
    const quota = await analysisQuota(user.id);
    return ok({
      idempotencyKey: randomUUID().replaceAll("-", ""),
      available: !!ai.vision,
      provider: ai.status,
      isMock: ai.status === "mock",
      maxImages: IMAGE_LIMITS.maxImagesPerMeal,
      maxTotalBytes: IMAGE_LIMITS.maxUploadBytes,
      quota: { limit: quota.limit, used: quota.used, remaining: Math.max(0, quota.limit - quota.used) },
    });
  },
  { rateLimit: LIMITS.read },
);
