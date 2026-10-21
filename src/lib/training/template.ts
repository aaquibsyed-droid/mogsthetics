import type { TrainingPlan } from "@/lib/ai/schemas";
import { guideFor } from "./guide";

export type TrainingGoal = "lose" | "maintain" | "gain";
export type Equipment = "none" | "dumbbells" | "gym";
export type Experience = "beginner" | "intermediate" | "advanced";

export interface TrainingRequest {
  goal: TrainingGoal;
  daysPerWeek: number;
  minutes: number;
  equipment: Equipment;
  experience: Experience;
  limitations: string;
}

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Spread training days across the week so rest days fall between sessions. */
const SCHEDULE: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

type Ex = TrainingPlan["days"][number]["exercises"][number];
type Day = TrainingPlan["days"][number];

const LIFTS: Record<Equipment, Record<"squat" | "hinge" | "push" | "pull" | "press" | "lunge" | "core", string>> = {
  none: { squat: "Bodyweight squat", hinge: "Single-leg hip bridge", push: "Push-up", pull: "Towel row (door)", press: "Pike push-up", lunge: "Reverse lunge", core: "Plank" },
  dumbbells: { squat: "Goblet squat", hinge: "Dumbbell Romanian deadlift", push: "Dumbbell floor press", pull: "One-arm dumbbell row", press: "Dumbbell shoulder press", lunge: "Dumbbell split squat", core: "Dead bug" },
  gym: { squat: "Barbell back squat", hinge: "Romanian deadlift", push: "Bench press", pull: "Lat pulldown", press: "Overhead press", lunge: "Walking lunge", core: "Cable crunch" },
};

function ex(name: string, sets: number | null, reps: string | null, restSeconds: number | null, note: string | null = null): Ex {
  return { name, sets, reps, restSeconds, note, howTo: guideFor(name).cues };
}

function strengthDay(r: TrainingRequest, variant: "full" | "upper" | "lower", n: number): Day {
  const l = LIFTS[r.equipment];
  const sets = r.experience === "beginner" ? 3 : r.experience === "intermediate" ? 3 : 4;
  const reps = r.goal === "gain" ? "8–12" : r.goal === "lose" ? "10–12" : "8–10";
  const rest = r.goal === "gain" ? 90 : 60;
  const moves =
    variant === "upper"
      ? [l.push, l.pull, l.press, n % 2 ? "Incline push-up" : "Face pull / band pull-apart", l.core]
      : variant === "lower"
        ? [l.squat, l.hinge, l.lunge, "Calf raise", l.core]
        : n % 2
          ? [l.hinge, l.push, l.lunge, l.pull, l.core]
          : [l.squat, l.pull, l.hinge, l.press, l.core];
  const fit = r.minutes <= 30 ? 4 : 5;
  const exercises = moves.slice(0, fit).map((m, i) =>
    i === moves.length - 1 && m === l.core ? ex(m, 3, "30–45s", 45) : ex(m, sets, reps, rest, i === 0 ? "Leave 1–2 reps in the tank." : null),
  );
  if (r.goal === "lose" && r.minutes >= 45) exercises.push(ex("Incline walk or bike finisher", null, "10 min", null, "Moderate pace, able to talk."));
  const focus = variant === "full" ? "Full-body strength" : variant === "upper" ? "Upper-body strength" : "Lower-body strength";
  return { day: "", focus, kind: "strength", minutes: r.minutes, exercises };
}

function cardioDay(r: TrainingRequest): Day {
  const mins = Math.max(20, r.minutes - 5);
  return r.experience === "beginner"
    ? { day: "", focus: "Easy cardio", kind: "cardio", minutes: mins, exercises: [ex("Brisk walk, cycle or swim", null, `${mins} min`, null, "Zone 2: you can talk in full sentences.")] }
    : {
        day: "",
        focus: "Intervals",
        kind: "cardio",
        minutes: mins,
        exercises: [
          ex("Warm-up", null, "5 min", null, "Easy pace."),
          ex("Hard / easy intervals", 6, "1 min hard · 2 min easy", null, "Bike, rower, run or incline walk."),
          ex("Steady cardio", null, `${Math.max(5, mins - 23)} min`, null, "Comfortable pace."),
        ],
      };
}

function restDay(): Day {
  return { day: "", focus: "Rest & recover", kind: "rest", minutes: 20, exercises: [ex("Easy walk", null, "20–30 min", null, null), ex("Mobility: hips, hamstrings, upper back", null, "10 min", null, null)] };
}

/** Deterministic plan used when AI is unavailable. Always valid and safe. */
export function templatePlan(r: TrainingRequest): TrainingPlan {
  const days = Math.min(6, Math.max(2, Math.round(r.daysPerWeek)));
  const sessions: Day[] = [];
  const strengthCount = r.goal === "gain" ? days : r.goal === "lose" ? Math.min(days, Math.max(2, days - Math.floor(days / 2))) : Math.ceil(days * 0.6);
  const split = strengthCount >= 4 ? (["upper", "lower"] as const) : (["full"] as const);
  for (let i = 0; i < strengthCount; i++) sessions.push(strengthDay(r, split[i % split.length], i));
  for (let i = strengthCount; i < days; i++) sessions.push(cardioDay(r));
  const slots = SCHEDULE[days];
  const week = WEEK.map((day, i) => {
    const idx = slots.indexOf(i);
    return { ...(idx >= 0 ? sessions[idx] : restDay()), day };
  });
  const goalLine = r.goal === "lose" ? "lose fat while keeping muscle" : r.goal === "gain" ? "build muscle" : "stay strong, fit and healthy";
  return {
    title: `${days}-day ${r.goal === "gain" ? "muscle" : r.goal === "lose" ? "fat-loss" : "fitness"} plan`,
    summary: `${days} sessions a week, about ${r.minutes} minutes each, built to help you ${goalLine}.`,
    weeklyNotes: [
      r.goal === "lose" ? "Aim for 7,000–10,000 steps a day; it burns more than most workouts." : "Get 7,000+ steps a day for recovery and heart health.",
      "Hit your protein target every day so training turns into muscle.",
      "Warm up 5 minutes before lifting: light cardio plus a lighter first set.",
      "Sleep 7–9 hours; it is when you recover and get stronger.",
    ],
    days: week,
    progression: [
      "When you hit the top of the rep range on every set, add a little weight next time.",
      "Add one set to your main lifts in weeks 3–4 if recovery feels good.",
      "Every 5th week, ease off: same exercises, about half the sets.",
      ...(r.limitations.trim() ? ["Skip any move that causes pain and swap it for a gentler version."] : []),
    ],
  };
}
