"use client";

import { useState } from "react";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/client/api";
import type { AdaptiveSuggestionRow } from "@/lib/repos/misc";
import { fmtNum } from "@/lib/format";

/** A pending adaptive-target suggestion: explained, and never applied without the user's choice. */
export function AdaptiveCard({ suggestion, onDecided }: { suggestion: AdaptiveSuggestionRow; onDecided: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const up = suggestion.suggestedTargetKcal > suggestion.previousTargetKcal;
  async function decide(decision: "accept" | "reject" | "postpone") {
    setBusy(decision);
    try {
      await api(`/api/adaptive/${suggestion.id}`, { body: { decision } });
      toast.success(
        decision === "accept"
          ? `Target updated to ${fmtNum(suggestion.suggestedTargetKcal)} kcal from today`
          : decision === "postpone"
            ? "We'll ask again in a week"
            : "Suggestion dismissed",
      );
      onDecided();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-label="Suggested target adjustment" className="card-soft rounded-[var(--radius)] border border-primary/30 bg-surface px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-ink">
          {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="font-semibold">New daily target suggested</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            {fmtNum(suggestion.previousTargetKcal)} → <strong className="text-ink">{fmtNum(suggestion.suggestedTargetKcal)} kcal</strong>, based
            on your recent progress.
          </p>
          <details className="mt-1 text-sm">
            <summary className="cursor-pointer text-primary">Why?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-ink-soft">
              {suggestion.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => decide("accept")} disabled={!!busy}>
              {busy === "accept" ? <Loader2 className="animate-spin" /> : null} Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => decide("postpone")} disabled={!!busy}>
              Later
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decide("reject")} disabled={!!busy}>
              No thanks
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
