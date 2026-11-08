import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 4 / step 4.1 (spec §2.1, §5.15): can-do evidence from the practice the
// earlier specs did (lessons, grammar, speaking …), skill trends, the extra
// progress figures and the assessment history.

const shots = (name: string) => `test-results/shots/${name}.png`;

test("progress: skill trends, can-do summary, comprehension and output figures", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/progress");
  await expect(page.getByText("技能估计的变化")).toBeVisible();
  // The diagnostic from 04-today gives at least one trend chart; every point has a keyboard tooltip.
  const point = page.getByRole("button", { name: /：(Pre-A1|A1|A2|B1)，/ }).first();
  await point.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText("水平诊断");
  await page.getByText("用表格查看全部估计").click();
  await expect(page.getByRole("cell", { name: "水平诊断" }).first()).toBeVisible();

  await expect(page.getByTestId("ability-summary")).toContainText("Pre-A1");
  await expect(page.getByTestId("comprehension")).toContainText("阅读：正确率");
  await expect(page.getByTestId("output-skills")).toContainText(/口语：\d+ 次练习/);
  await page.screenshot({ path: shots("progress-phase4"), fullPage: true });
});

test("can-do map: evidence links back to real practice", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/progress");
  await page.getByRole("link", { name: "打开能力地图" }).click();
  await expect(page).toHaveURL(/\/progress\/abilities/);
  await expect(page.getByText(/也不会直接改变你的水平估计/)).toBeVisible();

  // Pre-A1: the lesson from 02-lesson gave listening evidence.
  await page.getByRole("link", { name: /^Pre-A1/ }).click();
  const greetings = page.getByTestId("can-do-pre-a1.l.greetings");
  await expect(greetings).not.toContainText("还没有证据");
  await greetings.getByText("看证据").click();
  await expect(greetings.getByRole("link", { name: "课程练习" }).first()).toHaveAttribute("href", "/lesson/pre-a1-u03-hello-l1");

  // A1: the articles exercises from 06-grammar-errors count for nouns & articles.
  await page.getByRole("link", { name: /^A1/ }).click();
  const articles = page.getByTestId("can-do-a1.gr.nouns-articles");
  await expect(articles).not.toContainText("还没有证据");
  await articles.getByText("看证据").click();
  await expect(articles.getByRole("link", { name: "语法练习" }).first()).toHaveAttribute("href", /\/grammar\/(articles|plural-nouns|possessives)/);
  // Places to practise are listed even without evidence.
  await expect(page.getByTestId("can-do-a1.gr.can")).toContainText("去练：");
  await page.screenshot({ path: shots("can-do-map"), fullPage: true });
});

test("assessment history keeps every diagnostic", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/assessment");
  const history = page.getByTestId("assessment-history");
  await expect(history).toBeVisible();
  await expect(history.locator("tbody tr")).not.toHaveCount(0);
  await expect(page.getByText(/优先出上次没做过的题/)).toBeVisible();
});

test("long-term trends: weekly study time and retention side by side, evidence and errors by week, CSV export (Phase 5.3)", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/progress");
  await page.getByRole("link", { name: /查看长期趋势/ }).click();
  await expect(page).toHaveURL(/\/progress\/trends$/);
  const time = page.getByTestId("trends-time-retention");
  await expect(time.getByText("每周学习时间（分钟）")).toBeVisible();
  await expect(time.getByText("每周保留率")).toBeVisible();
  // Earlier specs studied this week: the current week has a bar with a keyboard tooltip.
  await time.getByRole("button", { name: /起的一周：\d+(\.\d)? 分钟/ }).last().focus();
  await expect(page.getByRole("tooltip")).toContainText("分钟");
  await expect(page.getByText(/相关系数|数据还不够/)).toBeVisible();
  await expect(page.getByTestId("trends-evidence")).toContainText("合计");
  await expect(page.getByTestId("trends-errors")).toContainText(/拼写|语法|时态|冠词|词形|听辨|语义理解/);
  await page.screenshot({ path: shots("progress-trends"), fullPage: true });

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出 CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^linguabloom-trends-\d{4}-\d{2}-\d{2}\.csv$/);
});
