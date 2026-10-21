"use client";

import { useState } from "react";
import { Check, ChevronDown, Dumbbell, HeartPulse, Loader2, Moon, PlayCircle, Sparkles, StretchHorizontal, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Notice, Skeleton } from "@/components/ui/misc";
import { api, errorMessage, useApi } from "@/lib/client/api";
import type { TrainingPlan } from "@/lib/ai/schemas";
import { guideFor } from "@/lib/training/guide";
import type { HealthOverview } from "@/lib/services/health";
import type { TrainingState } from "@/lib/services/training";
import { cn } from "@/lib/utils";
import { ExerciseDemo } from "./exercise-demo";

const STORAGE_KEY = "ascend.training.v1";
const GOAL_LABEL = { lose: "Lose fat", maintain: "Stay fit", gain: "Build muscle" } as const;
export const KIND_ICON = { strength: Dumbbell, cardio: HeartPulse, mixed: Dumbbell, mobility: StretchHorizontal, rest: Moon } as const;

type Settings = { daysPerWeek: number; minutes: number; equipment: string; experience: string; limitations: string };
const DEFAULTS: Settings = { daysPerWeek: 3, minutes: 45, equipment: "dumbbells", experience: "beginner", limitations: "" };

/** Plans made before account sync (or while the server can't store them) live on this device. */
function devicePlan(): { plan: TrainingPlan; settings: Settings } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return saved?.data?.plan ? { plan: saved.data.plan, settings: { ...DEFAULTS, ...saved.settings } } : null;
  } catch {
    return null;
  }
}

