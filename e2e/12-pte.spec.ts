import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 4 / step 4.2 (spec §5.13, §8.8): versioned PTE task types with
// official sources, original reading and listening practice with exact
// objective scoring, timed mode, AI-assisted feedback kept apart, history.

const shots = (name: string) => `test-results/shots/${name}.png`;

test("PTE hub: exam version with sources and all 22 task types", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/pte");
  const version = page.getByTestId("pte-version");
  await expect(version).toContainText("官方题型页最近一次核对：2026-11-08");
  await expect(version).toContainText("生效日期：官方页面没有写");
  await expect(version.getByRole("link", { name: "Reading" })).toHaveAttribute("href", "https://www.pearsonpte.com/pte-academic/test-format/reading/");
  await expect(page.locator("main").getByRole("link").filter({ hasText: /可以练习/ })).toHaveCount(22);
  await expect(page.getByRole("link", { name: /阅读填空（下拉选择）.*可以练习/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /作文.*可以练习/ })).toBeVisible();
  await page.screenshot({ path: shots("pte-hub"), fullPage: true });

  // A writing type: the official description with its zero-score rule.
  await page.getByRole("link", { name: /作文/ }).click();
  await expect(page.getByTestId("pte-official")).toContainText("跑题或少于 120 / 多于 380 词为 0 分");
  await expect(page.getByTestId("pte-prompts").getByRole("link")).toHaveCount(3);
});

test("reading: dropdown blanks, negative marking in multiple answers, re-order paragraphs", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/pte/r_fib_dropdown/pte-r-fib-dd-01");
  await page.getByRole("button", { name: "开始练习" }).click();
  for (const [i, word] of ["turned", "reduces", "rare", "harvest"].entries()) await page.getByLabel(`第 ${i + 1} 空`).selectOption({ label: word });
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.getByTestId("pte-score")).toHaveText("4 / 4");

  await page.goto("/pte/r_mcma/pte-r-mcma-01");
  await page.getByRole("button", { name: "开始练习" }).click();
  await page.getByLabel("Better attention and memory in children").check();
  await page.getByLabel("A general increase in intelligence").check();
  await page.getByLabel(/Feeling less lonely/).check();
  await page.getByRole("button", { name: "提交答案" }).click();
  // +1 +1 −1 = 1 of 3.
  await expect(page.getByTestId("pte-score")).toHaveText("1 / 3");
  await expect(page.getByText("每个选对的选项 +1，每个选错的选项 −1，最低 0 分。")).toBeVisible();
  await page.screenshot({ path: shots("pte-mcma-result"), fullPage: true });

  await page.goto("/pte/r_reorder/pte-r-reorder-01");
  await page.getByRole("button", { name: "开始练习" }).click();
  const up = page.getByRole("button", { name: /^上移：Public libraries/ });
  await up.click();
  await up.click();
  await expect(page.getByRole("list", { name: "排序" }).getByRole("listitem").first()).toContainText("Public libraries were once");
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.getByTestId("pte-score")).toHaveText("3 / 3");
});

test("listening: timed dictation plays once; summary gets AI feedback apart from the word count", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/pte/l_wfd/pte-l-wfd-01");
  await page.getByRole("button", { name: "计时模式" }).click();
  await expect(page.getByTestId("pte-timer")).toContainText("剩余");
  await expect(page.getByTestId("pte-audio-source")).toContainText("模拟语音");
  await page.getByRole("button", { name: "播放录音" }).click();
  await expect(page.getByRole("button", { name: "录音只能播放一次" })).toBeDisabled({ timeout: 15_000 });
  await page.getByLabel("你听到的句子").fill("The libary will be closed on Sunday for repairs.");
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.getByTestId("pte-score")).toHaveText("8 / 9");
  await page.getByText("录音文字稿").click();
  await expect(page.getByTestId("pte-transcript")).toHaveText("The library will be closed on Sunday for repairs.");

  await page.goto("/pte/l_sst/pte-l-sst-01");
  await page.getByRole("button", { name: "开始练习" }).click();
  await page
    .getByLabel("你的摘要")
    .fill(
      "The speaker explains that urban beekeeping is popular because cities have many different plants, so city bees can produce more honey than bees on farms with one crop and chemicals. However, too many hives may cause a shortage of flowers and competition with wild bees, so beekeeping must be balanced with planting flowers.",
    );
  await expect(page.getByText(/个词（要求 50–70）/)).toBeVisible();
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.getByText("词数符合要求（50–70）")).toBeVisible();
  await expect(page.getByRole("heading", { name: /AI 辅助反馈/ })).toBeVisible();
  await expect(page.getByText(/不是 Pearson 的评分/)).toBeVisible();
  await expect(page.getByText("要点", { exact: true })).toBeVisible();
  await page.screenshot({ path: shots("pte-sst-feedback"), fullPage: true });
});

test("history keeps the version; lost points go to the error notebook", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/pte/r_mcma");
  const history = page.getByTestId("pte-history");
  await expect(history).toContainText("1/3");
  await history.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/pte\/attempts\//);
  await expect(page.getByTestId("attempt-version")).toContainText("考试版本：PTE Academic");
  await expect(page.getByTestId("pte-score")).toHaveText("1 / 3");

  await page.goto("/errors");
  await expect(page.getByRole("link", { name: /PTE · 阅读多选/ })).toBeVisible();
});
