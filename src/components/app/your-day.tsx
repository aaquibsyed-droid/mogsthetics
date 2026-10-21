"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BedDouble, Check, Flame, Hourglass, Loader2, Pill, Plus, Sparkles, Sun, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import { fastStage } from "@/lib/habits/briefing";
import { fmtHm } from "@/lib/health/recovery";
import type { Briefing } from "@/lib/services/briefing";
import type { TrainingState } from "@/lib/services/training";
import { cn } from "@/lib/utils";
import { ZONE_COLOR } from "./recovery-view";
import { KIND_ICON } from "./training-view";

const hourNow = () => new Date().getHours();

function useNow(everyMs: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs, active]);
  return now;
}

/** Home "Your day": one place for sleep, recovery, today's workout, fasting, supplements and the next best step. */
export function YourDay({ b, onChange }: { b: Briefing; onChange: (b: Briefing) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const hour = hourNow();

  async function run(key: string, fn: () => Promise<Briefing | void>, success?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (r) onChange(r);
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const refresh = () => api<Briefing>(`/api/briefing?hour=${hourNow()}`);

  const sleepAction = async (action: "start" | "end") => {
    const r = await api<{ sleptMinutes?: number | null }>("/api/recovery/sleep", { body: { action } });
    if (action === "end") toast.success(r.sleptMinutes ? `Good morning! You slept ${fmtHm(r.sleptMinutes)}.` : "Good morning!");
    else toast.success("Sleep well. Tap “I'm awake” in the morning.");
    return refresh();
  };

  const w = b.workout;
  const WIcon = w ? (w.done ? Check : KIND_ICON[w.kind as keyof typeof KIND_ICON] ?? Check) : null;
  const r = b.recovery;

  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-5">
        <div className="mb-1 flex items-center justify-between">
          <p className="label-head text-lg">Your day</p>
          {b.streak > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-primary" title="Days in a row with food logged">
              <Flame className="size-3.5" /> {b.streak}-day streak
            </span>
          ) : null}
        </div>
        <p className="mb-2 flex gap-2 rounded-2xl bg-surface-2 px-3 py-2.5 text-sm">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" /> {b.tip}
        </p>

        {/* Sleep & recovery */}
        <Row
          icon={
            b.sleepStartedAt ? (
              <BedDouble className="size-5" />
            ) : r?.score != null ? (
              <span className="text-[13px] font-semibold">{r.score}</span>
            ) : (
              <BedDouble className="size-5" />
            )
          }
          ring={!b.sleepStartedAt && r?.zone ? ZONE_COLOR[r.zone] : undefined}
          title={b.sleepStartedAt ? "Sleeping" : r?.score != null ? `Recovery ${r.score}%` : "Sleep"}
          sub={
            b.sleepStartedAt
              ? `Since ${new Date(b.sleepStartedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : b.sleepMinutes != null
                ? `Slept ${fmtHm(b.sleepMinutes)}${b.strain != null ? ` · Strain ${b.strain}` : ""}`
                : "Tap when you go to bed and wake up. No watch needed."
          }
          href="/recovery"
          action={
            b.sleepStartedAt ? (
              <Button size="sm" variant="accent" disabled={!!busy} onClick={() => run("sleep", () => sleepAction("end"))}>
                {busy === "sleep" ? <Loader2 className="animate-spin" /> : <Sun />} I&apos;m awake
              </Button>
            ) : hour >= 18 || hour < 4 ? (
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("sleep", () => sleepAction("start"))}>
                {busy === "sleep" ? <Loader2 className="animate-spin" /> : <BedDouble />} Going to bed
              </Button>
            ) : b.sleepMinutes == null ? (
              <Button size="sm" variant="outline" asChild>
                <Link href="/recovery">Log sleep</Link>
              </Button>
            ) : null
          }
        />

        {/* Workout */}
        {w && WIcon ? (
          <Row
            icon={<WIcon className="size-5" />}
            filled={w.done}
            title={w.kind === "rest" ? "Rest day" : "Today's workout"}
            sub={`${w.focus}${w.kind !== "rest" ? ` · ${w.minutes} min` : ""}`}
            href="/training"
            action={
              w.kind !== "rest" ? (
                <Button
                  size="sm"
                  variant={w.done ? "subtle" : "accent"}
                  disabled={!!busy}
                  aria-pressed={w.done}
                  onClick={() =>
                    run(
                      "workout",
                      async () => {
                        await api<TrainingState>("/api/training", { method: "PATCH", body: { date: b.today, focus: w.focus, done: !w.done } });
                        return refresh();
                      },
                      w.done ? undefined : "Workout done. Nice work!",
                    )
                  }
                >
                  <Check /> {w.done ? "Done" : "Mark done"}
                </Button>
              ) : null
            }
          />
        ) : (
          <Row icon={<Plus className="size-5" />} title="Get a training plan" sub="Workouts built on your goal" href="/training" />
        )}

        {b.habitsReady ? <FastRow b={b} busy={busy} run={run} /> : null}
        {b.habitsReady ? <Supplements b={b} busy={busy} run={run} /> : null}
      </CardContent>
    </Card>
  );
}

function Row({
  icon,
  title,
  sub,
  href,
  action,
  ring,
  filled,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  href?: string;
  action?: React.ReactNode;
  ring?: string;
  filled?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn("grid size-11 shrink-0 place-items-center rounded-full", filled ? "bg-primary text-primary-ink" : "bg-tint text-primary", ring && "border-[4px] bg-transparent text-ink")}
        style={ring ? { borderColor: ring } : undefined}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-tight">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{sub}</span>
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-3 border-t border-rule/60 py-3 first-of-type:border-t-0">
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
          {body}
          {!action ? <ArrowRight className="size-4 shrink-0 text-ink-faint" /> : null}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {action}
    </div>
  );
}

type Run = (key: string, fn: () => Promise<Briefing | void>, success?: string) => Promise<void>;

function FastRow({ b, busy, run }: { b: Briefing; busy: string | null; run: Run }) {
  const [goal, setGoal] = useState("16");
  const now = useNow(30_000, !!b.fast);
  if (b.fast) {
    const hours = (now - new Date(b.fast.startedAt).getTime()) / 3_600_000;
    const pct = Math.min(1, hours / b.fast.goalHours);
    const stage = fastStage(hours);
    return (
      <div className="border-t border-rule/60 py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-tint text-primary">
            <Hourglass className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight">
              Fasting · {fmtHm(hours * 60)}
              <span className="font-normal text-ink-soft"> / {b.fast.goalHours} h</span>
            </span>
            <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">
              {stage.label}: {stage.detail}
            </span>
          </span>
          <Button size="sm" variant={pct >= 1 ? "accent" : "outline"} disabled={!!busy} onClick={() => run("fast", () => api<Briefing>("/api/fasting", { body: { action: "end", hour: hourNow() } }), "Fast ended.")}>
            End
          </Button>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="hero-card h-full rounded-full transition-[width] duration-700" style={{ width: `${pct * 100}%` }} />
        </div>
      </div>
    );
  }
  const last = b.lastFast?.endedAt ? (new Date(b.lastFast.endedAt).getTime() - new Date(b.lastFast.startedAt).getTime()) / 60000 : null;
  return (
    <Row
      icon={<Hourglass className="size-5" />}
      title="Fasting"
      sub={last ? `Last fast: ${fmtHm(last)}` : "Optional: track an eating window"}
      action={
        <div className="flex items-center gap-1.5">
          <Select aria-label="Fast length" className="h-8 w-[74px] px-2 text-xs" value={goal} onChange={(e) => setGoal(e.target.value)}>
            {[12, 14, 16, 18, 20, 24].map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("fast", () => api<Briefing>("/api/fasting", { body: { action: "start", goalHours: Number(goal), hour: hourNow() } }), "Fast started.")}>
            Start
          </Button>
        </div>
      }
    />
  );
}

function Supplements({ b, busy, run }: { b: Briefing; busy: string | null; run: Run }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const taken = b.supplements.filter((s) => s.taken).length;
  return (
    <div className="border-t border-rule/60 py-3">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-tint text-primary">
          <Pill className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-tight">Supplements & meds</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{b.supplements.length ? `${taken} of ${b.supplements.length} taken today` : "Add vitamins, creatine, meds…"}</span>
        </span>
        <Button size="icon-sm" variant="outline" aria-label={adding ? "Done editing" : "Add or edit supplements"} onClick={() => setAdding((v) => !v)}>
          {adding ? <X /> : <Plus />}
        </Button>
      </div>
      {b.supplements.length ? (
        <div className="mt-2 flex flex-wrap gap-2 pl-14">
          {b.supplements.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.taken}
              disabled={!!busy}
              aria-label={adding ? `Remove ${s.name}` : undefined}
              onClick={() =>
                adding
                  ? run(`sup-${s.id}`, () => api<Briefing>(`/api/supplements?id=${s.id}&hour=${hourNow()}`, { method: "DELETE" }), `Removed ${s.name}.`)
                  : run(`sup-${s.id}`, () => api<Briefing>("/api/supplements", { method: "PATCH", body: { id: s.id, taken: !s.taken, hour: hourNow() } }))
              }
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition",
                s.taken ? "border-primary bg-primary text-primary-ink" : "border-rule bg-surface text-ink hover:bg-surface-2",
              )}
            >
              {adding ? <X className="size-3.5" /> : s.taken ? <Check className="size-3.5" /> : null}
              {s.name}
              {s.dose ? <span className="opacity-70">{s.dose}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {adding ? (
        <form
          className="mt-2 flex gap-2 pl-14"
          onSubmit={(e) => {
            e.preventDefault();
            // "Vitamin D 1000 IU" → name + dose; "Omega 3" stays a name.
            const m = name.trim().match(/^(.*?)\s+(\d[\d.,]*\s*(?:mg|g|mcg|µg|iu|ml|caps?|capsules?|tabs?|tablets?|scoops?)\b.*)$/i);
            const n = (m ? m[1] : name).trim();
            if (!n) return;
            void run("sup-add", () => api<Briefing>("/api/supplements", { body: { name: n.slice(0, 80), dose: (m?.[2] ?? "").slice(0, 60), hour: hourNow() } })).then(() => {
              setName("");
              setAdding(false);
            });
          }}
        >
          <Input autoFocus placeholder="e.g. Vitamin D 1000 IU" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="sm" variant="accent" disabled={busy === "sup-add"}>
            Add
          </Button>
        </form>
      ) : null}
      {b.supplements.length ? <p className="mt-1.5 pl-14 text-[11px] text-ink-faint">{adding ? "Tap one to remove it." : "Tap to tick off. Tap + to add or remove."}</p> : null}
    </div>
  );
}
