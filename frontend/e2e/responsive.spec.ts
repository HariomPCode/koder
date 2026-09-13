import { test, expect } from "@playwright/test";

const routes = ["/", "/signin", "/signup", "/problems", "/dashboard", "/profile", "/contests", "/admin/questions"];

for (const width of [375, 768, 1280]) {
  test.describe(`${width}px`, () => {
    for (const route of routes) {
      test(`${route} has no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(page.locator("body")).toBeVisible();
      });
    }
  });
}
