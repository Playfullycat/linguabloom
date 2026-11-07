import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 1 acceptance (spec §13, §14.2 "复习"): words from a completed lesson
// become review cards; reviewing updates them; every review is logged.
// Runs after lesson.spec.ts, which completes lesson 1 of "Hello!" (5 new words).

const GOOD_MORNING = "/vocabulary/pre-a1-u03-hello.good-morning";
const shots = (name: string) => `test-results/shots/${name}.png`;

test("lesson words → vocabulary → review session with typed card, retry and requeue → history and export", async ({ page }) => {
  await ensureSignedIn(page);

  await page.goto("/vocabulary");
  await expect(page.getByRole("link", { name: /Good morning/ }), "lesson.spec.ts should have added the lesson words").toBeVisible();
  await expect(page.getByRole("link", { name: /Good evening/ })).toBeVisible();
  await page.screenshot({ path: shots("vocabulary"), fullPage: true });

  // Suspend the recognition card so the typed recall card (its sibling) comes up today.
  await page.goto(GOOD_MORNING);
  await page.locator("li").filter({ hasText: "英 → 义" }).getByRole("button", { name: "暂停" }).click();
  await expect(page.locator("li").filter({ hasText: "英 → 义" }).getByText("已暂停")).toBeVisible();

  await page.goto("/review");
  await page.screenshot({ path: shots("review-front"), fullPage: true });
  let typedSeen = 0;
  for (let i = 0; i < 12; i++) {
    if (await page.getByText("这一轮复习完成了").isVisible()) break;
    const answer = page.getByLabel("写出英文");
    if (await answer.isVisible()) {
      typedSeen += 1;
      if (typedSeen === 1) {
        await answer.fill("good evening");
        await page.getByRole("button", { name: "检查" }).click();
        await expect(page.getByText(/还不太对/)).toBeVisible();
        await answer.fill("Good morning");
        await page.getByRole("button", { name: "检查" }).click();
        await expect(page.getByText(/这次写对了/)).toBeVisible();
        await page.screenshot({ path: shots("review-typed-wrong"), fullPage: true });
        await page.getByRole("button", { name: "继续（记为“忘记了”）" }).click();
      } else {
        await answer.fill("good morning");
        await page.getByRole("button", { name: "检查" }).click();
        await expect(page.getByText("答对了！")).toBeVisible();
        await page.getByRole("button", { name: /^记得/ }).click();
      }
    } else {
      await page.getByRole("button", { name: "想好了，看答案" }).click();
      await page.getByRole("button", { name: /^记得/ }).click();
    }
    await expect(page.getByText("正在保存…")).toBeHidden();
  }

  await expect(page.getByText("这一轮复习完成了")).toBeVisible();
  // 5 words + the typed card twice more: after Again it relearns (10-minute step, shown again this session).
  await expect(page.getByText(/复习了 7 次，其中 1 次没想起来/)).toBeVisible();
  expect(typedSeen).toBe(3);

  // The word page shows every review of the typed card (append-only history).
  await page.goto(GOOD_MORNING);
  const history = page.locator("section").filter({ hasText: "复习记录" });
  await expect(history.getByText("忘记了")).toHaveCount(1);
  await expect(history.getByText("记得")).toHaveCount(2);
  await page.screenshot({ path: shots("word-detail"), fullPage: true });

  // Export works and contains the word.
  const csv = await page.request.get("/api/export/vocabulary");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Good morning");

  const logs = await page.request.get("/api/export/review-logs");
  expect((await logs.text()).split("\r\n").filter(Boolean).length).toBe(8); // header + 7 reviews
});

test("exports require a session", async ({ request }) => {
  const res = await request.get("/api/export/vocabulary");
  expect(res.status()).toBe(401);
});
