import { describe, expect, it } from "vitest";
import { CUES, POSES, patternFor } from "@/lib/training/guide";

describe("patternFor", () => {
  it.each([
    ["Goblet squat", "squat"],
    ["Dumbbell Romanian deadlift", "hinge"],
    ["Push-up", "pushup"],
    ["Bench press", "pushup"],
    ["One-arm dumbbell row", "row"],
    ["Lat pulldown", "row"],
    ["Overhead press", "press"],
    ["Bulgarian split squat", "lunge"],
    ["Walking lunge", "lunge"],
    ["Plank", "plank"],
    ["Dead bug", "plank"],
    ["Single-leg hip bridge", "bridge"],
    ["Brisk walk, cycle or swim", "cardio"],
    ["Rowing machine intervals", "cardio"],
    ["Calf raise", "calf"],
    ["Hammer curl", "curl"],
    ["Hip mobility flow", "stretch"],
  ])("%s → %s", (name, pattern) => expect(patternFor(name)).toBe(pattern));

  it("has two poses and cues for every pattern", () => {
    for (const p of Object.keys(POSES) as Array<keyof typeof POSES>) {
      expect(POSES[p]).toHaveLength(2);
      expect(CUES[p].length).toBeGreaterThanOrEqual(3);
    }
  });
});
