/**
 * WHOOP-style daily scores from raw metrics.
 * Recovery (0–100%): HRV and resting HR against the person's own 30-day baseline, plus sleep vs need.
 * Strain (0–21): logarithmic load from active calories, steps and completed workouts.
 */
export interface HealthDay {
  date: string;
  sleepMinutes: number | null;
  sleepEfficiency: number | null;
  bedTime: string | null;
  wakeTime: string | null;
  hrvMs: number | null;
  restingHr: number | null;
  steps: number | null;
  activeKcal: number | null;
  deviceRecovery: number | null;
  deviceStrain: number | null;
  source: string;
}

export interface Baselines {
  hrvMs: number | null;
  restingHr: number | null;
  sleepMinutes: number | null;
}

export type Zone = "green" | "yellow" | "red";

export interface RecoveryScore {
  score: number | null;
  zone: Zone | null;
  /** What drove the score, in plain language. */
  drivers: string[];
  fromDevice: boolean;
}

const SLEEP_NEED_MIN = 8 * 60;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Baselines from the days before `date` (up to 30), needing at least 3 readings each. */
export function baselines(days: HealthDay[], date: string): Baselines {
  const prior = days.filter((d) => d.date < date).slice(-30);
  const pick = (f: (d: HealthDay) => number | null) => {
    const xs = prior.map(f).filter((x): x is number => x != null);
    return xs.length >= 3 ? mean(xs) : null;
  };
  return { hrvMs: pick((d) => d.hrvMs), restingHr: pick((d) => d.restingHr), sleepMinutes: pick((d) => d.sleepMinutes) };
}

export function zoneOf(score: number): Zone {
  return score >= 67 ? "green" : score >= 34 ? "yellow" : "red";
}

export function recoveryFor(day: HealthDay | undefined, base: Baselines): RecoveryScore {
  if (!day) return { score: null, zone: null, drivers: [], fromDevice: false };
  if (day.deviceRecovery != null) {
    const s = Math.round(day.deviceRecovery);
    return { score: s, zone: zoneOf(s), drivers: [`Recovery from your ${day.source === "whoop" ? "WHOOP" : day.source === "oura" ? "Oura ring" : "device"}.`], fromDevice: true };
  }
  const parts: Array<{ w: number; v: number }> = [];
  const drivers: string[] = [];
  if (day.hrvMs != null && base.hrvMs) {
    const r = day.hrvMs / base.hrvMs; // 1 = baseline
    parts.push({ w: 0.5, v: clamp(50 + (r - 1) * 200, 0, 100) });
    drivers.push(r >= 1.05 ? "HRV is above your normal: your body is well recovered." : r <= 0.9 ? "HRV is below your normal: stress, alcohol, illness or hard training can do this." : "HRV is about your normal.");
  }
  if (day.restingHr != null && base.restingHr) {
    const d = day.restingHr - base.restingHr; // beats above baseline
    parts.push({ w: 0.25, v: clamp(60 - d * 8, 0, 100) });
    if (d >= 3) drivers.push(`Resting heart rate is ${Math.round(d)} bpm above normal.`);
    else if (d <= -2) drivers.push("Resting heart rate is lower than normal, a good sign.");
  }
  if (day.sleepMinutes != null) {
    const r = day.sleepMinutes / SLEEP_NEED_MIN;
    parts.push({ w: day.hrvMs != null && base.hrvMs ? 0.25 : 0.6, v: clamp(r * 100 - 5, 0, 100) });
    const short = SLEEP_NEED_MIN - day.sleepMinutes;
    drivers.push(short > 45 ? `You slept ${fmtHm(short)} less than the 8 h most adults need.` : "You got close to a full night's sleep.");
  }
  if (!parts.length) return { score: null, zone: null, drivers: ["Add sleep, HRV or resting heart rate to see your recovery."], fromDevice: false };
  const s = Math.round(parts.reduce((a, p) => a + p.w * p.v, 0) / parts.reduce((a, p) => a + p.w, 0));
  if (day.hrvMs == null || !base.hrvMs) drivers.push("Connect a device with HRV for a more accurate score.");
  return { score: s, zone: zoneOf(s), drivers, fromDevice: false };
}

/** 0–21 day strain. ~10 is a normal active day; 18+ is very hard. */
export function strainFor(day: HealthDay | undefined, workoutDone: boolean): number | null {
  if (day?.deviceStrain != null) return Math.round(day.deviceStrain * 10) / 10;
  const kcal = day?.activeKcal ?? (day?.steps != null ? day.steps * 0.04 : null);
  if (kcal == null && !workoutDone) return null;
  const load = (kcal ?? 0) + (workoutDone ? 300 : 0);
  return Math.round(clamp(21 * (1 - Math.exp(-load / 900)), 0, 21) * 10) / 10;
}

export function guidance(zone: Zone | null): string {
  if (zone === "green") return "You're well recovered. Good day to push hard or go for a personal best.";
  if (zone === "yellow") return "Moderately recovered. Train as planned but don't chase maximum effort.";
  if (zone === "red") return "Low recovery. Swap hard training for a walk or mobility, and prioritise sleep tonight.";
  return "Log your sleep or connect a device to get daily guidance.";
}

export function fmtHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h${m ? ` ${m} m` : ""}` : `${m} m`;
}
