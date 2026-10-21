import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getAiProviders } from "@/lib/ai";
import { ANALYSIS_PROMPT_VERSION } from "@/lib/ai/prompts";
import { AiError, type AiUsage, type ImageInput } from "@/lib/ai/provider";
import { FoodAnalysisResultSchema, type FoodAnalysisResult } from "@/lib/ai/schemas";
import { processMealImage, IMAGE_LIMITS, type ImageQuality } from "@/lib/analysis/image";
import { runAnalysisPipeline } from "@/lib/analysis/pipeline";
import { getEnv } from "@/lib/config/env";
import type { AnalysisContext } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import {
  countAnalysesSince,
  createAnalysis,
  findAnalysisByIdempotencyKey,
  findDuplicateAnalysis,
  getAnalysis,
  updateAnalysis,
  type AnalysisRow,
} from "@/lib/repos/analyses";
import { getSubscription } from "@/lib/repos/misc";
import { recordAiUsage } from "@/lib/repos/system";
import { getServices } from "@/lib/server/context";
import { assertOwnedPath, getStorage } from "@/lib/storage";

const STALE_AFTER_MS = 3 * 60 * 1000;

export interface AnalysisView {
  id: string;
  status: AnalysisRow["status"];
  stage: string | null;
  isMock: boolean;
  modelProvider: string;
  modelVersion: string;
  promptVersion: string;
  quality: Partial<ImageQuality>;
  result: FoodAnalysisResult | null;
  imageUrl: string | null;
  mealId: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  completedAt: string | null;
}

export async function analysisQuota(userId: string): Promise<{ limit: number; used: number }> {
  const env = getEnv();
  const { db } = await getServices();
  return db.withUser(userId, async (q) => {
    const sub = await getSubscription(q, userId);
    const limit = env.QUOTA_ANALYSES_PER_DAY * (sub?.plan === "plus" && sub.status === "active" ? 3 : 1);
    const used = await countAnalysesSince(q, userId, new Date(Date.now() - 86400000).toISOString());
    return { limit, used };
  });
}

export async function startAnalysis(
  userId: string,
  files: Buffer[],
  context: AnalysisContext,
  idempotencyKey: string,
  schedule: (task: () => Promise<void>) => void,
): Promise<{ id: string; deduplicated: boolean }> {
  const { db } = await getServices();
  const existing = await db.withUser(userId, (q) => findAnalysisByIdempotencyKey(q, userId, idempotencyKey));
  if (existing) return { id: existing.id, deduplicated: true };

  const ai = await getAiProviders();
  if (!ai.vision) {
    throw new AppError("ai_unavailable", "Photo analysis isn't available right now. You can still log this meal manually.");
  }
  if (files.length < 1 || files.length > IMAGE_LIMITS.maxImagesPerMeal) {
    throw new AppError("validation_failed", `Upload between 1 and ${IMAGE_LIMITS.maxImagesPerMeal} photos of the meal.`);
  }

  const quota = await analysisQuota(userId);
  if (quota.used >= quota.limit) {
    throw new AppError(
      "quota_exceeded",
      `You've reached today's limit of ${quota.limit} photo analyses. Manual logging is still available.`,
    );
  }

  const processed = [];
  for (const f of files) processed.push(await processMealImage(f));
  const worst = processed.find((p) => p.quality.blocking) ?? processed.find((p) => p.quality.issues.length);
  if (worst?.quality.blocking) {
    throw new AppError("image_quality", "This photo is too dark or blank to analyse. Please retake it.", {
      quality: worst.quality,
      canOverride: false,
    });
  }
  if (worst && !context.analyzeDespiteQuality) {
    throw new AppError("image_quality", worst.quality.advice.join(" ") || "The photo quality may reduce accuracy.", {
      quality: worst.quality,
      canOverride: true,
    });
  }

  const sha = createHash("sha256")
    .update(processed.map((p) => p.sha256).join(":"))
    .digest("hex");
  const storage = await getStorage();
  const imagePath = `${userId}/${randomUUID().replaceAll("-", "")}.jpg`;
  await storage.put(imagePath, processed[0].jpeg, "image/jpeg");
  const quality = { ...processed[0].quality, width: processed[0].width, height: processed[0].height };

  const dup = await db.withUser(userId, (q) => findDuplicateAnalysis(q, userId, sha, ai.vision!.model, ANALYSIS_PROMPT_VERSION));
  if (dup && dup.structuredResult) {
    const id = await db.withUser(userId, (q) =>
      createAnalysis(q, userId, {
        imagePath,
        imageSha256: sha,
        imageCount: files.length,
        modelProvider: dup.modelProvider,
        modelVersion: dup.modelVersion,
        promptVersion: dup.promptVersion,
        isMock: dup.isMock,
        quality,
        userContext: context,
        idempotencyKey,
        status: "completed",
        structuredResult: dup.structuredResult,
        uncertaintyMetadata: dup.uncertaintyMetadata,
      }),
    );
    await db.withUser(userId, (q) => updateAnalysis(q, id, { usage: { dedupedFrom: dup.id } }));
    return { id, deduplicated: true };
  }

  const id = await db.withUser(userId, (q) =>
    createAnalysis(q, userId, {
      imagePath,
      imageSha256: sha,
      imageCount: files.length,
      modelProvider: ai.vision!.id,
      modelVersion: ai.vision!.model,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      isMock: ai.vision!.isMock,
      quality,
      userContext: context,
      idempotencyKey,
    }),
  );
  const images: ImageInput[] = processed.map((p) => ({ mediaType: "image/jpeg", base64: p.jpeg.toString("base64") }));
  schedule(() => runAnalysis(userId, id, images, context));
  return { id, deduplicated: false };
}

