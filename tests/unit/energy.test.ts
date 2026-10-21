import { describe, expect, it } from "vitest";
import {
  ACTIVITY_LEVELS,
  EnergyInputError,
  estimateBmr,
  mifflinStJeor,
  planEnergy,
  suggestActivityLevel,
  validateEnergyInput,
  type EnergyInput,
} from "@/lib/nutrition/energy";

const base: EnergyInput = {
  ageYears: 30,
  sex: "male",
  heightCm: 180,
  weightKg: 80,
  activityLevel: "moderate",
  goal: "maintain",
};

describe("Mifflin–St Jeor", () => {
  it("computes the male equation", () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(mifflinStJeor("male", 80, 180, 30)).toBe(1780);
  });
  it("computes the female equation", () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 1345.25
    expect(mifflinStJeor("female", 60, 165, 25)).toBeCloseTo(1345.25, 5);
  });
  it("differs by exactly 166 kcal between variants", () => {
    expect(mifflinStJeor("male", 70, 170, 40) - mifflinStJeor("female", 70, 170, 40)).toBe(166);
  });
  it("averages variants and reports a range when the sex parameter is unspecified", () => {
    const e = estimateBmr({ sex: "unspecified", weightKg: 70, heightCm: 170, ageYears: 40 });
    const f = mifflinStJeor("female", 70, 170, 40);
    const m = mifflinStJeor("male", 70, 170, 40);
    expect(e.bmrKcal).toBeCloseTo((f + m) / 2);
    expect(e.range).toEqual([f, m]);
    expect(e.equation).toBe("mifflin_st_jeor_sex_averaged");
  });
});

describe("activity multipliers", () => {
  it("uses the documented factors", () => {
    expect(Object.fromEntries(Object.entries(ACTIVITY_LEVELS).map(([k, v]) => [k, v.multiplier]))).toEqual({
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      very: 1.725,
      extra: 1.9,
    });
  });
  it("TDEE = BMR × multiplier", () => {
    for (const level of Object.keys(ACTIVITY_LEVELS) as Array<keyof typeof ACTIVITY_LEVELS>) {
      const p = planEnergy({ ...base, activityLevel: level });
      expect(p.tdeeKcal).toBe(Math.round(1780 * ACTIVITY_LEVELS[level].multiplier));
    }
  });
  it("suggests one level from evidence instead of adding activity on top", () => {
    expect(suggestActivityLevel({})).toBeNull();
    expect(suggestActivityLevel({ averageDailySteps: 3000, occupationActivity: "desk", workoutsPerWeek: 0 })?.level).toBe("sedentary");
    expect(
      suggestActivityLevel({ averageDailySteps: 11000, occupationActivity: "standing", workoutsPerWeek: 4, workoutMinutes: 60 })?.level,
    ).toBe("very");
  });
});

describe("input validation", () => {
  it.each([
    [{ ageYears: 12 }, "Age"],
    [{ ageYears: 30.5 }, "Age"],
    [{ ageYears: 130 }, "Age"],
    [{ heightCm: 50 }, "Height"],
    [{ heightCm: 300 }, "Height"],
    [{ weightKg: -5 }, "Weight"],
    [{ weightKg: Number.NaN }, "Weight"],
    [{ activityLevel: "couch" as never }, "activity"],
  ])("rejects %o", (patch, msg) => {
    const issues = validateEnergyInput({ ...base, ...patch });
    expect(issues.join(" ")).toContain(msg);
    expect(() => planEnergy({ ...base, ...patch })).toThrow(EnergyInputError);
  });
});

