import { describe, expect, it } from "vitest";
import { baselines, recoveryFor, strainFor, zoneOf, type HealthDay } from "@/lib/health/recovery";

const day = (date: string, p: Partial<HealthDay> = {}): HealthDay => ({
  date,
  sleepMinutes: null,
  sleepEfficiency: null,
  bedTime: null,
  wakeTime: null,
  hrvMs: null,
  restingHr: null,
  steps: null,
  activeKcal: null,
  deviceRecovery: null,
  deviceStrain: null,
  source: "manual",
  ...p,
});
const history = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((d) => day(d, { hrvMs: 50, restingHr: 60, sleepMinutes: 450 }));

describe("recovery", () => {
  it("needs 3 prior readings for a baseline", () => {
    expect(baselines(history.slice(0, 2), "2026-10-05").hrvMs).toBeNull();
    expect(baselines(history, "2026-10-05")).toEqual({ hrvMs: 50, restingHr: 60, sleepMinutes: 450 });
  });

  it("is green with high HRV, low RHR and a full night", () => {
    const r = recoveryFor(day("2026-10-05", { hrvMs: 62, restingHr: 57, sleepMinutes: 490 }), baselines(history, "2026-10-05"));
    expect(r.zone).toBe("green");
  });

  it("is red with suppressed HRV, raised RHR and short sleep", () => {
    const r = recoveryFor(day("2026-10-05", { hrvMs: 32, restingHr: 68, sleepMinutes: 280 }), baselines(history, "2026-10-05"));
    expect(r.zone).toBe("red");
    expect(r.drivers.join(" ")).toMatch(/HRV is below/);
  });

  it("works from sleep alone, and prefers a device score", () => {
    expect(recoveryFor(day("2026-10-05", { sleepMinutes: 480 }), { hrvMs: null, restingHr: null, sleepMinutes: null }).score).toBe(95);
    const dev = recoveryFor(day("2026-10-05", { deviceRecovery: 41, source: "whoop", sleepMinutes: 480 }), baselines(history, "2026-10-05"));
    expect(dev).toMatchObject({ score: 41, zone: "yellow", fromDevice: true });
  });

  it("zones and strain scale", () => {
    expect([zoneOf(80), zoneOf(50), zoneOf(10)]).toEqual(["green", "yellow", "red"]);
    expect(strainFor(undefined, false)).toBeNull();
    const easy = strainFor(day("d", { steps: 4000 }), false)!;
    const hard = strainFor(day("d", { activeKcal: 900 }), true)!;
    expect(easy).toBeLessThan(hard);
    expect(hard).toBeLessThanOrEqual(21);
  });
});
