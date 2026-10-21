import { describe, expect, it } from "vitest";
import { addDays, dateRange, localDayRange, startOfLocalDay, toLocalDate } from "@/lib/nutrition/dates";
import { analyzeTrend, projectToGoal, smoothWeights, type WeighIn } from "@/lib/nutrition/weight-trend";
import { evaluateAdaptiveTarget, type AdaptiveInput, type IntakeDay } from "@/lib/nutrition/adaptive";

describe("timezone-aware day boundaries", () => {
  it("assigns instants to the user's local calendar date", () => {
    const instant = new Date("2026-03-01T03:30:00Z");
    expect(toLocalDate(instant, "UTC")).toBe("2026-03-01");
    expect(toLocalDate(instant, "America/Los_Angeles")).toBe("2026-02-28");
    expect(toLocalDate(instant, "Asia/Kolkata")).toBe("2026-03-01");
  });

  it("computes local midnight in UTC", () => {
    expect(startOfLocalDay("2026-06-15", "America/New_York").toISOString()).toBe("2026-06-15T04:00:00.000Z");
    expect(startOfLocalDay("2026-01-15", "America/New_York").toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(startOfLocalDay("2026-06-15", "Asia/Kolkata").toISOString()).toBe("2026-06-14T18:30:00.000Z");
  });

  it("handles DST transition days (23 h and 25 h days)", () => {
    const spring = localDayRange("2026-03-08", "America/New_York");
    expect((spring.end.getTime() - spring.start.getTime()) / 3600000).toBe(23);
    const fall = localDayRange("2026-11-01", "America/New_York");
    expect((fall.end.getTime() - fall.start.getTime()) / 3600000).toBe(25);
  });

  it("adds days and builds ranges across month ends", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(dateRange("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

function series(start: string, days: number, fn: (i: number) => number, every = 1): WeighIn[] {
  const out: WeighIn[] = [];
  for (let i = 0; i < days; i += every) out.push({ date: addDays(start, i), weightKg: fn(i) });
  return out;
}

describe("weight trend", () => {
  it("smooths daily noise", () => {
    const noisy = series("2026-01-01", 28, (i) => 80 + (i % 2 === 0 ? 0.8 : -0.8));
    const pts = smoothWeights(noisy);
    const trendSwing = Math.max(...pts.slice(10).map((p) => p.trendKg)) - Math.min(...pts.slice(10).map((p) => p.trendKg));
    expect(trendSwing).toBeLessThan(0.4);
  });

  it("averages multiple weigh-ins on the same day", () => {
    const pts = smoothWeights([
      { date: "2026-01-01", weightKg: 80 },
      { date: "2026-01-01", weightKg: 81 },
    ]);
    expect(pts).toHaveLength(1);
    expect(pts[0].weightKg).toBe(80.5);
  });

  it("requires enough data before reporting a rate", () => {
    const t = analyzeTrend(series("2026-01-01", 5, () => 80));
    expect(t.sufficient).toBe(false);
    expect(t.ratePerWeekKg).toBeNull();
    expect(projectToGoal(t, 75).status).toBe("insufficient_data");
  });

  it("estimates a steady loss rate and a cautious projection range", () => {
    const t = analyzeTrend(
      series("2026-01-01", 42, (i) => 85 - (0.5 / 7) * i + (i % 3 === 0 ? 0.4 : -0.2)),
      42,
    );
    expect(t.sufficient).toBe(true);
    expect(t.ratePerWeekKg!).toBeLessThan(-0.25);
    const proj = projectToGoal(t, 78);
    expect(proj.status).toBe("projected");
    expect(proj.weeksRange![0]).toBeLessThanOrEqual(proj.weeksRange![1]);
    expect(proj.message).toMatch(/not a prediction or promise/);
  });

  it("does not project when the trend moves away from the target", () => {
    const t = analyzeTrend(series("2026-01-01", 28, (i) => 80 + 0.03 * i));
    expect(projectToGoal(t, 75).status).toBe("not_moving_toward_goal");
  });
});

function intake(start: string, days: number, kcal: number): IntakeDay[] {
  return Array.from({ length: days }, (_, i) => ({ date: addDays(start, i), caloriesKcal: kcal, mealCount: 3 }));
}

const adaptiveBase: AdaptiveInput = {
  today: "2026-02-01",
  enabled: true,
  goal: "lose",
  sex: "male",
  currentTargetKcal: 2200,
  priorTdeeKcal: 2640,
  plannedAdjustmentKcal: -440,
  intake: intake("2026-01-04", 28, 2200),
  weighIns: series("2026-01-04", 28, () => 80),
  lastSuggestionDate: null,
};

describe("adaptive targets", () => {
  it("does nothing when disabled", () => {
    expect(evaluateAdaptiveTarget({ ...adaptiveBase, enabled: false }).status).toBe("disabled");
  });

  it("never adjusts from a single weigh-in or a few days", () => {
    const r = evaluateAdaptiveTarget({
      ...adaptiveBase,
      intake: intake("2026-01-28", 4, 2200),
      weighIns: [{ date: "2026-01-30", weightKg: 82 }],
    });
    expect(r.status).toBe("insufficient_data");
    expect(r.suggestedTargetKcal).toBeNull();
  });

  it("suggests a small, capped decrease when weight is flat on a sustained deficit plan", () => {
    const r = evaluateAdaptiveTarget(adaptiveBase);
    // Flat weight at 2200 intake → observed TDEE 2200; blended 2420; implied 1980 → -220 capped to -150
    expect(r.status).toBe("suggest");
    expect(r.suggestedTargetKcal).toBe(2050);
    expect(r.reasons.join(" ")).toMatch(/accept, reject or postpone/);
  });

  it("requires a longer pattern before suggesting a decrease", () => {
    const r = evaluateAdaptiveTarget({
      ...adaptiveBase,
      intake: intake("2026-01-14", 18, 2200),
      weighIns: series("2026-01-14", 18, () => 80, 2),
    });
    expect(r.status).toBe("insufficient_data");
  });

  it("reports on-track when data agrees with the plan", () => {
    // Losing 0.4 kg/week at 2200 kcal → observed TDEE 2640 = prior
    const r = evaluateAdaptiveTarget({
      ...adaptiveBase,
      weighIns: series("2026-01-04", 28, (i) => 82 - (0.4 / 7) * i),
    });
    expect(r.status).toBe("on_track");
  });

  it("ignores incomplete logging days", () => {
    const sparse = adaptiveBase.intake.map((d, i) => (i % 2 ? { ...d, caloriesKcal: 400, mealCount: 1 } : d));
    const r = evaluateAdaptiveTarget({ ...adaptiveBase, intake: sparse });
    expect(r.data.completeDays).toBe(14);
  });

  it("never suggests below the safety floor", () => {
    const r = evaluateAdaptiveTarget({
      ...adaptiveBase,
      sex: "female",
      currentTargetKcal: 1250,
      priorTdeeKcal: 1700,
      plannedAdjustmentKcal: -450,
      intake: intake("2026-01-04", 28, 1250),
    });
    expect(r.suggestedTargetKcal === null || r.suggestedTargetKcal >= 1200).toBe(true);
  });

  it("respects the cooldown", () => {
    expect(evaluateAdaptiveTarget({ ...adaptiveBase, lastSuggestionDate: "2026-01-25" }).status).toBe("cooldown");
  });
});
