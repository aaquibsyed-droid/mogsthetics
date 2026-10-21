/** System-connection repositories (rate limits, AI usage). Never exposed to users directly. */
import type { Queryable } from "@/lib/db/types";

/**
 * Fixed-window counter in Postgres (works across serverless instances without
 * extra infrastructure). Returns whether the request is allowed.
 */
export async function hitRateLimit(
  q: Queryable,
  bucket: string,
  windowSeconds: number,
  limit: number,
): Promise<{ allowed: boolean; count: number; resetAt: string }> {
  const rows = await q.query<{ count: number; windowStart: string }>(
    `insert into public.rate_limit_counters (bucket, window_start, count)
     values ($1::text, to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int), 1)
     on conflict (bucket, window_start) do update set count = rate_limit_counters.count + 1
     returning count, window_start as "windowStart"`,
    [bucket, windowSeconds],
  );
  const { count, windowStart } = rows[0];
  return {
    allowed: count <= limit,
    count,
    resetAt: new Date(new Date(windowStart).getTime() + windowSeconds * 1000).toISOString(),
  };
}

export async function purgeRateLimits(q: Queryable): Promise<void> {
  await q.query(`delete from public.rate_limit_counters where window_start < now() - interval '2 days'`);
}

export async function recordAiUsage(
  q: Queryable,
  e: {
    userId: string | null;
    provider: string;
    model: string;
    operation: string;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number;
    estimatedCostUsd: number | null;
    success: boolean;
    errorCode: string | null;
  },
): Promise<void> {
  await q.query(
    `insert into public.ai_usage_events (user_id, provider, model, operation, input_tokens, output_tokens, latency_ms,
       estimated_cost_usd, success, error_code)
     values ($1::uuid, $2::text, $3::text, $4::text, $5::int, $6::int, $7::int, $8::double precision, $9::boolean, $10::text)`,
    [e.userId, e.provider, e.model, e.operation, e.inputTokens, e.outputTokens, e.latencyMs, e.estimatedCostUsd, e.success, e.errorCode],
  );
}

export async function usageSummary(q: Queryable, sinceIso: string) {
  return q.query<{
    provider: string;
    model: string;
    operation: string;
    calls: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    p50LatencyMs: number;
  }>(
    `select provider, model, operation, count(*)::int as calls, count(*) filter (where not success)::int as failures,
       coalesce(sum(input_tokens), 0)::int as "inputTokens", coalesce(sum(output_tokens), 0)::int as "outputTokens",
       coalesce(sum(estimated_cost_usd), 0)::double precision as "costUsd",
       coalesce(percentile_cont(0.5) within group (order by latency_ms), 0)::int as "p50LatencyMs"
     from public.ai_usage_events where created_at >= $1::timestamptz group by 1, 2, 3 order by 1, 2, 3`,
    [sinceIso],
  );
}

/** Meals whose retained image has expired (for the cleanup job). */
export async function expiredMealImages(q: Queryable, limit = 200): Promise<Array<{ id: string; userId: string; imagePath: string }>> {
  return q.query(
    `select id, user_id as "userId", original_image_path as "imagePath" from public.meals
     where original_image_path is not null and image_expires_at is not null and image_expires_at < now()
     limit $1::int`,
    [limit],
  );
}

/** Analysis images that were never attached to a meal and are older than a day. */
export async function orphanAnalysisImages(q: Queryable, limit = 200): Promise<Array<{ id: string; userId: string; imagePath: string }>> {
  return q.query(
    `select a.id, a.user_id as "userId", a.image_path as "imagePath" from public.food_analyses a
     where a.image_path is not null and a.created_at < now() - interval '1 day'
       and not exists (select 1 from public.meals m where m.original_image_path = a.image_path)
     limit $1::int`,
    [limit],
  );
}

export async function clearAnalysisImage(q: Queryable, id: string): Promise<void> {
  await q.query(`update public.food_analyses set image_path = null where id = $1::uuid`, [id]);
}

export async function clearMealImageSystem(q: Queryable, id: string): Promise<void> {
  await q.query(`update public.meals set original_image_path = null, image_expires_at = null where id = $1::uuid`, [id]);
}
