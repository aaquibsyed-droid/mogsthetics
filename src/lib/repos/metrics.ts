import type { Queryable } from "@/lib/db/types";

export interface BodyMetric {
  id: string;
  measuredAt: string;
  localDate: string;
  weightKg: number | null;
  waistCm: number | null;
  hipCm: number | null;
  chestCm: number | null;
  source: string;
  notes: string | null;
}

const SELECT = `select id, measured_at as "measuredAt", local_date::text as "localDate", weight_kg as "weightKg",
  waist_cm as "waistCm", hip_cm as "hipCm", chest_cm as "chestCm", source, notes from public.user_body_metrics`;

export async function addBodyMetric(
  q: Queryable,
  userId: string,
  m: {
    measuredAt: string;
    localDate: string;
    weightKg?: number | null;
    waistCm?: number | null;
    hipCm?: number | null;
    chestCm?: number | null;
    notes?: string | null;
    source?: "manual" | "import";
  },
): Promise<BodyMetric> {
  const rows = await q.query<{ id: string }>(
    `insert into public.user_body_metrics (user_id, measured_at, local_date, weight_kg, waist_cm, hip_cm, chest_cm, source, notes)
     values ($1::uuid, $2::timestamptz, $3::date, $4::double precision, $5::double precision, $6::double precision,
       $7::double precision, $8::text, $9::text) returning id`,
    [
      userId,
      m.measuredAt,
      m.localDate,
      m.weightKg ?? null,
      m.waistCm ?? null,
      m.hipCm ?? null,
      m.chestCm ?? null,
      m.source ?? "manual",
      m.notes ?? null,
    ],
  );
  return (await q.query<BodyMetric>(`${SELECT} where id = $1::uuid`, [rows[0].id]))[0];
}

export async function listBodyMetrics(q: Queryable, userId: string, from: string, to: string): Promise<BodyMetric[]> {
  return q.query<BodyMetric>(
    `${SELECT} where user_id = $1::uuid and local_date between $2::date and $3::date order by local_date asc, measured_at asc`,
    [userId, from, to],
  );
}

export async function latestWeight(q: Queryable, userId: string): Promise<BodyMetric | null> {
  const rows = await q.query<BodyMetric>(
    `${SELECT} where user_id = $1::uuid and weight_kg is not null order by local_date desc, measured_at desc limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function deleteBodyMetric(q: Queryable, userId: string, id: string): Promise<boolean> {
  const rows = await q.query(`delete from public.user_body_metrics where user_id = $1::uuid and id = $2::uuid returning id`, [userId, id]);
  return rows.length > 0;
}
