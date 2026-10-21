import "server-only";
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError, isAppError } from "@/lib/errors";
import { hitRateLimit } from "@/lib/repos/system";

/**
 * Consistent JSON envelope:
 *   success → { ok: true, data }
 *   failure → { ok: false, error: { code, message, details? } }
 * Internal errors never leak stack traces or SQL.
 */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(err: unknown) {
  if (isAppError(err)) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message, details: err.details ?? undefined } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "validation_failed",
          message: "Some fields are invalid.",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 422 },
    );
  }
  // Log without request bodies or personal data.
  console.error("[api] unexpected error:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
  return NextResponse.json(
    { ok: false, error: { code: "internal_error", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

export interface RateLimitSpec {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export async function enforceRateLimit(key: string, spec: RateLimitSpec): Promise<void> {
  const db = await getDb();
  const res = await db.withSystem((q) => hitRateLimit(q, `${spec.bucket}:${key}`, spec.windowSeconds, spec.limit));
  if (!res.allowed) {
    throw new AppError("rate_limited", "Too many requests. Please wait a moment and try again.", { resetAt: res.resetAt });
  }
}

export async function readJson<S extends z.ZodType>(req: NextRequest | Request, schema: S, maxBytes = 64 * 1024): Promise<z.infer<S>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new AppError("payload_too_large", "Request body is too large.");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new AppError("payload_too_large", "Request body is too large.");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("validation_failed", "Request body must be valid JSON.");
  }
  return schema.parse(body);
}

export function clientIp(req: NextRequest | Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

type Handler<P> = (ctx: { req: NextRequest; user: SessionUser; params: P }) => Promise<Response>;

/**
 * Wraps an authenticated route handler: verifies the session, applies a
 * per-user rate limit, and converts errors into the standard envelope.
 */
export function authed<P = Record<string, string>>(
  handler: Handler<P>,
  opts: { rateLimit?: RateLimitSpec } = {},
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const user = await getSessionUser();
      if (!user) throw new AppError("unauthorized", "Please sign in.");
      if (opts.rateLimit) await enforceRateLimit(user.id, opts.rateLimit);
      const params = (await ctx?.params) ?? ({} as P);
      return await handler({ req, user, params });
    } catch (err) {
      unstable_rethrow(err); // let Next.js handle its own control-flow errors (prerender bailout, redirects)
      return fail(err);
    }
  };
}

export const LIMITS = {
  read: { bucket: "read", limit: 300, windowSeconds: 60 },
  write: { bucket: "write", limit: 60, windowSeconds: 60 },
  search: { bucket: "search", limit: 60, windowSeconds: 60 },
  upload: { bucket: "upload", limit: 12, windowSeconds: 60 },
  ai: { bucket: "ai", limit: 10, windowSeconds: 60 },
  auth: { bucket: "auth", limit: 10, windowSeconds: 300 },
  export: { bucket: "export", limit: 5, windowSeconds: 3600 },
} satisfies Record<string, RateLimitSpec>;