describe("calorie targets", () => {
  it("maintenance = TDEE rounded to 10", () => {
    const p = planEnergy(base);
    expect(p.status).toBe("standard");
    expect(p.tdeeKcal).toBe(2759);
    expect(p.targetKcal).toBe(2760);
    expect(p.dailyAdjustmentKcal).toBe(0);
  });

  it("moderate loss = 0.5% body weight/week deficit", () => {
    const p = planEnergy({ ...base, goal: "lose", pace: "moderate" });
    // 0.4 kg/week * 7700 / 7 = 440 kcal/day
    expect(p.plannedRateKgPerWeek).toBeCloseTo(0.4, 2);
    expect(p.targetKcal).toBe(Math.round((1780 * 1.55 - 440) / 10) * 10);
    expect(p.dailyAdjustmentKcal).toBeLessThan(0);
  });

  it("caps the deficit at 25% of TDEE", () => {
    const p = planEnergy({ ...base, weightKg: 150, heightCm: 175, activityLevel: "sedentary", goal: "lose", pace: "faster" });
    const tdee = p.tdeeKcal!;
    expect(tdee - p.targetKcal!).toBeLessThanOrEqual(Math.ceil(tdee * 0.25) + 10);
    expect(p.adjustments.join(" ")).toMatch(/limited to 25%/);
  });

  it("downgrades the faster pace below BMI 25 and explains why", () => {
    const p = planEnergy({ ...base, weightKg: 72, goal: "lose", pace: "faster" });
    expect(p.pace).toBe("moderate");
    expect(p.adjustments.join(" ")).toMatch(/faster pace/);
  });

  it("never plans below the floor and never silently", () => {
    const p = planEnergy({
      ageYears: 60,
      sex: "female",
      heightCm: 150,
      weightKg: 58,
      activityLevel: "sedentary",
      goal: "lose",
      pace: "moderate",
    });
    expect(p.targetKcal).toBeGreaterThanOrEqual(1200);
    expect(p.adjustments.length).toBeGreaterThan(0);
  });

  it("does not offer weight loss when BMI < 18.5", () => {
    const p = planEnergy({ ...base, weightKg: 55, goal: "lose" });
    expect(p.goal).toBe("maintain");
    expect(p.requestedGoal).toBe("lose");
    expect(p.targetKcal).toBe(Math.round(p.tdeeKcal! / 10) * 10);
    expect(p.adjustments.join(" ")).toMatch(/BMI/);
  });

  it("weight gain uses a capped surplus", () => {
    const p = planEnergy({ ...base, goal: "gain", pace: "moderate" });
    expect(p.dailyAdjustmentKcal).toBeGreaterThan(200);
    expect(p.dailyAdjustmentKcal).toBeLessThanOrEqual(Math.round(p.tdeeKcal! * 0.2) + 10);
  });

  it("muscle gain does not allow the faster surplus and explains training is required", () => {
    const p = planEnergy({ ...base, goal: "muscle", pace: "faster" });
    expect(p.pace).toBe("moderate");
    expect(p.assumptions.join(" ")).toMatch(/resistance training/);
  });

  it("flags extra uncertainty for the unspecified pathway", () => {
    const p = planEnergy({ ...base, sex: "unspecified" });
    expect(p.bmrRange).not.toBeNull();
    expect(p.tdeeRange![1] - p.tdeeRange![0]).toBe(Math.round(1780 * 1.55) - Math.round((1780 - 166) * 1.55));
    expect(p.assumptions.join(" ")).toMatch(/averages the two/);
  });

  it.each([
    [{ ageYears: 16 }, /under 18/],
    [{ clinicalFlags: ["pregnant" as const] }, /pregnancy/],
    [{ clinicalFlags: ["breastfeeding" as const] }, /Breastfeeding/],
    [{ clinicalFlags: ["eating_disorder_history" as const] }, /disordered eating/],
  ])("returns tracking-only (no targets) for %o", (patch, reason) => {
    const p = planEnergy({ ...base, goal: "lose", ...patch });
    expect(p.status).toBe("tracking_only");
    expect(p.targetKcal).toBeNull();
    expect(p.tdeeKcal).toBeNull();
    expect(p.trackingOnlyReasons.join(" ")).toMatch(reason);
  });

  it("always documents assumptions and limitations", () => {
    const p = planEnergy(base);
    expect(p.assumptions.length).toBeGreaterThan(0);
    expect(p.limitations.join(" ")).toMatch(/estimate/);
  });
});

describe("goal timeline", () => {
  const base = { ageYears: 30, sex: "male" as const, heightCm: 180, weightKg: 90, activityLevel: "moderate" as const, goal: "lose" as const };
  it("plans the rate from target weight and weeks", () => {
    const p = planEnergy({ ...base, targetWeightKg: 85, targetWeeks: 20 });
    expect(p.plannedRateKgPerWeek).toBe(0.25);
    expect(p.timeline?.plannedWeeks).toBe(20);
    expect(p.timeline?.slowedForSafety).toBe(false);
    expect(p.timeline?.milestones.at(-1)).toEqual({ week: 20, weightKg: 85 });
  });
  it("slows an unsafe timeline and explains why", () => {
    const p = planEnergy({ ...base, targetWeightKg: 70, targetWeeks: 4 });
    expect(p.timeline?.slowedForSafety).toBe(true);
    expect(p.timeline!.plannedWeeks!).toBeGreaterThan(4);
    expect(p.adjustments.join(" ")).toMatch(/4 weeks/);
  });
});
