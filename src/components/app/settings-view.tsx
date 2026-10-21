"use client";

import Link from "next/link";
import { useState } from "react";
import { useTheme } from "next-themes";
import { Download, Loader2, LogOut, PencilLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Notice, Segmented, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage, leaveSession, useApi } from "@/lib/client/api";
import type { FoodRecord } from "@/lib/food-data/types";
import { ALLERGEN_LABELS } from "@/lib/food-data/types";
import { ACTIVITY_LEVELS } from "@/lib/nutrition/energy";
import { macroEnergy } from "@/lib/nutrition/macros";
import { formatLocalDate } from "@/lib/nutrition/dates";
import type { GoalPeriod } from "@/lib/repos/goals";
import type { BodyMetric } from "@/lib/repos/metrics";
import type { Profile } from "@/lib/repos/profiles";
import { fmtNum, fmtWeight } from "@/lib/format";
import { signOutAction } from "@/app/(auth)/actions";

interface ProfileData {
  profile: Profile;
  goal: GoalPeriod | null;
  energy: { bmrKcal: number | null; tdeeKcal: number | null; targetKcal: number | null; source: string; calculatedAt: string } | null;
  latestWeight: BodyMetric | null;
  email: string | null;
}

const GOAL_LABEL = { lose: "Lose weight", maintain: "Maintain weight", gain: "Gain weight", muscle: "Build muscle" } as const;

