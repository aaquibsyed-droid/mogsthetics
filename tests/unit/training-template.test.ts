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
