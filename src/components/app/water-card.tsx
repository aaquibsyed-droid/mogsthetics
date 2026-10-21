"use client";

import { useState } from "react";
import { Droplet, Minus, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { api, errorMessage, useApi } from "@/lib/client/api";
import type { WaterDay } from "@/lib/repos/water";
import { fmtNum } from "@/lib/format";

const GLASS_ML = 250;

/** Water: one tap per glass, undo, adjustable goal. Guidance only — needs vary with climate, activity and food. */
export function WaterCard({ today }: { today: string }) {
  const { data, setData } = useApi<WaterDay>(`/api/water?date=${today}`);
  const [busy, setBusy] = useState(false);

  async function add(ml: number) {
    setBusy(true);
    try {
      setData(await api<WaterDay>("/api/water", { body: { ml, localDate: today } }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function undo() {
    const last = data?.entries.at(-1);
    if (!last) return;
    setBusy(true);
    try {
      await api(`/api/water/${last.id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, entries: d.entries.slice(0, -1), totalMl: d.totalMl - last.ml } : d));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function goal(delta: number) {
    if (!data) return;
    const goalMl = Math.min(6000, Math.max(500, data.goalMl + delta));
    try {
      setData(await api<WaterDay>("/api/water", { body: { goalMl } }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (!data) return <Skeleton className="h-40" />;
  const glasses = Math.max(1, Math.round(data.goalMl / GLASS_ML));
  const filled = Math.min(glasses, Math.floor(data.totalMl / GLASS_ML));
  return (
    <section aria-label="Water" className="card-soft rounded-[var(--radius)] border border-rule/70 bg-surface p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="label-head text-base">water</h2>
        <p className="font-mono text-xs text-ink-faint" data-testid="water-total">
          {fmtNum(data.totalMl)} / {fmtNum(data.goalMl)} ml
        </p>
      </div>
      <div
        className="mt-4 flex flex-wrap gap-1.5"
        role="meter"
        aria-label="Water today"
        aria-valuenow={data.totalMl}
        aria-valuemin={0}
        aria-valuemax={data.goalMl}
      >
        {Array.from({ length: glasses }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={i < filled ? "glaze size-6 rounded-full" : "size-6 rounded-full border border-rule bg-surface-2"}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="accent" onClick={() => add(GLASS_ML)} disabled={busy}>
          <Droplet /> +{GLASS_ML} ml
        </Button>
        <Button size="sm" variant="outline" onClick={() => add(500)} disabled={busy}>
          +500 ml
        </Button>
        <Button size="sm" variant="ghost" onClick={undo} disabled={busy || !data.entries.length} aria-label="Undo last drink">
          <Undo2 /> undo
        </Button>
        <span className="ml-auto flex items-center gap-1 text-xs text-ink-faint">
          goal
          <Button size="icon-sm" variant="ghost" aria-label="Lower water goal" onClick={() => goal(-250)}>
            <Minus />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Raise water goal" onClick={() => goal(250)}>
            <Plus />
          </Button>
        </span>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">A general guide — needs vary with activity, climate and the water in your food.</p>
    </section>
  );
}
