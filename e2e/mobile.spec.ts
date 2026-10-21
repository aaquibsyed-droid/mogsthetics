import { expect, test } from "@playwright/test";

test("mobile: landing is usable and the scan action is prominent after sign-up", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Snap it/ })).toBeVisible();
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(scroll).toBeLessThanOrEqual(0);

  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`mobile-${Date.now()}@nutrilens.test`);
  await page.getByLabel("Password").fill("e2e-test-password-1");
  await page.getByText("I understand Ascend stores").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  // Unfinished onboarding redirects app pages back to onboarding.
  await page.goto("/home");
  await expect(page).toHaveURL(/\/onboarding/);
});

test("mobile: tracking-only pathway for under-18s shows no calorie target", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`teen-${Date.now()}@nutrilens.test`);
  await page.getByLabel("Password").fill("e2e-test-password-1");
  await page.getByText("I understand Ascend stores").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Age").fill("16");
  await page.getByRole("radio", { name: /Prefer not to say/ }).click();
  await page.getByLabel("Height (cm)").fill("165");
  await page.getByLabel("Current weight (kg)").fill("58");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /Moderately active/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /Lose weight/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Tracking without targets")).toBeVisible();
  await expect(page.getByText(/pediatrician or registered dietitian/)).toBeVisible();
  await page.getByRole("button", { name: "Save and start" }).click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByTestId("label-remaining")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Scan meal" })).toBeVisible();
  await expect(page.getByTestId("label-calories")).toBeVisible();
  await expect(page.getByTestId("streak-days")).toBeVisible();
  await page.screenshot({ path: "test-results/visual/home-mobile.png", fullPage: true });
});
