import { after } from "next/server";
import { AnalysisContextSchema, IdempotencyKeySchema } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { startAnalysis } from "@/lib/services/analysis";
import { IMAGE_LIMITS } from "@/lib/analysis/image";

export const maxDuration = 300;

/**
 * Starts an AI analysis. multipart/form-data:
 *   images: File (1–4), context: JSON (AnalysisContext), idempotencyKey: string
 * Returns immediately with the analysis id; processing continues in the
 * background (`after`). Poll GET /api/analyses/:id.
 */
export const POST = authed(
  async ({ req, user }) => {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > IMAGE_LIMITS.maxUploadBytes + 64 * 1024) throw new AppError("payload_too_large", "Photos are too large. Try fewer photos.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError("validation_failed", "Expected multipart form data.");
    }
    const files = form.getAll("images").filter((f): f is File => f instanceof File);
    if (!files.length) throw new AppError("validation_failed", "Add at least one photo.");
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > IMAGE_LIMITS.maxUploadBytes) throw new AppError("payload_too_large", "Photos are too large. Try fewer photos.");
    const idempotencyKey = IdempotencyKeySchema.parse(String(form.get("idempotencyKey") ?? ""));
    let contextRaw: unknown = {};
    try {
      contextRaw = JSON.parse(String(form.get("context") ?? "{}"));
    } catch {
      throw new AppError("validation_failed", "Invalid analysis context.");
    }
    const context = AnalysisContextSchema.parse(contextRaw);
    const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
    const res = await startAnalysis(user.id, buffers, context, idempotencyKey, (task) => after(task));
    return ok(res, { status: 202 });
  },
  { rateLimit: LIMITS.upload },
);
