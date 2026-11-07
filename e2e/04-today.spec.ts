import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Specs are numbered: they share one test database and run in order.
// Phase 1 acceptance (spec §4, §13): onboarding with resume → adaptive
// diagnostic with pause, "不会" and skip → preliminary estimates → today plan
// (reasons, length switch, reorder, skip with reason, review-only) → progress.
// Runs after 02-lesson.spec.ts and 03-review.spec.ts (lesson 1 done, words in review).

const shots = (name: string) => `test-results/shots/${name}.png`;

test("onboarding → diagnostic → today plan → progress", async ({ page }) => {
  await ensureSignedIn(page);

  // Today invites the learner to finish onboarding.
  await expect(page.getByText("先花几分钟完成首次引导")).toBeVisible();
  await page.getByRole("link", { name: "开始引导" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "开始", exact: true }).click();

  await page.getByText("中英混合").click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByText("日常交流").click();
  await page.getByText("旅行").click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.locator("label").filter({ hasText: "每周 4 天" }).click();
  await page.locator("label").filter({ hasText: "40 分钟" }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByRole("group", { name: "你觉得自己现在的英语怎么样？" })).toBeVisible();

  // Pause: leave and come back — onboarding resumes at the same step.
  await page.goto("/today");
  await page.getByRole("link", { name: "继续引导" }).click();
  await expect(page.getByRole("group", { name: "你觉得自己现在的英语怎么样？" })).toBeVisible();
  await page.getByText("学过，但忘得差不多了").click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.screenshot({ path: shots("onboarding-diagnostic"), fullPage: true });
  await page.getByRole("link", { name: "开始诊断" }).click();

  // Diagnostic: starts at A1 for "forgot", answers are scored on the server.
  await page.getByRole("button", { name: "开始诊断" }).click();
  await expect(page.getByText("词汇 · 第 1 / 6 题")).toBeVisible();
  await page.screenshot({ path: shots("assessment-item"), fullPage: true });
  await page.getByRole("button", { name: "不会" }).click();
  await expect(page.getByText(/正确答案：/)).toBeVisible();
  await page.getByRole("button", { name: "下一题" }).click();
  await expect(page.getByText("词汇 · 第 2 / 6 题")).toBeVisible();

  // Pause and resume the diagnostic.
  await page.getByRole("link", { name: "暂停，稍后继续" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("link", { name: "继续诊断" }).click();
  await expect(page.getByText("词汇 · 第 2 / 6 题")).toBeVisible();

  for (let i = 2; i <= 6; i++) {
    await page.getByRole("button", { name: "不会" }).click();
    await page.getByRole("button", { name: "下一题" }).click();
  }
  await expect(page.getByText("语法 · 第 1 / 6 题")).toBeVisible();
  for (const part of ["语法", "阅读", "听力"]) {
    await page.getByRole("button", { name: `跳过${part}部分` }).click();
  }
  await expect(page.getByRole("heading", { name: "客观题部分完成了" })).toBeVisible();
  await page.getByLabel(/写作（可选）/).fill("My name is Lin. I live in Shanghai.");
  await page.getByRole("button", { name: "查看初步结果" }).click();

  await expect(page.getByRole("heading", { name: "初步结果" })).toBeVisible();
  await expect(page.getByText("约 Pre-A1")).toBeVisible();
  await expect(page.getByText("依据 6 题")).toBeVisible();
  await expect(page.getByText("这部分跳过了，暂无估计。")).toHaveCount(3);
  await expect(page.getByText(/不是官方 CEFR 认证/)).toBeVisible();
  await page.screenshot({ path: shots("assessment-result"), fullPage: true });

  // Back to onboarding: the first-week summary reflects the choices.
  await page.getByRole("link", { name: "看看第一周计划" }).click();
  await expect(page.getByRole("heading", { name: "你的第一周" })).toBeVisible();
  await expect(page.getByText("每周 4 天，每次 40 分钟")).toBeVisible();
  await expect(page.getByText(/词汇 Pre-A1 · 依据 6 题/)).toBeVisible();
  await page.screenshot({ path: shots("onboarding-summary"), fullPage: true });
  await page.getByRole("button", { name: "开始今天的学习" }).click();

  // Today: the 40-minute plan chosen in onboarding; every task explained.
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("先花几分钟完成首次引导")).toHaveCount(0);
  const tasks = page.getByRole("list", { name: "今日任务" }).getByRole("listitem");
  await expect(page.getByRole("radio", { name: "40 分钟" })).toHaveAttribute("aria-checked", "true");
  const lesson = tasks.filter({ hasText: "Unit 3" }).first();
  await expect(lesson).toContainText(/这是当前单元的下一课|你上次学到一半/);
  await expect(page.getByText(/计划约 40 分钟/)).toBeVisible();

  // Longer session: adds a graded reading or listening near the learner's level.
  await page.getByRole("radio", { name: "60 分钟" }).click();
  await expect(page.getByText(/计划约 60 分钟/)).toBeVisible();
  await expect(tasks.filter({ hasText: /^(阅读|听力)：/ })).toHaveCount(1);
  await page.screenshot({ path: shots("today-plan"), fullPage: true });

  // Reorder: move the last task up one place.
  const count = await tasks.count();
  const lastTitle = (await tasks.nth(count - 1).getByRole("heading").textContent())!;
  await page.getByRole("button", { name: `上移：${lastTitle}` }).click();
  await expect(tasks.nth(count - 2)).toContainText(lastTitle);

  // Skip a task with a reason, then restore it.
  const skippable = tasks.filter({ has: page.getByRole("button", { name: "跳过", exact: true }) }).first();
  const skipTitle = (await skippable.getByRole("heading").textContent())!;
  const first = tasks.filter({ hasText: skipTitle });
  await first.getByRole("button", { name: "跳过" }).click();
  await first.getByText("有点累").click();
  await first.getByRole("button", { name: "确认跳过" }).click();
  await expect(first).toContainText("已跳过 · 有点累");
  await first.getByRole("button", { name: "恢复" }).click();
  await expect(first).not.toContainText("已跳过");

  // Shorter session, then review-only mode.
  await page.getByRole("radio", { name: "15 分钟" }).click();
  await expect(page.getByText(/计划约 15 分钟/)).toBeVisible();
  await page.getByRole("radio", { name: "只复习" }).click();
  await expect(page.getByText(/今天选择了“只复习”|今天没有需要复习的卡片/).first()).toBeVisible();
  await expect(tasks.filter({ hasText: "Unit 3" })).toHaveCount(0);

  // Gentle weekly note, can be hidden.
  await expect(page.getByText(/这周已经学了 \d 天，目标是 4 天/)).toBeVisible();
  await page.getByRole("button", { name: "不再显示每周学习天数" }).click();
  await expect(page.getByText(/目标是 4 天/)).toHaveCount(0);

  // Progress: estimates with evidence, lessons, vocabulary, study time.
  await page.goto("/progress");
  await expect(page.getByText("约 Pre-A1")).toBeVisible();
  await expect(page.getByText("依据 6 题")).toBeVisible();
  await expect(page.getByText(/不是官方 CEFR 认证/)).toBeVisible();
  await expect(page.getByText(/已完成 1 \/ \d+ 节已发布的课/)).toBeVisible();
  await expect(page.getByText("看得懂（被动）")).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近 7 天的学习时间" })).toBeVisible();
  await page.screenshot({ path: shots("progress"), fullPage: true });

  // Settings: profile and study plan are saved to the account.
  await page.goto("/settings");
  await expect(page.getByLabel("讲解语言")).toHaveValue("mixed");
  await expect(page.getByLabel("每次学习时长")).toHaveValue("40");
  await page.getByLabel("每天新卡上限").fill("10");
  await page.getByRole("button", { name: "保存学习计划" }).click();
  await expect(page.getByText(/学习计划已保存/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("每天新卡上限")).toHaveValue("10");

  // Sign out and back in: everything is still there (Phase 1 acceptance).
  await page.getByRole("main").getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await ensureSignedIn(page);
  await page.goto("/progress");
  await expect(page.getByText(/已完成 1 \/ \d+ 节已发布的课/)).toBeVisible();
  await expect(page.getByText("约 Pre-A1")).toBeVisible();
  await expect(page.getByText(/词汇库里共 5 个词/)).toBeVisible();
  await page.goto("/today");
  await expect(page.getByRole("radio", { name: "只复习" })).toHaveAttribute("aria-checked", "true");
});