export function SettingsView({ plan, analysesPerDay }: { plan: string; analysesPerDay: number }) {
  const { data, error, reload } = useApi<ProfileData>("/api/profile");
  const history = useApi<{ history: GoalPeriod[] }>("/api/goals/history");
  const foods = useApi<{ foods: FoodRecord[] }>("/api/foods/mine");
  const { theme, setTheme } = useTheme();
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return <Skeleton className="h-96" />;
  const { profile: p, goal, energy } = data;
  const units = p.preferredUnits;

  async function patch(body: Record<string, unknown>, msg = "Saved") {
    try {
      await api("/api/profile/preferences", { method: "PATCH", body });
      toast.success(msg);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{data.email}</p>
          <h1 className="label-num mt-1 text-[32px]">{p.displayName ? `${p.displayName}'s profile` : "Profile & settings"}</h1>
        </div>
        <Button
          variant="outline"
          onClick={async () => {
            await signOutAction();
            leaveSession("/");
          }}
        >
          <LogOut /> Sign out
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Goals & targets</CardTitle>
            <Link href="/profile/edit" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <PencilLine /> Edit profile & goal
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {goal?.trackingOnly ? (
              <Notice tone="info" title="Tracking without targets">
                Calorie targets aren&apos;t shown for your situation. Change this under Edit profile & goal.
              </Notice>
            ) : goal ? (
              <>
                <div className="flex items-end justify-between border-b-[3px] border-ink pb-2">
                  <div>
                    <p className="eyebrow">{GOAL_LABEL[goal.goalType]}</p>
                    <p className="label-num mt-1 text-[40px]" data-testid="current-target">
                      {fmtNum(goal.targetCaloriesKcal)}
                      <span className="ml-1 text-base">kcal</span>
                    </p>
                  </div>
                  <Badge tone={goal.calculationMethod === "manual" ? "warn" : "good"}>
                    {goal.calculationMethod === "manual" ? "set manually" : goal.calculationMethod === "adaptive" ? "adapted" : "estimated"}
                  </Badge>
                </div>
                <dl className="grid grid-cols-4 gap-2 text-center">
                  {[
                    ["Protein", goal.targetProteinG],
                    ["Carbs", goal.targetCarbohydratesG],
                    ["Fat", goal.targetFatG],
                    ["Fiber", goal.targetFiberG],
                  ].map(([l, v]) => (
                    <div key={l as string}>
                      <dt className="text-xs text-ink-faint">{l}</dt>
                      <dd className="font-mono font-medium">{fmtNum(v as number | null)} g</dd>
                    </div>
                  ))}
                </dl>
                <dl className="grid grid-cols-2 gap-2 text-ink-soft">
                  <div>
                    Calories at rest: <span className="font-mono text-ink">{fmtNum(energy?.bmrKcal)}</span>
                  </div>
                  <div>
                    Calories you burn: <span className="font-mono text-ink">{fmtNum(energy?.tdeeKcal)}</span>
                  </div>
                  <div>Activity: {p.activityLevel ? ACTIVITY_LEVELS[p.activityLevel].label : "—"}</div>
                  <div>Weight: {fmtWeight(data.latestWeight?.weightKg, units)}</div>
                  {p.targetWeightKg ? <div>Target weight: {fmtWeight(p.targetWeightKg, units)}</div> : null}
                </dl>
                <Button variant="subtle" onClick={() => setTargetsOpen(true)}>
                  Set targets manually
                </Button>
              </>
            ) : (
              <p>No goal yet.</p>
            )}
            <label className="flex items-center justify-between gap-3 border-t border-rule pt-3">
              <span>
                <span className="block font-medium">Adaptive target suggestions</span>
                <span className="text-xs text-ink-faint">
                  Suggest small adjustments from your intake and weight trend. You approve every change.
                </span>
              </span>
              <Switch
                checked={p.adaptiveEnabled}
                onCheckedChange={(v) => patch({ adaptiveEnabled: v })}
                aria-label="Adaptive target suggestions"
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Units</span>
              <Segmented
                name="Units"
                value={units}
                onChange={(u) => patch({ preferredUnits: u })}
                options={[
                  { value: "metric", label: "Metric" },
                  { value: "imperial", label: "Imperial" },
                ]}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Theme</span>
              <Segmented
                name="Theme"
                value={(theme as "light" | "dark" | "system") ?? "system"}
                onChange={setTheme}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "Auto" },
                ]}
              />
            </div>
            <Field label="Time zone (sets where your day starts and ends)" htmlFor="tz">
              <div className="flex gap-2">
                <Input
                  id="tz"
                  defaultValue={p.timezone}
                  key={p.timezone}
                  onBlur={(e) => e.target.value !== p.timezone && patch({ timezone: e.target.value.trim() }, "Time zone updated")}
                />
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => patch({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, "Time zone updated")}
                >
                  Use this device
                </Button>
              </div>
            </Field>
            <Field label="Eating pattern" htmlFor="diet">
              <Select id="diet" value={p.dietaryPattern} onChange={(e) => patch({ dietaryPattern: e.target.value })}>
                <option value="omnivore">No restrictions</option>
                <option value="vegetarian">Vegetarian</option>
                <option value="pescatarian">Pescatarian</option>
                <option value="vegan">Vegan</option>
              </Select>
            </Field>
            <div>
              <p className="font-medium">Allergies</p>
              <p className="text-ink-soft">
                {p.allergies.length ? p.allergies.map((a) => ALLERGEN_LABELS[a]).join(", ") : "None recorded"} · change in Edit profile &
                goal
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="privacy">
          <CardHeader>
            <CardTitle>Privacy & data</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <Field
              label="Keep meal photos"
              htmlFor="retention"
              hint="Photos are private, served via short-lived links, and never used to infer anything about you."
            >
              <Select
                id="retention"
                value={p.imageRetention}
                onChange={(e) => patch({ imageRetention: e.target.value }, "Photo retention updated")}
              >
                <option value="delete_after_analysis">Delete right after analysis</option>
                <option value="30_days">For 30 days (default)</option>
                <option value="keep">Until I delete the meal</option>
              </Select>
            </Field>
            <p className="text-xs text-ink-faint">
              Changes apply to meals saved from now on. Photos from discarded analyses are deleted within a day.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="/api/account/export" className={buttonVariants({ variant: "outline" })} download>
                <Download /> Export my data (JSON)
              </a>
              <Button variant="ghost" className="text-danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Delete account
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications & plan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <label className="flex items-center justify-between gap-3">
              <span>Weekly summary email</span>
              <Switch
                checked={p.notificationPrefs.weeklySummary}
                onCheckedChange={(v) => patch({ notificationPrefs: { ...p.notificationPrefs, weeklySummary: v } })}
                aria-label="Weekly summary email"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Logging reminders</span>
              <Switch
                checked={p.notificationPrefs.logReminders}
                onCheckedChange={(v) => patch({ notificationPrefs: { ...p.notificationPrefs, logReminders: v } })}
                aria-label="Logging reminders"
              />
            </label>
            <p className="text-xs text-ink-faint">Your choice is saved. Delivery starts once this deployment connects an email provider.</p>
            <div className="rounded-xl bg-surface-2 px-4 py-3">
              <p className="font-medium">
                Plan: <span className="capitalize">{plan}</span>
              </p>
              <p className="text-ink-soft">{analysesPerDay} photo analyses per day. Manual logging is always unlimited.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Goal history</CardTitle>
          </CardHeader>
          <CardContent>
            {!history.data ? (
              <Skeleton className="h-24" />
            ) : (
              <ul className="divide-y divide-rule text-sm">
                {history.data.history
                  .filter((h) => !h.effectiveUntil || h.effectiveUntil > h.effectiveFrom)
                  .map((h) => (
                    <li key={h.id} className="flex items-center justify-between py-2">
                      <span>
                        <span className="font-medium">{GOAL_LABEL[h.goalType]}</span>{" "}
                        <span className="text-ink-faint">
                          {formatLocalDate(h.effectiveFrom)} – {h.effectiveUntil ? formatLocalDate(h.effectiveUntil) : "now"}
                        </span>
                      </span>
                      <span className="font-mono">{h.trackingOnly ? "no target" : `${fmtNum(h.targetCaloriesKcal)} kcal`}</span>
                    </li>
                  ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink-faint">Past days keep the targets that applied at the time.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your foods</CardTitle>
          </CardHeader>
          <CardContent>
            {!foods.data ? (
              <Skeleton className="h-24" />
            ) : foods.data.foods.length === 0 ? (
              <p className="text-sm text-ink-soft">Foods you enter from labels appear here for quick reuse.</p>
            ) : (
              <ul className="divide-y divide-rule text-sm">
                {foods.data.foods.map((f) => (
                  <li key={f.ref.id} className="flex items-center justify-between py-2">
                    <span>
                      {f.name} <span className="text-ink-faint">· {fmtNum(f.per100g.caloriesKcal)} kcal/100 g</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${f.name}`}
                      onClick={async () => {
                        try {
                          await api(`/api/foods/mine/${f.ref.id}`, { method: "DELETE" });
                          await foods.reload();
                        } catch (e) {
                          toast.error(errorMessage(e));
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {goal && !goal.trackingOnly ? (
        <ManualTargetsDialog
          open={targetsOpen}
          onOpenChange={setTargetsOpen}
          goal={goal}
          onSaved={() => {
            reload();
            history.reload();
          }}
        />
      ) : null}
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}

function ManualTargetsDialog({
  open,
  onOpenChange,
  goal,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  goal: GoalPeriod;
  onSaved: () => void;
}) {
  const [v, setV] = useState({
    caloriesKcal: goal.targetCaloriesKcal ?? 2000,
    proteinG: goal.targetProteinG ?? 100,
    carbohydratesG: goal.targetCarbohydratesG ?? 200,
    fatG: goal.targetFatG ?? 65,
    fiberG: goal.targetFiberG ?? 28,
  });
  const [saving, setSaving] = useState(false);
  const macroKcal = macroEnergy(v.proteinG, v.carbohydratesG, v.fatG);
  const diff = macroKcal - v.caloriesKcal;
  const ok = Math.abs(diff) <= Math.max(10, v.caloriesKcal * 0.05);
  async function save() {
    setSaving(true);
    try {
      await api("/api/targets/manual", { method: "PUT", body: v });
      toast.success("Targets updated from today");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  const field = (k: keyof typeof v, label: string) => (
    <Field label={label} htmlFor={`mt-${k}`}>
      <Input
        id={`mt-${k}`}
        type="number"
        inputMode="numeric"
        value={v[k]}
        onChange={(e) => setV((s) => ({ ...s, [k]: Math.round(Number(e.target.value) || 0) }))}
      />
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Set targets manually" description="Applies from today. Earlier days keep their targets.">
        <div className="flex flex-col gap-4">
          {field("caloriesKcal", "Calories (kcal)")}
          <div className="grid grid-cols-2 gap-3">
            {field("proteinG", "Protein (g)")}
            {field("carbohydratesG", "Carbohydrates (g)")}
            {field("fatG", "Fat (g)")}
            {field("fiberG", "Fiber (g)")}
          </div>
          <Notice tone={ok ? "good" : "warn"}>
            Macros add up to {fmtNum(macroKcal)} kcal (4/4/9 kcal per g)
            {ok ? "." : ` — ${fmtNum(Math.abs(diff))} kcal ${diff > 0 ? "over" : "under"} your calorie target. Keep them within 5%.`}
          </Notice>
          <Button onClick={save} disabled={!ok || saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save targets
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  async function del() {
    setBusy(true);
    try {
      await api("/api/account", { method: "DELETE", body: { confirm } });
      leaveSession("/");
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Delete your account?"
        description="This permanently deletes your profile, meals, photos, weights, targets and coach history. It can't be undone."
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-soft">Consider exporting your data first.</p>
          <Field label="Type DELETE to confirm" htmlFor="confirm-delete">
            <Input id="confirm-delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
          <Button variant="destructive" disabled={confirm !== "DELETE" || busy} onClick={del}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Permanently delete account
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
