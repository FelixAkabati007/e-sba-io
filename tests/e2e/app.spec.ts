import { test, expect } from "@playwright/test";

test("loads home and navigates to master db", async ({ page }) => {
  await page.goto("http://localhost:5173/");
  await expect(page.getByText("E-SBA [JHS]")).toBeVisible();
  await page.getByText("Master Database").click();
  await expect(page.getByText("Master Student Database")).toBeVisible();
});
