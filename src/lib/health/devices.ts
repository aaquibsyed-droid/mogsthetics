import "server-only";
import { getEnv } from "@/lib/config/env";
import { toLocalDate } from "@/lib/nutrition/dates";
import type { HealthPatch } from "@/lib/repos/health";

export type Provider = "whoop" | "oura";
export const PROVIDERS: Provider[] = ["whoop", "oura"];

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  clientId?: string;
  clientSecret?: string;
}

function config(p: Provider): ProviderConfig {
  const env = getEnv();
  return p === "whoop"
    ? {
        authUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
        tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
        scope: "offline read:recovery read:cycles read:sleep",
        clientId: env.WHOOP_CLIENT_ID,
        clientSecret: env.WHOOP_CLIENT_SECRET,
      }
    : {
        authUrl: "https://cloud.ouraring.com/oauth/authorize",
        tokenUrl: "https://api.ouraring.com/oauth/token",
        scope: "daily heartrate personal",
        clientId: env.OURA_CLIENT_ID,
        clientSecret: env.OURA_CLIENT_SECRET,
      };
}

export function isConfigured(p: Provider): boolean {
  const c = config(p);
  return !!(c.clientId && c.clientSecret);
}

export function authorizeUrl(p: Provider, redirectUri: string, state: string): string {
  const c = config(p);
  const u = new URL(c.authUrl);
  u.search = new URLSearchParams({ response_type: "code", client_id: c.clientId!, redirect_uri: redirectUri, scope: c.scope, state }).toString();
  return u.toString();
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

async function tokenRequest(p: Provider, params: Record<string, string>): Promise<Tokens> {
  const c = config(p);
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: c.clientId!, client_secret: c.clientSecret! }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${p} token request failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
  };
}

export const exchangeCode = (p: Provider, code: string, redirectUri: string) =>
  tokenRequest(p, { grant_type: "authorization_code", code, redirect_uri: redirectUri });

export const refreshTokens = (p: Provider, refreshToken: string) =>
  tokenRequest(p, { grant_type: "refresh_token", refresh_token: refreshToken, ...(p === "whoop" ? { scope: "offline" } : {}) });

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Device API ${new URL(url).hostname} failed (${res.status})`);
  return (await res.json()) as T;
}

type DayPatches = Map<string, HealthPatch>;
function put(m: DayPatches, date: string, patch: HealthPatch) {
  m.set(date, { ...m.get(date), ...patch });
}

/** Pulls the last `days` days of sleep, HRV, resting HR, steps and scores, keyed by local date. */
export async function fetchDays(p: Provider, token: string, fromDate: string, toDate: string, tz: string): Promise<DayPatches> {
  const out: DayPatches = new Map();
  if (p === "whoop") {
    const q = `start=${encodeURIComponent(`${fromDate}T00:00:00Z`)}&limit=25`;
    type R<T> = { records: T[] };
    const [rec, sleep, cycles] = await Promise.all([
      getJson<R<{ created_at: string; score_state: string; score?: { recovery_score: number; resting_heart_rate: number; hrv_rmssd_milli: number } }>>(
        `https://api.prod.whoop.com/developer/v2/recovery?${q}`,
        token,
      ),
      getJson<R<{ start: string; end: string; nap: boolean; score_state: string; score?: { sleep_efficiency_percentage?: number; stage_summary: { total_in_bed_time_milli: number; total_awake_time_milli: number } } }>>(
        `https://api.prod.whoop.com/developer/v2/activity/sleep?${q}`,
        token,
      ),
      getJson<R<{ start: string; score_state: string; score?: { strain: number } }>>(`https://api.prod.whoop.com/developer/v2/cycle?${q}`, token),
    ]);
    for (const r of rec.records)
      if (r.score_state === "SCORED" && r.score)
        put(out, toLocalDate(new Date(r.created_at), tz), {
          deviceRecovery: r.score.recovery_score,
          restingHr: r.score.resting_heart_rate,
          hrvMs: Math.round(r.score.hrv_rmssd_milli * 10) / 10,
        });
    for (const s of sleep.records)
      if (!s.nap && s.score_state === "SCORED" && s.score) {
        const st = s.score.stage_summary;
        put(out, toLocalDate(new Date(s.end), tz), {
          sleepMinutes: Math.round((st.total_in_bed_time_milli - st.total_awake_time_milli) / 60000),
          sleepEfficiency: s.score.sleep_efficiency_percentage ?? null,
          bedTime: s.start,
          wakeTime: s.end,
        });
      }
    for (const c of cycles.records) if (c.score_state === "SCORED" && c.score) put(out, toLocalDate(new Date(c.start), tz), { deviceStrain: c.score.strain });
  } else {
    const q = `start_date=${fromDate}&end_date=${toDate}`;
    type D<T> = { data: T[] };
    const [sleep, readiness, activity] = await Promise.all([
      getJson<D<{ day: string; type: string; total_sleep_duration: number | null; efficiency: number | null; average_hrv: number | null; lowest_heart_rate: number | null; bedtime_start: string; bedtime_end: string }>>(
        `https://api.ouraring.com/v2/usercollection/sleep?${q}`,
        token,
      ),
      getJson<D<{ day: string; score: number | null }>>(`https://api.ouraring.com/v2/usercollection/daily_readiness?${q}`, token),
      getJson<D<{ day: string; steps: number; active_calories: number }>>(`https://api.ouraring.com/v2/usercollection/daily_activity?${q}`, token),
    ]);
    for (const s of sleep.data)
      if (s.type === "long_sleep")
        put(out, s.day, {
          sleepMinutes: s.total_sleep_duration != null ? Math.round(s.total_sleep_duration / 60) : undefined,
          sleepEfficiency: s.efficiency ?? undefined,
          hrvMs: s.average_hrv ?? undefined,
          restingHr: s.lowest_heart_rate ?? undefined,
          bedTime: s.bedtime_start,
          wakeTime: s.bedtime_end,
        });
    for (const r of readiness.data) if (r.score != null) put(out, r.day, { deviceRecovery: r.score });
    for (const a of activity.data) put(out, a.day, { steps: a.steps, activeKcal: a.active_calories });
  }
  return out;
}
