import { json, type Queryable } from "@/lib/db/types";

export type AnalysisStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface AnalysisRow {
  id: string;
  userId: string;
  mealId: string | null;
  imagePath: string | null;
  imageSha256: string | null;
  imageCount: number;
  modelProvider: string;
  modelVersion: string;
  promptVersion: string;
  isMock: boolean;
  status: AnalysisStatus;
  stage: string | null;
  quality: Record<string, unknown>;
  structuredResult: unknown;
  uncertaintyMetadata: unknown;
  userContext: Record<string, unknown>;
  usage: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const SELECT = `select id, user_id as "userId", meal_id as "mealId", image_path as "imagePath", image_sha256 as "imageSha256",
  image_count as "imageCount", model_provider as "modelProvider", model_version as "modelVersion",
  prompt_version as "promptVersion", is_mock as "isMock", status, stage, quality, structured_result as "structuredResult",
  uncertainty_metadata as "uncertaintyMetadata", user_context as "userContext", usage, error_code as "errorCode",
  error_message as "errorMessage", created_at as "createdAt", started_at as "startedAt", completed_at as "completedAt"
  from public.food_analyses`;

export async function createAnalysis(
  q: Queryable,
  userId: string,
  a: {
    imagePath: string;
    imageSha256: string;
    imageCount: number;
    modelProvider: string;
    modelVersion: string;
    promptVersion: string;
    isMock: boolean;
    quality: Record<string, unknown>;
    userContext: Record<string, unknown>;
    idempotencyKey: string | null;
    status?: AnalysisStatus;
    structuredResult?: unknown;
    uncertaintyMetadata?: unknown;
  },
): Promise<string> {
  const rows = await q.query<{ id: string }>(
    `insert into public.food_analyses (user_id, image_path, image_sha256, image_count, model_provider, model_version,
       prompt_version, is_mock, quality, user_context, idempotency_key, status, structured_result, uncertainty_metadata,
       completed_at)
     values ($1::uuid, $2::text, $3::text, $4::int, $5::text, $6::text, $7::text, $8::boolean, $9::text::jsonb,
       $10::text::jsonb, $11::text, $12::text, $13::text::jsonb, $14::text::jsonb,
       case when $12::text = 'completed' then now() else null end)
     returning id`,
    [
      userId,
      a.imagePath,
      a.imageSha256,
      a.imageCount,
      a.modelProvider,
      a.modelVersion,
      a.promptVersion,
      a.isMock,
      json(a.quality),
      json(a.userContext),
      a.idempotencyKey,
      a.status ?? "queued",
      a.structuredResult === undefined ? null : json(a.structuredResult),
      a.uncertaintyMetadata === undefined ? null : json(a.uncertaintyMetadata),
    ],
  );
  return rows[0].id;
}

export async function getAnalysis(q: Queryable, userId: string, id: string): Promise<AnalysisRow | null> {
  const rows = await q.query<AnalysisRow>(`${SELECT} where user_id = $1::uuid and id = $2::uuid`, [userId, id]);
  return rows[0] ?? null;
}

export async function findAnalysisByIdempotencyKey(q: Queryable, userId: string, key: string): Promise<AnalysisRow | null> {
  const rows = await q.query<AnalysisRow>(`${SELECT} where user_id = $1::uuid and idempotency_key = $2::text`, [userId, key]);
  return rows[0] ?? null;
}

/** Completed analysis of the identical (processed) image with the same model and prompt within 30 days. */
export async function findDuplicateAnalysis(
  q: Queryable,
  userId: string,
  sha: string,
  modelVersion: string,
  promptVersion: string,
): Promise<AnalysisRow | null> {
  const rows = await q.query<AnalysisRow>(
    `${SELECT} where user_id = $1::uuid and image_sha256 = $2::text and model_version = $3::text
       and prompt_version = $4::text and status = 'completed' and created_at > now() - interval '30 days'
     order by created_at desc limit 1`,
    [userId, sha, modelVersion, promptVersion],
  );
  return rows[0] ?? null;
}

export async function updateAnalysis(
  q: Queryable,
  id: string,
  patch: {
    status?: AnalysisStatus;
    stage?: string | null;
    structuredResult?: unknown;
    uncertaintyMetadata?: unknown;
    usage?: Record<string, unknown>;
    errorCode?: string | null;
    errorMessage?: string | null;
    started?: boolean;
    completed?: boolean;
    mealId?: string | null;
    clearImagePath?: boolean;
  },
): Promise<void> {
  await q.query(
    `update public.food_analyses set
       status = coalesce($2::text, status),
       stage = case when $3::boolean then $4::text else stage end,
       structured_result = coalesce($5::text::jsonb, structured_result),
       uncertainty_metadata = coalesce($6::text::jsonb, uncertainty_metadata),
       usage = coalesce($7::text::jsonb, usage),
       error_code = case when $8::boolean then $9::text else error_code end,
       error_message = case when $8::boolean then $10::text else error_message end,
       started_at = case when $11::boolean then now() else started_at end,
       completed_at = case when $12::boolean then now() else completed_at end,
       meal_id = case when $13::boolean then $14::uuid else meal_id end,
       image_path = case when $15::boolean then null else image_path end
     where id = $1::uuid`,
    [
      id,
      patch.status ?? null,
      patch.stage !== undefined,
      patch.stage ?? null,
      patch.structuredResult === undefined ? null : json(patch.structuredResult),
      patch.uncertaintyMetadata === undefined ? null : json(patch.uncertaintyMetadata),
      patch.usage === undefined ? null : json(patch.usage),
      patch.errorCode !== undefined,
      patch.errorCode ?? null,
      patch.errorMessage ?? null,
      patch.started ?? false,
      patch.completed ?? false,
      patch.mealId !== undefined,
      patch.mealId ?? null,
      patch.clearImagePath ?? false,
    ],
  );
}

export async function countAnalysesSince(q: Queryable, userId: string, sinceIso: string): Promise<number> {
  const rows = await q.query<{ n: number }>(
    `select count(*)::int as n from public.food_analyses where user_id = $1::uuid and created_at >= $2::timestamptz and not (usage ? 'dedupedFrom')`,
    [userId, sinceIso],
  );
  return rows[0].n;
}

export async function insertFeedback(
  q: Queryable,
  userId: string,
  rows: Array<{ analysisId: string | null; mealId: string | null; type: string; original: unknown; corrected: unknown }>,
): Promise<void> {
  for (const r of rows) {
    await q.query(
      `insert into public.analysis_feedback (user_id, analysis_id, meal_id, feedback_type, original, corrected)
       values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text::jsonb, $6::text::jsonb)`,
      [userId, r.analysisId, r.mealId, r.type, json(r.original), json(r.corrected)],
    );
  }
}
