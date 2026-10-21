import "server-only";
import { randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";
import { authorizeUrl, exchangeCode, fetchDays, isConfigured, PROVIDERS, refreshTokens, type Provider } from "@/lib/health/devices";
import { baselines, guidance, recoveryFor, strainFor, type HealthDay, type RecoveryScore } from "@/lib/health/recovery";
import { addDays, toLocalDate } from "@/lib/nutrition/dates";
import { getProfile } from "@/lib/repos/profiles";
import {
  deleteConnection,
  ingestTokenInfo,
  listConnections,
  listHealthDays,
  markSynced,
  saveConnection,
  setIngestToken,
  upsertHealthDay,
  userForIngestToken,
  type HealthPatch,
} from "@/lib/repos/health";
import { getSleepStarted, setSleepStarted } from "@/lib/repos/habits";
import { listWorkoutDates } from "@/lib/repos/training";
import { getServices } from "@/lib/server/context";
import { open, seal, sha256 } from "@/lib/server/secret-box";

const SYNC_EVERY_MS = 30 * 60 * 1000;

export interface HealthOverview {
  today: string;
  days: Array<HealthDay & { recovery: number | null; strain: number | null; workout: boolean }>;
  todayRecovery: RecoveryScore;
  todayStrain: number | null;
  guidance: string;
  baselines: { hrvMs: number | null; restingHr: number | null; sleepMinutes: number | null };
  sleepDebtMinutes: number | null;
  devices: Array<{ provider: Provider; available: boolean; connected: boolean; lastSyncAt: string | null }>;
  appleHealth: { connected: boolean; lastUsedAt: string | null };
  /** Set while a one-tap sleep is running ("Going to bed" tapped). */
  sleepStartedAt: string | null;
  /** False until the recovery tables exist in the database. */
  synced: boolean;
}

function isMissingTable(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "42P01";
}

export async function getHealthOverview(userId: string, today: string): Promise<HealthOverview> {
  const { db } = await getServices();
  const from = addDays(today, -44);
  try {
    await syncDevicesIfStale(userId, today).catch((e) => console.warn("[health] sync failed:", e instanceof Error ? e.message : e));
    const [raw, workouts] = await db.withUser(userId, (q) =>
      Promise.all([listHealthDays(q, userId, from, today), listWorkoutDates(q, userId, from, today).catch(() => [] as string[])]),
    );
    const [conns, token] = await db.withSystem((q) => Promise.all([listConnections(q, userId), ingestTokenInfo(q, userId)]));
    const days = raw.map((d) => {
      const r = recoveryFor(d, baselines(raw, d.date));
      return { ...d, recovery: r.score, strain: strainFor(d, workouts.includes(d.date)), workout: workouts.includes(d.date) };
    });
    const todayRow = raw.find((d) => d.date === today);
    const base = baselines(raw, today);
    const rec = recoveryFor(todayRow, base);
    const last7 = raw.filter((d) => d.date > addDays(today, -7) && d.sleepMinutes != null);
    return {
      today,
      days: days.slice(-30),
      todayRecovery: rec,
      todayStrain: strainFor(todayRow, workouts.includes(today)),
      guidance: guidance(rec.zone),
      baselines: base,
      sleepDebtMinutes: last7.length ? Math.max(0, last7.reduce((s, d) => s + (480 - (d.sleepMinutes ?? 0)), 0)) : null,
      devices: PROVIDERS.map((p) => {
        const c = conns.find((x) => x.provider === p);
        return { provider: p, available: isConfigured(p), connected: !!c, lastSyncAt: c?.lastSyncAt ?? null };
      }),
      appleHealth: { connected: !!token, lastUsedAt: token?.lastUsedAt ?? null },
      sleepStartedAt: await getSleepStart(userId),
      synced: true,
    };
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return {
      today,
      days: [],
      todayRecovery: { score: null, zone: null, drivers: [], fromDevice: false },
      todayStrain: null,
      guidance: guidance(null),
      baselines: { hrvMs: null, restingHr: null, sleepMinutes: null },
      sleepDebtMinutes: null,
      devices: PROVIDERS.map((p) => ({ provider: p, available: false, connected: false, lastSyncAt: null })),
      appleHealth: { connected: false, lastUsedAt: null },
      sleepStartedAt: null,
      synced: false,
    };
  }
}

export async function logHealth(userId: string, date: string, patch: HealthPatch, today: string): Promise<HealthOverview> {
  if (date > today) throw new AppError("validation_failed", "Can't log a future day.");
  const { db } = await getServices();
  try {
    await db.withUser(userId, (q) => upsertHealthDay(q, userId, date, "manual", patch));
  } catch (err) {
    if (isMissingTable(err)) throw new AppError("validation_failed", "Recovery tracking isn't set up on the server yet.");
    throw err;
  }
  return getHealthOverview(userId, today);
}

/** Creates (or replaces) the personal token an iPhone Shortcut uses to send Apple Health data. Shown once. */
export async function createIngestToken(userId: string): Promise<string> {
  const token = `asc_${randomBytes(24).toString("base64url")}`;
  const { db } = await getServices();
  await db.withSystem((q) => setIngestToken(q, userId, sha256(token)));
  return token;
}

export async function ingestWithToken(token: string, patch: HealthPatch, date: string | undefined): Promise<{ date: string }> {
  const { db } = await getServices();
  const userId = await db.withSystem((q) => userForIngestToken(q, sha256(token)));
  if (!userId) throw new AppError("unauthorized", "Invalid or revoked token. Create a new one in Ascend → Recovery.");
  const profile = await db.withUser(userId, (q) => getProfile(q, userId));
  const tz = profile?.timezone ?? "UTC";
  const day = date ?? toLocalDate(new Date(), tz);
  await db.withSystem((q) => upsertHealthDay(q, userId, day, "apple_health", patch));
  return { date: day };
}

// --- WHOOP / Oura ------------------------------------------------------------------

export function connectUrl(p: Provider, redirectUri: string): { url: string; state: string } {
  if (!isConfigured(p)) throw new AppError("validation_failed", `${p === "whoop" ? "WHOOP" : "Oura"} isn't set up on this server yet.`);
  const state = randomBytes(16).toString("base64url");
  return { url: authorizeUrl(p, redirectUri, state), state };
}

export async function completeConnect(userId: string, p: Provider, code: string, redirectUri: string, today: string): Promise<void> {
  const t = await exchangeCode(p, code, redirectUri);
  const { db } = await getServices();
  await db.withSystem((q) =>
    saveConnection(q, userId, { provider: p, accessToken: seal(t.accessToken), refreshToken: t.refreshToken ? seal(t.refreshToken) : null, expiresAt: t.expiresAt }),
  );
  await syncDevicesIfStale(userId, today, true);
}

export async function disconnect(userId: string, p: Provider): Promise<void> {
  const { db } = await getServices();
  await db.withSystem((q) => deleteConnection(q, userId, p));
}

export async function syncDevicesIfStale(userId: string, today: string, force = false): Promise<void> {
  const { db } = await getServices();
  const conns = await db.withSystem((q) => listConnections(q, userId));
  const due = conns.filter((c) => force || !c.lastSyncAt || Date.now() - new Date(c.lastSyncAt).getTime() > SYNC_EVERY_MS);
  if (!due.length) return;
  const profile = await db.withUser(userId, (q) => getProfile(q, userId));
  const tz = profile?.timezone ?? "UTC";
  for (const c of due) {
    let access = open(c.accessToken);
    if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now() + 60_000 && c.refreshToken) {
      const t = await refreshTokens(c.provider, open(c.refreshToken));
      access = t.accessToken;
      await db.withSystem((q) =>
        saveConnection(q, userId, { provider: c.provider, accessToken: seal(t.accessToken), refreshToken: t.refreshToken ? seal(t.refreshToken) : null, expiresAt: t.expiresAt }),
      );
    }
    const patches = await fetchDays(c.provider, access, addDays(today, -14), today, tz);
    await db.withSystem(async (q) => {
      for (const [date, patch] of patches) await upsertHealthDay(q, userId, date, c.provider, patch);
      await markSynced(q, userId, c.provider);
    });
  }
}

