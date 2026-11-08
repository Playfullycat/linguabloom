import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 4 / step 4.3 (spec §5.13): PTE speaking and writing task types (fake
// microphone + mock transcription), mini mock tests with save and resume,
// and the practice report.

const shots = (name: string) => `test-results/shots/${name}.png`;

test("speaking: read aloud is recorded, transcribed and compared word by word", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/pte/sw_read_aloud/pte-sw-ra-01");
  await page.getByRole("button", { name: "开始练习" }).click();
  await expect(page.getByText(/Public libraries do much more than lend books/)).toBeVisible();
  await page.getByRole("button", { name: "开始录音" }).click();
  await expect(page.getByTestId("pte-speaking-phase")).toHaveAttribute("data-phase", "record");
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "说完了" }).click();
  // The mock transcriber returns the text without its last word.
  await expect(page.getByTestId("pte-score")).toHaveText(/^(\d+) \/ \1$|^\d+ \/ \d+$/);
  await expect(page.getByTestId("pte-spoken-transcript")).toContainText("Public libraries do much more");
  const [got, max] = (await page.getByTestId("pte-score").innerText()).split(" / ").map(Number);
  expect(max! - got!).toBe(1);
});

test("speaking with AI feedback: describe a chart; writing: one-sentence summary with form check", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/pte/sw_describe_image/pte-sw-di-01");
  await page.getByRole("button", { name: "开始练习" }).click();
  await expect(page.getByTestId("pte-chart")).toContainText("How students travel to campus");
  await expect(page.getByRole("img", { name: /Bus 38%/ })).toBeVisible();
  await page.getByRole("button", { name: "开始录音" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "说完了" }).click();
  await expect(page.getByRole("heading", { name: /AI 辅助反馈/ })).toBeVisible();
  await expect(page.getByText(/发音和流利度没有评估/)).toBeVisible();
  await expect(page.getByText("参考答案")).toBeVisible();
  await page.screenshot({ path: shots("pte-describe-image"), fullPage: true });

  await page.goto("/pte/sw_summarize_written_text/pte-sw-swt-01");
  await page.getByRole("button", { name: "开始练习" }).click();
  await page.getByLabel("你的一句话摘要").fill("Trials of a four-day week suggest that productivity can be kept and staff feel better, but its success depends on the type of work.");
  await expect(page.getByText(/1 句（要求：一句话，5–75 词）/)).toBeVisible();
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.getByTestId("pte-form")).toContainText("一句话、5–75 词，符合要求");
  await expect(page.getByRole("heading", { name: /AI 辅助反馈/ })).toBeVisible();
});

test("mini mock test: save and resume, results without per-item answers until the end", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/pte");
  await page.getByRole("button", { name: "阅读模拟" }).click();
  await expect(page).toHaveURL(/\/pte\/mock\//);
  await expect(page.getByTestId("mock-timer")).toContainText("本部分剩余");
  await expect(page.getByTestId("mock-progress")).toHaveText("第 1 / 5 题");
  await page.getByRole("button", { name: "提交，下一题" }).click();
  await expect(page.getByTestId("mock-progress")).toHaveText("第 2 / 5 题");
  // No answers are shown during the test.
  await expect(page.getByTestId("pte-result")).toHaveCount(0);

  // Save and leave; continue later from the same item.
  await page.getByRole("button", { name: "保存，稍后继续" }).click();
  await expect(page).toHaveURL(/\/pte$/);
  await page.getByRole("button", { name: "继续：阅读模拟" }).click();
  await expect(page.getByTestId("mock-progress")).toHaveText("第 2 / 5 题");

  for (const n of [3, 4, 5]) {
    await page.getByRole("button", { name: "提交，下一题" }).click();
    await expect(page.getByTestId("mock-progress")).toHaveText(`第 ${n} / 5 题`);
  }
  await page.getByRole("button", { name: "提交，下一题" }).click();
  await expect(page.getByTestId("mock-result")).toContainText("已完成");
  await expect(page.getByTestId("mock-result")).toContainText("作答 5 / 5 题");
  await expect(page.getByText(/不是对考试成绩的预测/)).toBeVisible();
  await page.screenshot({ path: shots("pte-mock-result"), fullPage: true });

  // The report lists task types, skills (with cross-influence) and the mock test.
  await page.goto("/pte/report");
  await expect(page.getByTestId("report-skills")).toContainText("计入这项技能的题型");
  await expect(page.getByTestId("report-skills")).toContainText("听写句子（也计入听力）");
  await expect(page.getByTestId("report-mocks")).toContainText("已完成");
  await page.screenshot({ path: shots("pte-report"), fullPage: true });
});