export async function runAnalysis(userId: string, analysisId: string, images: ImageInput[], context: AnalysisContext): Promise<void> {
  const { db, foods } = await getServices();
  const ai = await getAiProviders();
  const usages: Array<AiUsage & { failed?: string }> = [];
  try {
    if (!ai.vision) throw new AiError("unavailable", "Photo analysis is unavailable.", false);
    await db.withUser(userId, (q) => updateAnalysis(q, analysisId, { status: "processing", stage: "starting", started: true }));
    const out = await runAnalysisPipeline(
      {
        vision: ai.vision,
        foods,
        userId,
        onStage: (stage) => db.withUser(userId, (q) => updateAnalysis(q, analysisId, { stage })),
      },
      images,
      context,
    );
    usages.push(...out.usages);
    await db.withUser(userId, (q) =>
      updateAnalysis(q, analysisId, {
        status: "completed",
        stage: "done",
        structuredResult: out.result,
        uncertaintyMetadata: out.result.uncertainty,
        usage: summarizeUsage(usages),
        completed: true,
        errorCode: null,
      }),
    );
  } catch (err) {
    if (err instanceof AiError && err.usage) usages.push({ ...err.usage, failed: err.code });
    const code = err instanceof AiError ? err.code : "pipeline_error";
    const message =
      err instanceof AiError
        ? err.code === "refusal"
          ? "The AI model couldn't analyse this photo. Try another photo or log manually."
          : err.retryable
            ? "The analysis service is busy or unavailable. You can retry or log manually."
            : "The analysis couldn't be completed. You can retry or log manually."
        : "Something went wrong while analysing the photo. You can retry or log manually.";
    if (!(err instanceof AiError)) console.error("[analysis] pipeline failure:", err instanceof Error ? err.message : err);
    await db
      .withUser(userId, (q) =>
        updateAnalysis(q, analysisId, {
          status: "failed",
          stage: null,
          errorCode: code,
          errorMessage: message,
          usage: summarizeUsage(usages),
          completed: true,
        }),
      )
      .catch(() => undefined);
  } finally {
    for (const u of usages) {
      await db
        .withSystem((q) =>
          recordAiUsage(q, {
            userId,
            provider: u.provider,
            model: u.model,
            operation: u.operation,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            latencyMs: u.latencyMs,
            estimatedCostUsd: u.estimatedCostUsd,
            success: !u.failed,
            errorCode: u.failed ?? null,
          }),
        )
        .catch(() => undefined);
    }
  }
}

function summarizeUsage(usages: AiUsage[]) {
  return {
    calls: usages.map((u) => ({
      operation: u.operation,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      latencyMs: u.latencyMs,
    })),
    totalCostUsd: usages.reduce((s, u) => s + (u.estimatedCostUsd ?? 0), 0),
    totalLatencyMs: usages.reduce((s, u) => s + u.latencyMs, 0),
  };
}

export async function getAnalysisView(userId: string, analysisId: string): Promise<AnalysisView> {
  const { db } = await getServices();
  let row = await db.withUser(userId, (q) => getAnalysis(q, userId, analysisId));
  if (!row) throw new AppError("not_found", "Analysis not found.");
  const startedAt = new Date(row.startedAt ?? row.createdAt).getTime();
  if ((row.status === "queued" || row.status === "processing") && Date.now() - startedAt > STALE_AFTER_MS) {
    await db.withUser(userId, (q) =>
      updateAnalysis(q, analysisId, {
        status: "failed",
        errorCode: "timeout",
        errorMessage: "The analysis took too long. You can retry or log manually.",
        completed: true,
      }),
    );
    row = (await db.withUser(userId, (q) => getAnalysis(q, userId, analysisId)))!;
  }
  let imageUrl: string | null = null;
  if (row.imagePath) {
    assertOwnedPath(row.imagePath, userId);
    imageUrl = await (await getStorage()).signedUrl(row.imagePath, 3600);
  }
  const parsed = row.structuredResult ? FoodAnalysisResultSchema.safeParse(row.structuredResult) : null;
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    isMock: row.isMock,
    modelProvider: row.modelProvider,
    modelVersion: row.modelVersion,
    promptVersion: row.promptVersion,
    quality: row.quality as Partial<ImageQuality>,
    result: parsed?.success ? parsed.data : null,
    imageUrl,
    mealId: row.mealId,
    error: row.status === "failed" ? { code: row.errorCode ?? "unknown", message: row.errorMessage ?? "Analysis failed." } : null,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

/** Re-runs a failed analysis using the stored primary image. */
export async function retryAnalysis(userId: string, analysisId: string, schedule: (task: () => Promise<void>) => void): Promise<void> {
  const { db } = await getServices();
  const row = await db.withUser(userId, (q) => getAnalysis(q, userId, analysisId));
  if (!row) throw new AppError("not_found", "Analysis not found.");
  if (row.status !== "failed") throw new AppError("conflict", "Only failed analyses can be retried.");
  if (!row.imagePath) throw new AppError("conflict", "The photo for this analysis is no longer stored. Please upload it again.");
  assertOwnedPath(row.imagePath, userId);
  const bytes = await (await getStorage()).get(row.imagePath);
  if (!bytes) throw new AppError("conflict", "The photo for this analysis is no longer stored. Please upload it again.");
  await db.withUser(userId, (q) => updateAnalysis(q, analysisId, { status: "queued", stage: null, errorCode: null, errorMessage: null }));
  schedule(() =>
    runAnalysis(userId, analysisId, [{ mediaType: "image/jpeg", base64: bytes.toString("base64") }], row.userContext as AnalysisContext),
  );
}
