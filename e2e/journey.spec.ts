import { expect, test, type Page } from "@playwright/test";

/**
 * Full user journey against the local backend + labelled mock AI provider.
 * Steps share one account and run in order.
 */
test.describe.configure({ mode: "serial" });

const email = `e2e-${Date.now()}@nutrilens.test`;
const password = "e2e-test-password-1";
let page: Page;

async function calories(p: Page): Promise<number> {
  const text = (await p.getByTestId("label-calories").first().innerText()).replace(/[^\d]/g, "");
  return Number(text);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

test("1. registers and completes onboarding", async () => {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByText("I understand Mogsthetics stores").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByLabel("Name (optional)").fill("Sam");
  await page.getByLabel("Age").fill("34");
  await page.getByRole("radio", { name: /^Female/ }).click();
  await page.getByLabel("Height (cm)").fill("168");
  await page.getByLabel("Current weight (kg)").fill("72");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("radio", { name: /Lightly active/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("radio", { name: /Lose weight/ }).click();
  await page.getByLabel(/Target weight/).fill("66");
  await page.getByRole("button", { name: "Continue" }).click();

  // Optional health step: skip. Food preferences: add an allergy.
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("checkbox", { name: /Peanuts/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
});

test("2. shows a personalised calorie target before saving", async () => {
  // Mifflin–St Jeor (female): 10·72 + 6.25·168 − 5·34 − 161 = 1439; ×1.375 = 1979; −396 kcal → 1580
  await expect(page.getByTestId("preview-target")).toHaveText("1,580");
  await expect(page.getByText("Est. BMR")).toBeVisible();
  await expect(page.getByText("1,439")).toBeVisible();
  await expect(page.getByText(/How this was calculated/)).toBeVisible();
  await page.getByRole("button", { name: "Save and start" }).click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole("heading", { name: /Sam\./ })).toBeVisible();
  await expect(page.getByTestId("label-remaining")).toHaveText("1,580");
  await expect(page.getByTestId("label-calories")).toHaveText("0");
});

test("3–4. uploads a meal photo and reviews the analysis", async () => {
  await page.goto("/scan");
  await expect(page.getByText(/analyses left today/)).toBeVisible(); // hydrated + upload session ready
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/synthetic-meal.jpg");
  await expect(page.getByAltText("Meal photo 1")).toBeVisible();
  await page.getByRole("button", { name: /Analyze photo/ }).click();
  // If the quality heuristic flags the synthetic image, the user can choose to proceed.
  const anyway = page.getByRole("button", { name: "Analyze anyway" });
  if (await anyway.isVisible({ timeout: 3000 }).catch(() => false)) await anyway.click();

  await expect(page).toHaveURL(/\/scan\/[0-9a-f-]{36}/);
  await expect(page.getByText("Development mock — not a real analysis")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("analysis-item")).toHaveCount(3);
  await expect(page.getByLabel("Food name").nth(1)).toHaveValue("White rice");
  await expect(page.getByText(/Was olive oil used/)).toBeVisible();
});

test("5. edits a portion and recalculates instantly", async () => {
  const before = await calories(page);
  const rice = page.getByRole("spinbutton", { name: "White rice grams" });
  await rice.fill("100"); // 180 g → 100 g of cooked rice (130 kcal/100 g)
  await expect.poll(() => calories(page)).toBe(before - 104);
  // Answer the clarifying question: add the oil.
  await page.getByRole("button", { name: /Yes, add ~8 g/ }).click();
  await expect.poll(() => calories(page)).toBeGreaterThan(before - 104);
});

test("6–7. saves the meal and daily totals update", async () => {
  const mealKcal = await calories(page);
  await page.getByRole("button", { name: "Save to diary" }).click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByTestId("meal-card")).toHaveCount(1);
  await expect.poll(() => calories(page)).toBe(mealKcal);
  const remaining = Number((await page.getByTestId("label-remaining").innerText()).replace(/[^\d]/g, ""));
  expect(remaining).toBe(1580 - mealKcal);
});

test("8–9. logs body weight and shows the trend", async () => {
  await page.goto("/progress");
  const today = new Date();
  const earlier = new Date(today.getTime() - 3 * 86400000);
  const iso = (d: Date) => new Intl.DateTimeFormat("en-CA").format(d);
  await page.getByLabel("Weight (kg)").fill("71.6");
  await page.getByLabel("Date").fill(iso(earlier));
  await page.getByRole("button", { name: "Save weigh-in" }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.getByLabel("Weight (kg)").fill("71.2");
  await page.getByLabel("Date").fill(iso(today));
  await page.getByRole("button", { name: "Save weigh-in" }).click();
  await expect(page.getByRole("img", { name: "Weight readings and smoothed trend" })).toBeVisible();
  await expect(page.getByTestId("trend-weight")).toContainText("kg");
  await expect(page.getByText(/A rate needs at least 4 weigh-ins/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Measurements" }).getByRole("listitem")).toHaveCount(3); // onboarding weight + 2
});

test("10. edits and deletes a meal", async () => {
  await page.goto("/diary");
  await page.getByTestId("meal-card").first().click();
  await expect(page).toHaveURL(/\/meals\//);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("spinbutton", { name: "Grilled chicken breast grams" }).fill("200");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("edited").first()).toBeVisible();
  await expect(page.getByText("200 g ·")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete meal" }).click();
  await expect(page).toHaveURL(/\/diary/);
  await expect(page.getByTestId("meal-card")).toHaveCount(0);
});

test("manual logging works without AI (USDA reference search)", async () => {
  await page.goto("/diary/new");
  await page.getByRole("button", { name: "Search foods" }).click();
  await page.getByLabel("Search foods").fill("greek yogurt");
  await page.getByRole("button", { name: /Greek yogurt, plain, nonfat/ }).click();
  await page.getByRole("button", { name: /Add \d+ g/ }).click();
  await page.getByRole("button", { name: "Save meal" }).click();
  await expect(page).toHaveURL(/\/diary\?date=/);
  await expect(page.getByTestId("meal-card")).toHaveCount(1);
});

test("data export contains the user's records", async () => {
  const res = await page.request.get("/api/account/export");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.account.email).toBe(email);
  expect(body.data.meals.length).toBe(1);
  expect(body.data.goalHistory.length).toBe(1);
});

test("unauthenticated API access is rejected", async ({ request }) => {
  const res = await request.get("/api/summary/day");
  expect(res.status()).toBe(401);
});

test("coach answers from the user's own data (mock provider, labelled)", async () => {
  await page.goto("/coach");
  await expect(page.getByText("What the coach sees")).toBeVisible();
  await page.getByRole("button", { name: "How much protein do I have left today?" }).click();
  await expect(page.getByText(/Development mock coach/)).toBeVisible();
  await expect(page.getByText(/Today's target: 1,?580 kcal/)).toBeVisible();
});

test("meal ideas respect allergies and can be added to the diary", async () => {
  await page.goto("/plan");
  const cards = page.getByRole("article");
  await expect(cards.first()).toBeVisible();
  // Peanut allergy was set during onboarding: no suggestion may contain peanuts.
  await expect(page.getByText(/Contains:.*Peanuts/)).toHaveCount(0);
  await cards.first().getByRole("button", { name: "Add to today" }).click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByTestId("meal-card")).toHaveCount(2);
});

test("types a meal in plain words and logs it (no AI)", async () => {
  await page.goto("/home");
  await page.getByLabel("What did you eat?").fill("200g greek yogurt, 1 banana");
  await page.getByRole("button", { name: "read it" }).click();
  await expect(page.getByTestId("quick-log-row")).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: /Food for 200g greek yogurt/ })).toHaveValue(/usda_sr:/);
  await page.getByRole("button", { name: "log 2 foods" }).click();
  await expect(page.getByTestId("meal-card")).toHaveCount(3);
});

test("tracks water and shows a gentle weekly check-in", async () => {
  await page.getByRole("button", { name: "+250 ml" }).click();
  await expect(page.getByTestId("water-total")).toHaveText("250 / 2,000 ml");
  await page.getByRole("button", { name: "+250 ml" }).click();
  await expect(page.getByTestId("water-total")).toHaveText("500 / 2,000 ml");
  await page.getByRole("button", { name: "Undo last drink" }).click();
  await expect(page.getByTestId("water-total")).toHaveText("250 / 2,000 ml");
  await page.reload();
  await expect(page.getByTestId("streak-days")).toHaveText("1");
  await expect(page.getByText(/You logged 1 of the last 7 days/)).toBeVisible();
  await page.screenshot({ path: "test-results/visual/home-desktop.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/visual/home-desktop-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
});

test("repeats yesterday's meal in one tap", async () => {
  const d = new Date(Date.now() - 86400000);
  const yesterday = new Intl.DateTimeFormat("en-CA").format(d);
  await page.goto(`/diary/new?date=${yesterday}`);
  await page.getByLabel("What did you eat?").fill("1 apple");
  await page.getByRole("button", { name: "read it" }).click();
  await page.getByLabel("add to").selectOption("snack");
  await page.getByRole("button", { name: "log 1 food" }).click();
  await expect(page).toHaveURL(new RegExp(`/diary\\?date=${yesterday}`));
  await page.goto("/diary");
  await page.getByRole("button", { name: "repeat yesterday's snacks" }).click();
  await expect(page.getByRole("region", { name: "Snacks" }).getByTestId("meal-card")).toHaveCount(1);
  await page.screenshot({ path: "test-results/visual/diary-desktop.png", fullPage: true });
});

test("deletes the account and all data", async () => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
});
