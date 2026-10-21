"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtNum } from "@/lib/format";
import { kgToLb } from "@/lib/nutrition/units";

const axis = { fontSize: 11, fill: "var(--ink-faint)", fontFamily: "var(--font-plex-mono)" };

function dayLabel(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).slice(0, 2);
}

export function WeeklyCaloriesChart({
  days,
}: {
  days: Array<{ date: string; kcal: number | null; target: number | null; logged: boolean }>;
}) {
  const target = days.at(-1)?.target ?? null;
  const data = days.map((d) => ({ ...d, label: dayLabel(d.date), kcal: d.logged ? Math.round(d.kcal ?? 0) : null }));
  return (
    <figure>
      <div className="h-44 w-full" role="img" aria-label={`Calories for the last ${days.length} days`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axis} />
            <YAxis tickLine={false} axisLine={false} tick={axis} width={48} tickFormatter={(v) => Number(v).toLocaleString("en-US")} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 10, fontSize: 12 }}
              formatter={(v) => [v == null ? "not logged" : `${fmtNum(Number(v))} kcal`, "Calories"]}
              labelFormatter={(_, p) => (p?.[0]?.payload?.date as string) ?? ""}
            />
            {target ? <ReferenceLine y={target} stroke="var(--ink)" strokeDasharray="4 3" ifOverflow="extendDomain" /> : null}
            <Bar dataKey="kcal" fill="var(--secondary)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        {data.map((d) => `${d.date}: ${d.kcal === null ? "not logged" : `${d.kcal} kcal`}`).join("; ")}
      </figcaption>
    </figure>
  );
}

export function WeightTrendChart({
  points,
  units,
  targetKg,
  height = 240,
}: {
  points: Array<{ date: string; weightKg: number; trendKg: number }>;
  units: "metric" | "imperial";
  targetKg: number | null;
  height?: number;
}) {
  const conv = (kg: number) => Math.round((units === "imperial" ? kgToLb(kg) : kg) * 10) / 10;
  const data = points.map((p) => ({
    date: p.date,
    t: Date.parse(`${p.date}T12:00:00Z`),
    weight: conv(p.weightKg),
    trend: conv(p.trendKg),
  }));
  const unit = units === "imperial" ? "lb" : "kg";
  return (
    <figure>
      <div className="w-full" style={{ height }} role="img" aria-label="Weight readings and smoothed trend">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickLine={false}
              axisLine={false}
              tick={axis}
              tickFormatter={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              minTickGap={32}
            />
            <YAxis tickLine={false} axisLine={false} tick={axis} domain={["dataMin - 1", "dataMax + 1"]} width={48} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 10, fontSize: 12 }}
              labelFormatter={(t) =>
                new Date(Number(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
              }
              formatter={(v, n) => [`${fmtNum(Number(v), 1)} ${unit}`, n === "trend" ? "Trend" : "Weigh-in"]}
            />
            {targetKg ? (
              <ReferenceLine
                y={conv(targetKg)}
                stroke="var(--secondary)"
                strokeDasharray="5 4"
                label={{ value: "target", position: "insideTopRight", fontSize: 10, fill: "var(--secondary)" }}
              />
            ) : null}
            <Scatter dataKey="weight" fill="var(--ink-faint)" isAnimationActive={false} />
            <Line dataKey="trend" type="monotone" stroke="var(--primary)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 flex items-center gap-4 text-[11px] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-ink-faint" /> weigh-ins
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-primary" /> smoothed trend
        </span>
      </figcaption>
    </figure>
  );
}
