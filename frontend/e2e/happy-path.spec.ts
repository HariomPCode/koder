import { test, expect } from "@playwright/test";

test("renders seeded two-sum happy path", async ({ page }) => {
  test.skip(
    !process.env.KODER_E2E_REAL_STACK,
    "Requires the seeded backend, workers, MongoDB, and Redis stack",
  );
  await page.goto("/signup");
  await page.getByLabel("First name").fill("Phase");
  await page.getByLabel("Last name").fill("Eight");
  await page
    .getByLabel("Email")
    .fill(process.env.KODER_E2E_EMAIL ?? "e2e@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill(process.env.KODER_E2E_PASSWORD ?? "Password123!");
  await page.getByRole("button", { name: /sign up|create account/i }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/problems");
  await expect(page.getByText(/two sum/i)).toBeVisible();
  await page.getByRole("link", { name: /Two Sum/i }).click();
  await expect(page.getByRole("heading", { name: /two sum/i })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Editor content" });
  await editor.click({ force: true });
  await editor.press("Control+A");
  await editor.press("Backspace");
  await page.keyboard.insertText(
    "function twoSum(nums, target) {\n  const index = new Map();\n  for (let i = 0; i < nums.length; i += 1) {\n    const needed = target - nums[i];\n    if (index.has(needed)) return [index.get(needed), i];\n    index.set(nums[i], i);\n  }\n  return [];\n",
  );
  await page.getByRole("button", { name: /submit/i }).click();
  await expect(page.locator("#editor-workspace").getByText("Accepted")).toBeVisible({ timeout: 30_000 });
  await page.goto("/dashboard");
  await expect(page.getByText("Solved", { exact: true })).toBeVisible();
});

test("problem catalog and detail contain content before hydration", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/problems");
  await expect(page.getByRole("heading", { name: "Problems" })).toBeVisible();
  await expect(page.getByText(/two sum/i)).toBeVisible();
  await page
    .getByText(/two sum/i)
    .first()
    .click();
  await expect(page.getByRole("heading", { name: /two sum/i })).toBeVisible();
  await context.close();
});