// --- One-tap sleep (iPhone-only users) ----------------------------------------------

function hhmm(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d);
}

export async function getSleepStart(userId: string): Promise<string | null> {
  const { db } = await getServices();
  return db.withUser(userId, (q) => getSleepStarted(q, userId)).catch(() => null);
}

/** "Going to bed": remembers the time on the server so any device can end it. */
export async function startSleep(userId: string): Promise<{ sleepStartedAt: string }> {
  const { db } = await getServices();
  const now = new Date();
  await db.withUser(userId, (q) => setSleepStarted(q, userId, now));
  return { sleepStartedAt: now.toISOString() };
}

/** "I'm awake": saves last night's sleep to today (sleep under 1 h or over 16 h is discarded as a mis-tap). */
export async function endSleep(userId: string, today: string): Promise<{ sleptMinutes: number | null }> {
  const { db } = await getServices();
  const started = await db.withUser(userId, (q) => getSleepStarted(q, userId));
  await db.withUser(userId, (q) => setSleepStarted(q, userId, null));
  if (!started) return { sleptMinutes: null };
  const start = new Date(started);
  const end = new Date();
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (minutes < 60 || minutes > 16 * 60) return { sleptMinutes: null };
  const profile = await db.withUser(userId, (q) => getProfile(q, userId));
  const tz = profile?.timezone ?? "UTC";
  await db.withUser(userId, (q) =>
    upsertHealthDay(q, userId, today, "phone", { sleepMinutes: minutes, bedTime: hhmm(start, tz), wakeTime: hhmm(end, tz) }),
  );
  return { sleptMinutes: minutes };
}
