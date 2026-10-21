"use client";

import { uid } from "@/lib/client/uid";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Database, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge, Notice, Skeleton } from "@/components/ui/misc";
import { api, errorMessage, useApi } from "@/lib/client/api";
import type { PersonalizedCoachingContext } from "@/lib/ai/schemas";
import type { CoachMessageRow } from "@/lib/repos/misc";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const STARTERS = [
  "How much protein do I have left today?",
  "What meals fit my remaining macros?",
  "How has my calorie intake changed this week?",
  "How is my weight trend going?",
  "Why might my weight trend differ from my target?",
];

/** Renders plain text with paragraphs and simple "- " lists (no HTML from the model). */
function Prose({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^\s*[-•*]\s+/, "").replace(/\*\*/g, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block.replace(/\*\*/g, "")}</p>;
      })}
    </div>
  );
}

export function CoachView() {
  const { data, error, setData, reload } = useApi<{
    messages: CoachMessageRow[];
    context: PersonalizedCoachingContext;
    provider: string;
    available: boolean;
  }>("/api/coach");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.messages.length]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setInput("");
    const optimistic: CoachMessageRow = {
      id: `tmp-${uid()}`,
      role: "user",
      content: message,
      grounding: null,
      isMock: false,
      createdAt: new Date().toISOString(),
    };
    setData((d) => (d ? { ...d, messages: [...d.messages, optimistic] } : d));
    try {
      const r = await api<{ reply: CoachMessageRow; userMessage: CoachMessageRow }>("/api/coach", { body: { message } });
      setData((d) => (d ? { ...d, messages: [...d.messages.filter((m) => m.id !== optimistic.id), r.userMessage, r.reply] } : d));
    } catch (e) {
      toast.error(errorMessage(e));
      setData((d) => (d ? { ...d, messages: d.messages.filter((m) => m.id !== optimistic.id) } : d));
      setInput(message);
    } finally {
      setSending(false);
    }
  }

  async function clear() {
    try {
      await api("/api/coach", { method: "DELETE" });
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return <Skeleton className="h-96" />;
  const c = data.context;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <section aria-label="Conversation" className="flex min-h-[60dvh] flex-col rounded-[var(--radius)] border border-rule bg-surface">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <div className="flex items-center gap-2">
            <h1 className="label-head text-lg">Coach</h1>
            {data.provider === "mock" ? <Badge tone="warn">development mock</Badge> : null}
          </div>
          {data.messages.length ? (
            <Button variant="ghost" size="sm" onClick={clear}>
              <Trash2 /> Clear
            </Button>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4" aria-live="polite">
          {data.messages.length === 0 ? (
            <div className="my-auto flex flex-col items-center gap-4 text-center">
              <p className="max-w-sm text-ink-soft">
                Ask about your day, your targets or your trends. Answers use the numbers Mogsthetics calculated from your own logs.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => send(s)} disabled={!data.available}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            data.messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-[15px]",
                  m.role === "user" ? "self-end bg-primary text-primary-ink" : "self-start bg-surface-2",
                )}
              >
                {m.role === "assistant" ? <Prose text={m.content} /> : m.content}
              </div>
            ))
          )}
          {sending ? (
            <div className="flex items-center gap-2 self-start text-sm text-ink-faint">
              <Loader2 className="size-4 animate-spin" /> Thinking…
            </div>
          ) : null}
          <div ref={end} />
        </div>
        <form
          className="flex items-end gap-2 border-t border-rule p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <label htmlFor="coach-input" className="sr-only">
            Message the coach
          </label>
          <Textarea
            id="coach-input"
            rows={1}
            maxLength={1500}
            className="min-h-11 resize-none"
            placeholder={data.available ? "Ask a question…" : "The coach isn't available right now"}
            value={input}
            disabled={!data.available}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim() || sending || !data.available}>
            <ArrowUp />
          </Button>
        </form>
        <p className="px-5 pb-3 text-[11px] text-ink-faint">
          General nutrition information, not medical advice. For medical conditions, pregnancy or disordered eating, please talk to a
          qualified professional.
        </p>
      </section>

      <aside aria-label="What the coach sees" className="flex flex-col gap-3 text-sm lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-[var(--radius)] border border-rule bg-surface p-4">
          <p className="flex items-center gap-2 font-medium">
            <Database className="size-4 text-primary" /> What the coach sees
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            Calculated by Mogsthetics from your saved data. The coach can&apos;t see anything else.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            <dt className="text-ink-soft">Target</dt>
            <dd className="font-mono">{c.profile.trackingOnly ? "not set" : `${fmtNum(c.targets.caloriesKcal)} kcal`}</dd>
            <dt className="text-ink-soft">Eaten today</dt>
            <dd className="font-mono">{fmtNum(c.today_totals.caloriesKcal)} kcal</dd>
            <dt className="text-ink-soft">Protein left</dt>
            <dd className="font-mono">{c.remaining.proteinG === null ? "—" : `${fmtNum(c.remaining.proteinG)} g`}</dd>
            <dt className="text-ink-soft">7-day average</dt>
            <dd className="font-mono">{c.last7Days.avgCaloriesKcal === null ? "—" : `${fmtNum(c.last7Days.avgCaloriesKcal)} kcal`}</dd>
            <dt className="text-ink-soft">Logged days</dt>
            <dd className="font-mono">{c.last7Days.loggedDays}/7</dd>
            <dt className="text-ink-soft">Weight trend</dt>
            <dd className="font-mono">
              {c.weight.ratePerWeekKg === null
                ? "not enough data"
                : `${c.weight.ratePerWeekKg > 0 ? "+" : ""}${c.weight.ratePerWeekKg} kg/wk`}
            </dd>
          </dl>
        </div>
      </aside>
    </div>
  );
}
