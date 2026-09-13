import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = ["/", "/signin", "/signup", "/problems", "/dashboard", "/profile", "/contests", "/admin/questions"];

test.describe("accessibility", () => {
  for (const route of routes) {
    test(`${route} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter((violation) =>
        violation.impact === "serious" || violation.impact === "critical",
      );
      expect(seriousOrCritical).toEqual([]);
    });
  }
});
