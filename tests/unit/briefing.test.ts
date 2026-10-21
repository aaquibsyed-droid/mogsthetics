import { describe, expect, it } from "vitest";
import { activityBonus, fastStage, streak, tipFor } from "@/lib/habits/briefing";

describe("briefing", () => {
  it("counts a streak through today or yesterday", () => {
    expect(streak(["2026-10-22", "2026-10-21", "2026-10-20", "2026-10-18"], "2026-10-22")).toBe(3);
    expect(streak(["2026-10-21", "2026-10-20"], "2026-10-22")).toBe(2);
    expect(streak(["2026-10-19"], "2026-10-22")).toBe(0);
  });

  it("gives an activity bonus only for real effort, capped", () => {
    expect(activityBonus(6, null).kcal).toBe(0);
    expect(activityBonus(8, { kind: "strength", done: true })).toMatchObject({ kcal: 150, proteinG: 15 });
    expect(activityBonus(16, null).kcal).toBe(270);
    expect(activityBonus(21, { kind: "cardio", done: true }).kcal).toBeLessThanOrEqual(500);
  });

  it("names fasting stages", () => {
    expect(fastStage(2).label).toBe("Digesting");
    expect(fastStage(13).label).toBe("Fat burning");
    expect(fastStage(30).label).toBe("Extended fast");
  });

  it("puts low recovery and nothing-logged first", () => {
    const base = { zone: null, sleepMinutes: 450, sleepDebtMinutes: 0, proteinLeftG: 20, mealsLogged: 2, hour: 12, waterPct: 1, workoutToday: false };
    expect(tipFor({ ...base, zone: "red" })).toMatch(/Recovery is low/);
    expect(tipFor({ ...base, mealsLogged: 0 })).toMatch(/Nothing logged/);
    expect(tipFor({ ...base, proteinLeftG: 80, hour: 17 })).toMatch(/80 g protein/);
  });
});
