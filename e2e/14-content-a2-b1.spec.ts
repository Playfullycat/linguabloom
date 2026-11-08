import { expect, test, type Page } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 5 / step 5.1: A2 and B1 units are really learnable (spec §13 Phase 5
// acceptance), with grammar points and B1 materials; units without content
// stay "planned".

const shots = (name: string) => `test-results/shots/${name}.png`;

async function choose(page: Page, option: string) {
  await page.locator("label").filter({ has: page.getByRole("radio", { name: option, exact: true }) }).click();
  await expect(page.getByRole("radio", { name: option, exact: true })).toBeChecked();
}

test("A2 and B1 levels list learnable units next to planned ones", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/learn/path");
  await expect(page.getByText("2 / 7 个单元可学")).toBeVisible();
  await expect(page.getByText("2 / 6 个单元可学")).toBeVisible();
  await expect(page.getByText("计划中 · 5 个单元")).toBeVisible(); // B2

  await page.goto("/learn/levels/b1");
  const opinions = page.getByRole("link", { name: /In My Opinion/ });
  await expect(opinions).toContainText("4 课");
  await expect(page.getByRole("link", { name: /The Person Who/ })).toContainText("计划中");
  await page.screenshot({ path: shots("level-b1"), fullPage: true });
});

test("an A2 lesson plays from the unit page with server scoring", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/learn/levels/a2");
  await page.getByRole("link", { name: /Past Stories/ }).click();
  await expect(page).toHaveURL(/\/learn\/units\/a2-u01-past-stories$/);
  await expect(page.getByText("能用一般过去时的肯定、否定和疑问形式，包括规则动词和常用不规则动词。")).toBeVisible();
  await page.screenshot({ path: shots("unit-a2"), fullPage: true });

  await page.getByRole("link", { name: "开始学习" }).click();
  await expect(page).toHaveURL(/\/lesson\/a2-u01-past-stories-l1$/);
  await expect(page.getByText("1 / 11")).toBeVisible();
  await page.getByRole("button", { name: /^继续/ }).click();
  await expect(page.getByText("How was your weekend?").first()).toBeVisible();
  await page.screenshot({ path: shots("lesson-a2-dialogue"), fullPage: true });
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /^继续/ }).click();
  await expect(page.getByText("5 / 11")).toBeVisible();

  await choose(page, "cleans");
  await page.getByRole("button", { name: "检查答案" }).click();
  await expect(page.getByText("正确答案：")).toContainText("cleaned");
  await page.getByRole("button", { name: "再试一次" }).click();
  await choose(page, "cleaned");
  await page.getByRole("button", { name: "检查答案" }).click();
  await expect(page.getByText("答对了！")).toBeVisible();
});

test("B1 grammar point and reading are available", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/grammar/conditionals");
  await expect(page.getByRole("heading", { name: /零条件句、第一和第二条件句/ })).toBeVisible();
  await expect(page.getByText("If it will rain, we'll stay in.")).toBeVisible();
  await page.screenshot({ path: shots("grammar-b1"), fullPage: true });

  await page.goto("/reading/rd-b1-repair-cafe");
  await expect(page.getByText("Don't Throw It Away — Fix It").first()).toBeVisible();
  await page.screenshot({ path: shots("reading-b1"), fullPage: true });
});