export function TrainingView() {
  const state = useApi<TrainingState>("/api/training");
  const health = useApi<HealthOverview>("/api/recovery");
  const rec = health.data?.todayRecovery;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<number | null>(null);

  const s = state.data;
  const local = s && !s.plan && typeof window !== "undefined" ? devicePlan() : null;
  const plan = s?.plan ?? local?.plan ?? null;
  const settings: Settings = { ...DEFAULTS, ...(s?.settings as Partial<Settings> | null), ...(s?.plan ? {} : local?.settings) };
  const todayIdx = s ? s.week.findIndex((w) => w.date === s.today) : -1;
  const shownDay = openDay ?? todayIdx;

  async function build(input: Settings) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<TrainingState>("/api/training", { body: input });
      state.setData(res);
      setOpenDay(null);
      try {
        if (res.synced) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, JSON.stringify({ data: { plan: res.plan }, settings: input }));
      } catch {
        // Device storage unavailable; the plan still shows.
      }
      toast.success("Your new plan is ready.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDone(i: number) {
    if (!s || !plan) return;
    const day = s.week[i];
    try {
      const res = await api<TrainingState>("/api/training", { method: "PATCH", body: { date: day.date, focus: plan.days[i].focus, done: !day.done } });
      state.setData({ ...res, plan: res.plan ?? s.plan });
      if (!day.done) toast.success("Workout done. Nice work!");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (state.loading && !s)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  if (state.error && !s) return <Notice tone="danger">{state.error}</Notice>;
  if (!s) return null;

  const trainingDays = plan ? plan.days.filter((d) => d.kind !== "rest").length : 0;
  const doneCount = plan ? s.week.filter((w, i) => w.done && plan.days[i]?.kind !== "rest").length : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="pr-12 lg:pr-0">
        <h1 className="label-num text-[32px]">Training</h1>
        <p className="mt-1 text-ink-soft">A weekly plan built around your goal: {GOAL_LABEL[s.goal].toLowerCase()}. Change your goal in Profile.</p>
      </header>

      <PlanForm key={JSON.stringify(settings)} initial={settings} busy={busy} hasPlan={!!plan} onBuild={build} />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {plan && rec?.zone ? (
        <Notice tone={rec.zone === "green" ? "good" : rec.zone === "yellow" ? "info" : "warn"} title={`Recovery ${rec.score}%`}>
          {rec.zone === "green"
            ? "You're well recovered: a great day to add weight or an extra set."
            : rec.zone === "yellow"
              ? "Train as planned, but keep a rep or two in the tank."
              : "Low recovery: swap today's hard session for a walk or mobility, and get to bed early."}
        </Notice>
      ) : null}
      {busy && !plan ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Your coach is writing your week…
        </p>
      ) : null}

      {plan ? (
        <>
          <section className="hero-card rounded-[28px] p-5 text-white sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow !text-white/75">{GOAL_LABEL[s.goal]}</p>
              {(s.source ?? "ai") === "ai" && s.plan ? (
                <span className="flex items-center gap-1 text-xs text-white/80">
                  <Sparkles className="size-3.5" /> Personalised by AI
                </span>
              ) : null}
            </div>
            <h2 className="label-num mt-2 text-2xl !text-white">{plan.title}</h2>
            <p className="mt-1 text-sm text-white/85">{plan.summary}</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${trainingDays ? (doneCount / trainingDays) * 100 : 0}%` }} />
              </div>
              <span className="text-sm font-medium" data-testid="week-progress">
                {doneCount}/{trainingDays} done this week
              </span>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {plan.days.map((d, i) => {
                const Icon = s.week[i]?.done ? Check : KIND_ICON[d.kind];
                return (
                  <button
                    key={d.day}
                    type="button"
                    onClick={() => setOpenDay(i)}
                    aria-pressed={shownDay === i}
                    aria-label={`${d.day}: ${d.focus}${s.week[i]?.done ? ", done" : ""}`}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-medium transition",
                      shownDay === i ? "bg-white text-ink" : d.kind === "rest" ? "bg-white/10 text-white/70" : "bg-white/20 text-white",
                      i === todayIdx && shownDay !== i && "ring-2 ring-white/70",
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
            {plan.days.map((d, i) => (
              <DayCard
                key={d.day}
                day={d}
                isToday={i === todayIdx}
                open={shownDay === i}
                done={!!s.week[i]?.done}
                canComplete={s.synced && d.kind !== "rest" && i <= todayIdx}
                onToggle={() => setOpenDay(shownDay === i ? -1 : i)}
                onDone={() => toggleDone(i)}
              />
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TipList title="This week" items={plan.weeklyNotes} />
            <TipList title="How to progress" items={plan.progression} />
          </div>
          {!s.synced ? <Notice tone="info">This plan is saved on this device only for now. Workout tracking turns on once account sync is set up.</Notice> : null}
          <p className="text-xs text-ink-faint">General fitness guidance, not medical advice. Stop any exercise that causes pain and check with a doctor if you have a health condition.</p>
        </>
      ) : null}
    </div>
  );
}

function PlanForm({ initial, busy, hasPlan, onBuild }: { initial: Settings; busy: boolean; hasPlan: boolean; onBuild: (s: Settings) => void }) {
  const [f, setF] = useState(initial);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-3 pt-5 sm:grid-cols-4">
        <Field label="Days a week" htmlFor="td">
          <Select id="td" value={f.daysPerWeek} onChange={(e) => set("daysPerWeek", Number(e.target.value))}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Session length" htmlFor="tm">
          <Select id="tm" value={f.minutes} onChange={(e) => set("minutes", Number(e.target.value))}>
            {[20, 30, 45, 60, 75, 90].map((n) => (
              <option key={n} value={n}>
                {n} min
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Equipment" htmlFor="te">
          <Select id="te" value={f.equipment} onChange={(e) => set("equipment", e.target.value)}>
            <option value="none">No equipment</option>
            <option value="dumbbells">Dumbbells at home</option>
            <option value="gym">Full gym</option>
          </Select>
        </Field>
        <Field label="Experience" htmlFor="tx">
          <Select id="tx" value={f.experience} onChange={(e) => set("experience", e.target.value)}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </Field>
        <Field label="Injuries or limits (optional)" htmlFor="tl" className="col-span-2 sm:col-span-3">
          <Input id="tl" placeholder="e.g. sore knees, no jumping" value={f.limitations} maxLength={300} onChange={(e) => set("limitations", e.target.value)} />
        </Field>
        <Button variant="accent" className="col-span-2 self-end sm:col-span-1" onClick={() => onBuild(f)} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} {busy ? "Building…" : hasPlan ? "Rebuild plan" : "Build my plan"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DayCard({
  day: d,
  isToday,
  open,
  done,
  canComplete,
  onToggle,
  onDone,
}: {
  day: TrainingPlan["days"][number];
  isToday: boolean;
  open: boolean;
  done: boolean;
  canComplete: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const Icon = done ? Check : KIND_ICON[d.kind];
  const [openEx, setOpenEx] = useState<number | null>(null);
  return (
    <Card className={cn(isToday && "ring-2 ring-primary/40")}>
      <button type="button" className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left" onClick={onToggle} aria-expanded={open}>
        <span className="flex items-center gap-3">
          <span className={cn("grid size-10 place-items-center rounded-full", done ? "bg-primary text-primary-ink" : d.kind === "rest" ? "bg-surface-2 text-ink-soft" : "bg-tint text-primary")}>
            <Icon className="size-5" />
          </span>
          <span>
            <span className="label-head block">
              {d.day}
              {isToday ? <Badge className="ml-2">Today</Badge> : null}
            </span>
            <span className="text-sm text-ink-soft">
              {d.focus}
              {d.kind !== "rest" ? ` · ${Math.round(d.minutes)} min` : ""}
            </span>
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <CardContent className="pt-0">
          <p className="mb-1 text-xs text-ink-faint">Tap an exercise to see how to do it.</p>
          <ol className="flex flex-col divide-y divide-rule/70">
            {d.exercises.map((x, i) => (
              <ExerciseRow key={i} ex={x} open={openEx === i} onToggle={() => setOpenEx(openEx === i ? null : i)} />
            ))}
          </ol>
          {canComplete ? (
            <Button variant={done ? "subtle" : "accent"} className="mt-3 w-full" onClick={onDone}>
              <Check /> {done ? "Done. Tap to undo" : "Mark workout done"}
            </Button>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function ExerciseRow({ ex: x, open, onToggle }: { ex: TrainingPlan["days"][number]["exercises"][number]; open: boolean; onToggle: () => void }) {
  const guide = guideFor(x.name);
  const steps = (x.howTo?.length ? x.howTo : guide.cues).map((st) => st.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, ""));
  return (
    <li className="py-2.5">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="flex items-start gap-2">
          <PlayCircle className={cn("mt-0.5 size-4 shrink-0", open ? "text-primary" : "text-ink-faint")} />
          <span>
            <span className="block font-medium">{x.name}</span>
            {x.note ? <span className="text-sm text-ink-soft">{x.note}</span> : null}
          </span>
        </span>
        <span className="shrink-0 text-right text-sm">
          {x.sets ? `${x.sets} × ` : ""}
          {x.reps ?? ""}
          {x.restSeconds ? <span className="block text-xs text-ink-faint">rest {x.restSeconds}s</span> : null}
        </span>
      </button>
      {open ? (
        <div className="mt-3 grid gap-4 rounded-2xl bg-surface-2 p-4 sm:grid-cols-[160px_1fr]">
          <ExerciseDemo pattern={guide.pattern} className="mx-auto size-40 text-primary" />
          <div>
            <p className="label-head mb-2">How to do it</p>
            <ol className="flex flex-col gap-2 text-sm">
              {steps.map((st, i) => (
                <li key={i} className="flex gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-ink">{i + 1}</span>
                  <span className="text-ink-soft">{st}</span>
                </li>
              ))}
            </ol>
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`how to do ${x.name} proper form`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <PlayCircle className="size-4" /> Watch a video demo
            </a>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function TipList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="label-head mb-2">{title}</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-soft">
          {items.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
