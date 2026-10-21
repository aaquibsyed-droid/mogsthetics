"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Apple, Smartphone, Sun, BedDouble, Check, Copy, Footprints, HeartPulse, Link2, Loader2, Moon, Plus, Watch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Badge, Notice, Skeleton } from "@/components/ui/misc";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { fmtHm, type Zone } from "@/lib/health/recovery";
import type { HealthOverview } from "@/lib/services/health";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export const ZONE_COLOR: Record<Zone, string> = { green: "#3ddc97", yellow: "#ffd166", red: "#ff6b6b" };
const ZONE_LABEL: Record<Zone, string> = { green: "Ready to push", yellow: "Steady", red: "Take it easy" };
const DEVICE_NAME = { whoop: "WHOOP", oura: "Oura Ring" } as const;

export function RecoveryView() {
  const h = useApi<HealthOverview>("/api/recovery");
  const params = useSearchParams();
  const router = useRouter();
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => {
    const device = params.get("device") as keyof typeof DEVICE_NAME | null;
    const status = params.get("status");
    if (!device || !status) return;
    if (status === "connected") toast.success(`${DEVICE_NAME[device] ?? "Device"} connected. Your data is syncing.`);
    else toast.error(`Couldn't connect ${DEVICE_NAME[device] ?? "the device"}. Please try again.`);
    router.replace("/recovery");
  }, [params, router]);

  if (h.loading && !h.data)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64" />
        <Skeleton className="h-40" />
      </div>
    );
  if (h.error && !h.data) return <Notice tone="danger">{h.error}</Notice>;
  const d = h.data;
  if (!d) return null;
  const today = d.days.find((x) => x.date === d.today);
  const last14 = d.days.slice(-14);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-3 pr-12 lg:pr-0">
        <div>
          <h1 className="label-num text-[32px]">Recovery</h1>
          <p className="mt-1 text-ink-soft">Sleep, heart and strain in one place, so you know how hard to go today.</p>
        </div>
      </header>

      {!d.synced ? <Notice tone="info">Recovery tracking is being set up on the server. Check back soon.</Notice> : null}

      <RecoveryHero overview={d} onLog={() => setLogOpen(true)} reload={h.reload} />

      {logOpen ? <LogSheet today={d.today} initial={today} onClose={() => setLogOpen(false)} onSaved={(o) => h.setData(o)} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          icon={BedDouble}
          label="Sleep"
          value={today?.sleepMinutes != null ? fmtHm(today.sleepMinutes) : "–"}
          sub={d.sleepDebtMinutes ? `${fmtHm(d.sleepDebtMinutes)} sleep debt this week` : d.baselines.sleepMinutes ? `Avg ${fmtHm(d.baselines.sleepMinutes)}` : "Need: 7–9 h"}
          series={last14.map((x) => x.sleepMinutes)}
        />
        <MetricTile
          icon={Activity}
          label="HRV"
          value={today?.hrvMs != null ? `${Math.round(today.hrvMs)} ms` : "–"}
          sub={d.baselines.hrvMs ? `Your normal: ${Math.round(d.baselines.hrvMs)} ms` : "Higher is better"}
          series={last14.map((x) => x.hrvMs)}
        />
        <MetricTile
          icon={HeartPulse}
          label="Resting HR"
          value={today?.restingHr != null ? `${Math.round(today.restingHr)} bpm` : "–"}
          sub={d.baselines.restingHr ? `Your normal: ${Math.round(d.baselines.restingHr)} bpm` : "Lower is better"}
          series={last14.map((x) => x.restingHr)}
        />
        <MetricTile
          icon={Footprints}
          label="Steps"
          value={today?.steps != null ? fmtNum(today.steps) : "–"}
          sub="Goal: 8,000+"
          series={last14.map((x) => x.steps)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last 14 days</CardTitle>
        </CardHeader>
        <CardContent>
          {last14.some((x) => x.recovery != null) ? (
            <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Daily recovery for the last 14 days">
              {last14.map((x) => (
                <div key={x.date} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-ink-faint">{x.recovery ?? ""}</span>
                  <div
                    className="w-full rounded-md"
                    title={`${x.date}: ${x.recovery ?? "no"}% recovery, strain ${x.strain ?? "–"}`}
                    style={{ height: `${Math.max(4, (x.recovery ?? 0) * 0.9)}px`, background: x.recovery != null ? ZONE_COLOR[x.recovery >= 67 ? "green" : x.recovery >= 34 ? "yellow" : "red"] : "var(--color-rule)" }}
                  />
                  <span className="text-[10px] text-ink-faint">{new Date(`${x.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow" })}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Your recovery trend appears here after a few days of sleep data.</p>
          )}
        </CardContent>
      </Card>

      <Devices overview={d} reload={h.reload} />
      <p className="text-xs text-ink-faint">Recovery and strain are wellness estimates, not medical measurements.</p>
    </div>
  );
}

export function RecoveryRing({ score, zone, size = 150 }: { score: number | null; zone: Zone | null; size?: number }) {
  const r = 60;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" className="size-full -rotate-90" aria-hidden>
        <circle cx="70" cy="70" r={r} fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="12" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={zone ? ZONE_COLOR[zone] : "transparent"}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (score ?? 0) / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="label-num text-[30px] !text-white">{score != null ? `${score}%` : "–"}</span>
        <span className="text-[11px] font-medium text-white/80">recovery</span>
      </div>
    </div>
  );
}

function RecoveryHero({ overview: d, onLog, reload }: { overview: HealthOverview; onLog: () => void; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  async function sleep(action: "start" | "end") {
    setBusy(true);
    try {
      const r = await api<{ sleptMinutes?: number | null }>("/api/recovery/sleep", { body: { action } });
      toast.success(action === "start" ? "Sleep well. Tap “I'm awake” in the morning." : r.sleptMinutes ? `Good morning! You slept ${fmtHm(r.sleptMinutes)}.` : "Good morning!");
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const r = d.todayRecovery;
  const today = d.days.find((x) => x.date === d.today);
  return (
    <section className="hero-card rounded-[28px] p-5 text-white sm:p-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow !text-white/75">Today</p>
        {r.zone ? (
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-ink" style={{ background: ZONE_COLOR[r.zone] }}>
            {ZONE_LABEL[r.zone]}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-5">
        <RecoveryRing score={r.score} zone={r.zone} />
        <dl className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <dt className="text-xs text-white/70">Strain</dt>
            <dd className="label-num text-2xl !text-white">{d.todayStrain ?? "–"}<span className="text-sm font-normal text-white/70"> / 21</span></dd>
          </div>
          <div>
            <dt className="text-xs text-white/70">Sleep</dt>
            <dd className="label-num text-2xl !text-white">{today?.sleepMinutes != null ? fmtHm(today.sleepMinutes) : "–"}</dd>
          </div>
        </dl>
      </div>
      <p className="mt-4 text-sm font-medium">{d.guidance}</p>
      {r.drivers.length ? (
        <ul className="mt-2 flex flex-col gap-1 text-sm text-white/80">
          {r.drivers.map((x, i) => (
            <li key={i}>• {x}</li>
          ))}
        </ul>
      ) : null}
      {d.synced ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {d.sleepStartedAt ? (
            <Button className="bg-white text-ink hover:bg-white/90" disabled={busy} onClick={() => sleep("end")}>
              <Sun /> I&apos;m awake
            </Button>
          ) : (
            <Button className="bg-white text-ink hover:bg-white/90" disabled={busy} onClick={() => sleep("start")}>
              <Moon /> Going to bed
            </Button>
          )}
          <Button variant="subtle" className="bg-white/15 text-white hover:bg-white/25" onClick={onLog}>
            <Plus /> Log manually
          </Button>
        </div>
      ) : null}
      {d.sleepStartedAt ? <p className="mt-2 text-center text-xs text-white/80">Sleeping since {new Date(d.sleepStartedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p> : null}
    </section>
  );
}

function MetricTile({ icon: Icon, label, value, sub, series }: { icon: typeof Moon; label: string; value: string; sub: string; series: Array<number | null> }) {
  const nums = series.filter((x): x is number => x != null);
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, max);
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
          <Icon className="size-3.5 text-primary" /> {label}
        </p>
        <p className="label-num mt-1 text-xl">{value}</p>
        <p className="mt-0.5 text-[11px] text-ink-faint">{sub}</p>
        <div className="mt-2 flex h-8 items-end gap-[3px]" aria-hidden>
          {series.map((x, i) => (
            <div
              key={i}
              className={cn("flex-1 rounded-sm", i === series.length - 1 ? "bg-primary" : "bg-primary/30")}
              style={{ height: x == null ? 2 : `${20 + ((x - min) / Math.max(1, max - min)) * 80}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LogSheet({ today, initial, onClose, onSaved }: { today: string; initial?: HealthOverview["days"][number]; onClose: () => void; onSaved: (o: HealthOverview) => void }) {
  const [date, setDate] = useState(today);
  const [bed, setBed] = useState("23:00");
  const [wake, setWake] = useState("07:00");
  const [hrv, setHrv] = useState(initial?.hrvMs != null ? String(Math.round(initial.hrvMs)) : "");
  const [rhr, setRhr] = useState(initial?.restingHr != null ? String(Math.round(initial.restingHr)) : "");
  const [steps, setSteps] = useState(initial?.steps != null ? String(initial.steps) : "");
  const [busy, setBusy] = useState(false);
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const slept = (toMin(wake) - toMin(bed) + 1440) % 1440;

  async function save() {
    setBusy(true);
    try {
      const num = (s: string) => (s.trim() ? Number(s) : undefined);
      const o = await api<HealthOverview>("/api/recovery", {
        body: { localDate: date, sleepMinutes: slept || undefined, bedTime: bed, wakeTime: wake, hrvMs: num(hrv), restingHr: num(rhr), steps: num(steps) },
      });
      onSaved(o);
      toast.success("Saved.");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log sleep & vitals</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Field label="Morning of" htmlFor="hd" className="col-span-2">
          <Input id="hd" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Went to bed" htmlFor="hb">
          <Input id="hb" type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
        </Field>
        <Field label="Woke up" htmlFor="hw">
          <Input id="hw" type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
        </Field>
        <p className="col-span-2 -mt-1 text-sm text-ink-soft">That&apos;s {fmtHm(slept)} of sleep.</p>
        <Field label="HRV (ms, optional)" htmlFor="hh">
          <Input id="hh" inputMode="decimal" value={hrv} onChange={(e) => setHrv(e.target.value)} placeholder="e.g. 55" />
        </Field>
        <Field label="Resting HR (optional)" htmlFor="hr">
          <Input id="hr" inputMode="numeric" value={rhr} onChange={(e) => setRhr(e.target.value)} placeholder="e.g. 58" />
        </Field>
        <Field label="Steps (optional)" htmlFor="hs" className="col-span-2">
          <Input id="hs" inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="e.g. 8200" />
        </Field>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="accent" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />} Save
        </Button>
      </CardContent>
    </Card>
  );
}

function Devices({ overview: d, reload }: { overview: HealthOverview; reload: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showApple, setShowApple] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function newToken() {
    setBusy(true);
    try {
      setToken((await api<{ token: string }>("/api/recovery/token", { body: {} })).token);
      setShowApple(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(p: string) {
    try {
      await api(`/api/devices/${p}`, { method: "DELETE" });
      toast.success("Disconnected.");
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.success("Copied."));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected devices</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-rule/70">
        <div className="flex items-start gap-3 py-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-tint text-primary">
            <Smartphone className="size-5" />
          </span>
          <span>
            <span className="label-head block">Just your iPhone</span>
            <span className="text-sm text-ink-soft">
              Tap <b>Going to bed</b> and <b>I&apos;m awake</b> (here or on Home). For automatic tracking, set a sleep schedule in the Health app (Health → Sleep →
              Set Up). Your iPhone then records time in bed, which the Apple Health shortcut below sends to Ascend.
            </span>
          </span>
        </div>
        <div className="py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-tint text-primary">
                <Apple className="size-5" />
              </span>
              <span>
                <span className="label-head block">Apple Health</span>
                <span className="text-sm text-ink-soft">Apple Watch, Garmin, Fitbit, Eight Sleep and more via Health</span>
              </span>
            </span>
            {d.appleHealth.connected ? <Badge tone="good">Linked</Badge> : null}
          </div>
          {d.appleHealth.lastUsedAt ? <p className="mt-1 pl-[52px] text-xs text-ink-faint">Last update {new Date(d.appleHealth.lastUsedAt).toLocaleString()}</p> : null}
          <div className="mt-3 flex gap-2 pl-[52px]">
            <Button size="sm" variant={d.appleHealth.connected ? "outline" : "accent"} onClick={newToken} disabled={busy || !d.synced}>
              {busy ? <Loader2 className="animate-spin" /> : <Link2 />} {d.appleHealth.connected ? "New key" : "Set up"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowApple((v) => !v)}>
              How it works
            </Button>
          </div>
          {showApple ? (
            <div className="mt-3 rounded-2xl bg-surface-2 p-4 text-sm">
              {token ? (
                <div className="mb-3">
                  <p className="font-medium">Your private key (shown once, keep it secret):</p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-2 py-1.5 text-xs">{token}</code>
                    <Button size="icon-sm" variant="outline" onClick={() => copy(token)} aria-label="Copy key">
                      <Copy />
                    </Button>
                  </div>
                </div>
              ) : null}
              <p className="font-medium">Send Apple Health to Ascend every morning with the Shortcuts app:</p>
              <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-ink-soft">
                <li>Open <b>Shortcuts</b> → new shortcut. Add <b>Find Health Samples</b> for <i>Sleep Analysis</i> from the last 1 day, filtered to <i>Value is Asleep</i> (with Apple Watch) or <i>Value is In Bed</i> (iPhone only). Then <b>Calculate Statistics → Sum</b> of the durations, in hours.</li>
                <li>Add <b>Find Health Samples</b> for <i>Heart Rate Variability</i>, <i>Resting Heart Rate</i> and <i>Steps</i> (today). Use the latest value, or the sum for steps.</li>
                <li>
                  Add <b>Get Contents of URL</b>: URL{" "}
                  <button type="button" className="font-mono text-xs text-primary underline" onClick={() => copy(`${origin}/api/recovery/ingest`)}>
                    {origin}/api/recovery/ingest
                  </button>
                  , method <b>POST</b>, header <b>Authorization</b> = <code>Bearer</code> + your key, JSON body with <code>sleepHours</code>, <code>hrv</code>, <code>restingHr</code>, <code>steps</code>.
                </li>
                <li>In <b>Automation</b>, run it daily when you wake up (e.g. 9:00), with &ldquo;Run immediately&rdquo; on.</li>
              </ol>
              <p className="mt-2 text-xs text-ink-faint">Creating a new key stops the old one working.</p>
            </div>
          ) : null}
        </div>

        {d.devices.map((dev) => (
          <div key={dev.provider} className="flex items-center justify-between gap-3 py-3">
            <span className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-tint text-primary">
                <Watch className="size-5" />
              </span>
              <span>
                <span className="label-head block">{DEVICE_NAME[dev.provider]}</span>
                <span className="text-sm text-ink-soft">
                  {dev.connected
                    ? dev.lastSyncAt
                      ? `Synced ${new Date(dev.lastSyncAt).toLocaleString()}`
                      : "Connected"
                    : dev.provider === "whoop"
                      ? "Recovery, strain, sleep and HRV"
                      : "Readiness, sleep, HRV and steps"}
                </span>
              </span>
            </span>
            {dev.connected ? (
              <Button size="sm" variant="outline" onClick={() => unlink(dev.provider)}>
                Disconnect
              </Button>
            ) : dev.available ? (
              <Button size="sm" variant="accent" asChild>
                <a href={`/api/devices/${dev.provider}/connect`}>Connect</a>
              </Button>
            ) : (
              <Badge>Coming soon</Badge>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
