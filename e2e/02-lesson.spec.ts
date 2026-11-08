import { expect, test, type Page } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 1 acceptance (spec §13, §14.2 "课程"): course catalog from the database,
// progress saved per step, refresh resumes at the right step, completion summary.

const LESSON_URL = "/lesson/pre-a1-u03-hello-l1";
const shots = (name: string) => `test-results/shots/${name}.png`;

/** Click an answer option the way a learner does (the whole option row is the label). */
async function choose(page: Page, option: string) {
  await page.locator("label").filter({ has: page.getByRole("radio", { name: option, exact: true }) }).click();
  await expect(page.getByRole("radio", { name: option, exact: true })).toBeChecked();
}

async function next(page: Page) {
  await page.getByRole("button", { name: /^(继续|完成本课|完成)/ }).click();
}

test("learning path, unit page and lesson flow with resume and summary", async ({ page }) => {
  await ensureSignedIn(page);

  // Learning path comes from the database (7 levels, planned levels marked).
  await page.goto("/learn/path");
  await expect(page.getByRole("heading", { name: "建立英语声音、文字和最基础表达的对应关系" })).toBeVisible();
  // Every level now has learnable units (Phase 5.2); C1 and C2 have 2 of 3.
  await expect(page.getByText("2 / 3 个单元可学").first()).toBeVisible();
  await page.screenshot({ path: shots("path"), fullPage: true });

  await page.goto("/learn/levels/pre_a1");
  await page.getByRole("link", { name: /Hello!/ }).click();
  await expect(page).toHaveURL(/\/learn\/units\/pre-a1-u03-hello$/);
  await expect(page.getByText("能用简单的日常用语打招呼和道别。")).toBeVisible();
  await page.screenshot({ path: shots("unit"), fullPage: true });

  // Start the first lesson.
  await page.getByRole("link", { name: "开始学习" }).click();
  await expect(page).toHaveURL(new RegExp(`${LESSON_URL}$`));
  await expect(page.getByText("1 / 10")).toBeVisible();

  for (let i = 0; i < 5; i++) await next(page); // orientation → teach (viewed)
  await expect(page.getByText("6 / 10")).toBeVisible();

  // s06: wrong first, see the right answer, retry (not counted as first try).
  await choose(page, "Good morning.");
  await page.getByRole("button", { name: "检查答案" }).click();
  await expect(page.getByText("还不太对，值得再练一次。")).toBeVisible();
  await expect(page.getByText("正确答案：")).toContainText("Good afternoon.");
  await page.screenshot({ path: shots("feedback-wrong"), fullPage: true });
  await page.getByRole("button", { name: "再试一次" }).click();
  await choose(page, "Good afternoon.");
  await page.getByRole("button", { name: "检查答案" }).click();
  await expect(page.getByText("答对了！")).toBeVisible();
  await next(page);
  await expect(page.getByText("7 / 10")).toBeVisible();

  // Refresh: resumes at step 7.
  await page.reload();
  await expect(page.getByText("7 / 10")).toBeVisible();

  // s07: match.
  await page.getByLabel("Good morning!").selectOption("8:00 a.m. 见面");
  await page.getByLabel("Good afternoon!").selectOption("2:00 p.m. 见面");
  await page.getByLabel("Good evening!").selectOption("7:00 p.m. 见面");
  await page.getByLabel("Good night!").selectOption("11:00 p.m. 睡前");
  await page.getByRole("button", { name: "检查答案" }).click();
  await expect(page.getByText("答对了！")).toBeVisible();
  await next(page);

  // s08: listening choice.
  await choose(page, "Good evening, Lily.");
  await page.getByRole("button", { name: "检查答案" }).click();
  await expect(page.getByText("答对了！")).toBeVisible();
  await next(page);

  // s09: cloze (Enter submits).
  await page.getByLabel("填空").fill("Morning");
  await page.getByLabel("填空").press("Enter");
  await expect(page.getByText("答对了！")).toBeVisible();
  await next(page);

  // s10: exit ticket, then finish.
  await choose(page, "Hi, everyone!");
  await page.getByRole("button", { name: "检查答案" }).click();
  await expect(page.getByText("答对了！")).toBeVisible();
  await page.getByRole("button", { name: "完成本课" }).click();

  await expect(page.getByText("本课完成")).toBeVisible();
  await expect(page.getByText("练习题首次答对 4 / 5 题")).toBeVisible();
  await expect(page.getByText("值得再看一眼")).toBeVisible();
  await expect(page.getByText("正确答案：Good afternoon.")).toBeVisible();
  await page.screenshot({ path: shots("summary"), fullPage: true });

  // Unit page reflects completion (data persisted in PostgreSQL).
  await page.getByRole("link", { name: "返回单元" }).click();
  const lessonRow = page.getByRole("link", { name: /Hi and Hello/ });
  await expect(lessonRow.getByText("已完成")).toBeVisible();
  await expect(lessonRow.getByText("首次答对 80%")).toBeVisible();
});

test("lesson player works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ensureSignedIn(page);
  await page.goto("/lesson/pre-a1-u03-hello-l2");
  await expect(page.getByText(/^1 \/ 10$/)).toBeVisible();
  await next(page);
  await expect(page.getByRole("button", { name: "播放整段对话" })).toBeVisible();
  await page.getByRole("button", { name: "显示英文" }).click();
  await expect(page.getByText("Hi, Anna! How are you?")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: shots("player-mobile"), fullPage: true });
});
