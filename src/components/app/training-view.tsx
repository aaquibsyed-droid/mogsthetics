"use client";

import { useEffect, useState } from "react";
import { Dumbbell, HeartPulse, Loader2, Moon, Sparkles, StretchHorizontal, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Notice } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/client/api";
import type { TrainingPlan } from "@/lib/ai/schemas";
import { cn } from "@/lib/utils";

interface PlanResponse {
  plan: TrainingPlan;
  goal: "lose" | "maintain" | "gain";
  source: "ai" | "template";
}

const STORAGE_KEY = "ascend.training.v1";
const GOAL_LABEL = { lose: "Lose fat", maintain: "Stay fit", gain: "Build muscle" } as const;
const KIND_ICON = { strength: Dumbbell, cardio: HeartPulse, mixed: Dumbbell, mobility: StretchHorizontal, rest: Moon } as const;

function todayName() {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

export function TrainingView({ goalType }: { goalType: string | null }) {
  const [days, setDays] = useState("3");
  const [minutes, setMinutes] = useState("45");
  const [equipment, setEquipment] = useState("dumbbells");
  const [experience, setExperience] = useState("beginner");
  const [limitations, setLimitations] = useState("");
  const [data, setData] = useState<PlanResponse | null>(null);
  const [open, setOpen] = useState<string>(todayName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore the last plan on this device (after hydration, so server and client markup match).
  const restore = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved?.data?.plan) {
        setData(saved.data);
        if (saved.form) {
          setDays(saved.form.days);
          setMinutes(saved.form.minutes);
          setEquipment(saved.form.equipment);
          setExperience(saved.form.experience);
          setLimitations(saved.form.limitations ?? "");
        }
      }
    } catch {
      // Storage unavailable; start fresh.
    }
  };
  useEffect(() => {
    void Promise.resolve().then(restore);
  }, []);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<PlanResponse>("/api/training", {
        body: { daysPerWeek: Number(days), minutes: Number(minutes), equipment, experience, limitations },
      });
      setData(res);
      setOpen(todayName());
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ data: res, form: { days, minutes, equipment, experience, limitations } }));
      } catch {
        // Not saved on this device; the plan still shows.
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const goal = data?.goal ?? (goalType === "lose" ? "lose" : goalType === "gain" || goalType === "muscle" ? "gain" : "maintain");
  const plan = data?.plan;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="label-num text-[32px]">Training</h1>
        <p className="mt-1 text-ink-soft">A weekly plan built around your goal: {GOAL_LABEL[goal].toLowerCase()}. Change your goal in Profile.</p>
      </header>

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 pt-5 sm:grid-cols-4">
          <Field label="Days a week" htmlFor="td">
            <Select id="td" value={days} onChange={(e) => setDays(e.target.value)}>
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Session length" htmlFor="tm">
            <Select id="tm" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
              {[20, 30, 45, 60, 75, 90].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Equipment" htmlFor="te">
            <Select id="te" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
              <option value="none">No equipment</option>
              <option value="dumbbells">Dumbbells at home</option>
              <option value="gym">Full gym</option>
            </Select>
          </Field>
          <Field label="Experience" htmlFor="tx">
            <Select id="tx" value={experience} onChange={(e) => setExperience(e.target.value)}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </Select>
          </Field>
          <Field label="Injuries or limits (optional)" htmlFor="tl" className="col-span-2 sm:col-span-3">
            <Input id="tl" placeholder="e.g. sore knees, no jumping" value={limitations} maxLength={300} onChange={(e) => setLimitations(e.target.value)} />
          </Field>
          <Button variant="accent" className="col-span-2 self-end sm:col-span-1" onClick={build} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} {busy ? "Building…" : plan ? "Rebuild plan" : "Build my plan"}
          </Button>
        </CardContent>
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {busy && !plan ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Your coach is writing your week…
        </p>
      ) : null}

      {plan ? (
        <>
          <section className="hero-card rounded-[28px] p-5 text-white sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow !text-white/75">{GOAL_LABEL[goal]}</p>
              {data?.source === "ai" ? (
                <span className="flex items-center gap-1 text-xs text-white/80">
                  <Sparkles className="size-3.5" /> Personalised by AI
                </span>
              ) : null}
            </div>
            <h2 className="label-num mt-2 text-2xl !text-white">{plan.title}</h2>
            <p className="mt-1 text-sm text-white/85">{plan.summary}</p>
            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {plan.days.map((d) => {
                const Icon = KIND_ICON[d.kind];
                return (
                  <button
                    key={d.day}
                    type="button"
                    onClick={() => setOpen(d.day)}
                    aria-pressed={open === d.day}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-medium transition",
                      open === d.day ? "bg-white text-ink" : d.kind === "rest" ? "bg-white/8 text-white/70" : "bg-white/18 text-white",
                    )}
                  >
                    {d.day.slice(0, 3)}
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
          </section>

          <div className="flex flex-col gap-3">
            {plan.days.map((d) => {
              const Icon = KIND_ICON[d.kind];
              const isOpen = open === d.day;
              return (
                <Card key={d.day} className={cn(d.day === todayName() && "ring-2 ring-primary/40")}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left" onClick={() => setOpen(isOpen ? "" : d.day)} aria-expanded={isOpen}>
                    <span className="flex items-center gap-3">
                      <span className={cn("grid size-10 place-items-center rounded-full", d.kind === "rest" ? "bg-surface-2 text-ink-soft" : "bg-tint text-primary")}>
                        <Icon className="size-5" />
                      </span>
                      <span>
                        <span className="label-head block">
                          {d.day}
                          {d.day === todayName() ? <Badge className="ml-2">Today</Badge> : null}
                        </span>
                        <span className="text-sm text-ink-soft">
                          {d.focus}
                          {d.kind !== "rest" ? ` · ${Math.round(d.minutes)} min` : ""}
                        </span>
                      </span>
                    </span>
                  </button>
                  {isOpen ? (
                    <CardContent className="pt-0">
                      <ol className="flex flex-col divide-y divide-rule/70">
                        {d.exercises.map((x, i) => (
                          <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                            <span>
                              <span className="block font-medium">{x.name}</span>
                              {x.note ? <span className="text-sm text-ink-soft">{x.note}</span> : null}
                            </span>
                            <span className="shrink-0 text-right text-sm">
                              {x.sets ? `${x.sets} × ` : ""}
                              {x.reps ?? ""}
                              {x.restSeconds ? <span className="block text-xs text-ink-faint">rest {x.restSeconds}s</span> : null}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </CardContent>
                  ) : null}
                </Card>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="pt-5">
                <p className="label-head mb-2">This week</p>
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-soft">
                  {plan.weeklyNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="label-head mb-2">How to progress</p>
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-soft">
                  {plan.progression.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-ink-faint">General fitness guidance, not medical advice. Stop any exercise that causes pain and check with a doctor if you have a health condition.</p>
        </>
      ) : null}
    </div>
  );
}
