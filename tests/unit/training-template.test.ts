import { describe, expect, it } from "vitest";
import { TrainingPlanSchema } from "@/lib/ai/schemas";
import { templatePlan } from "@/lib/training/template";

describe("templatePlan", () => {
  for (const goal of ["lose", "maintain", "gain"] as const)
    for (const daysPerWeek of [2, 3, 4, 5, 6])
      it(`${goal}, ${daysPerWeek} days: valid week with the right number of sessions`, () => {
        const plan = templatePlan({ goal, daysPerWeek, minutes: 45, equipment: "gym", experience: "intermediate", limitations: "" });
        expect(TrainingPlanSchema.safeParse(plan).success).toBe(true);
        expect(plan.days.map((d) => d.day)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
        expect(plan.days.filter((d) => d.kind !== "rest")).toHaveLength(daysPerWeek);
      });

  it("uses bodyweight moves with no equipment", () => {
    const plan = templatePlan({ goal: "lose", daysPerWeek: 3, minutes: 30, equipment: "none", experience: "beginner", limitations: "knees" });
    const names = plan.days.flatMap((d) => d.exercises.map((e) => e.name)).join(" ");
    expect(names).not.toMatch(/barbell|dumbbell|cable/i);
    expect(plan.progression.join(" ")).toMatch(/pain/);
  });
});

describe("templatePlan focus", () => {
  const base = { goal: "maintain" as const, daysPerWeek: 4, minutes: 45, equipment: "gym" as const, experience: "intermediate" as const, limitations: "" };
  it("endurance is mostly cardio with a long session", () => {
    const plan = templatePlan({ ...base, focus: "endurance" });
    expect(plan.days.filter((d) => d.kind === "cardio").length).toBeGreaterThanOrEqual(3);
    expect(plan.days.some((d) => d.focus === "Long easy session")).toBe(true);
  });
  it("strength uses low reps and long rests", () => {
    const ex = templatePlan({ ...base, focus: "strength" }).days.find((d) => d.kind === "strength")!.exercises[0];
    expect(ex.reps).toBe("4–6");
    expect(ex.restSeconds).toBe(150);
  });
  it("mobility adds mobility days", () => {
    expect(templatePlan({ ...base, focus: "mobility" }).days.some((d) => d.kind === "mobility")).toBe(true);
  });
  it("names the user's own goal", () => {
    const plan = templatePlan({ ...base, focus: "endurance", goalText: "Run a 5K by March", focusAreas: ["Legs"] });
    expect(plan.title).toBe("Your plan: Run a 5K by March");
    expect(plan.summary).toMatch(/run a 5K by March|Run a 5K by March/);
    expect(plan.summary).toMatch(/Legs/);
  });
});
