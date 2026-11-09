import { expect, test, type Page } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Fluency development (spec §2.2): speed reading, repeated reading aloud and
// 4/3/2 timed retelling on a known text. The browser clock is faked so the
// timed rounds take no real time.

const shots = (name: string) => `test-results/shots/${name}.png`;
const MIA = "rd-pa1-this-is-mia"; // 41 words

/** Stop the page's clock so only fastForward moves it (rounds then take exact times). */
const freeze = (page: Page) => page.clock.pauseAt(new Date(Date.now() + 2_000));

test("fluency hub explains the three activities and is in the practice menu", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/practice");
  await page.getByRole("link", { name: /流利度/ }).first().click();
  await expect(page).toHaveURL(/\/fluency$/);
  await expect(page.getByRole("heading", { name: "三种练法" })).toBeVisible();
  for (const name of ["快速阅读", "重复朗读", "限时复述（4/3/2）"]) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("本周流利度")).toBeVisible();
});

test("speed reading: timed, text hidden for the questions, speed worked out on the server", async ({ page }) => {
  await ensureSignedIn(page);
  await page.clock.install();
  await page.goto(`/fluency/speed_reading/${MIA}`);
  await freeze(page);
  await expect(page.getByRole("heading", { name: "快速阅读" })).toBeVisible();
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.getByText("This is Mia", { exact: false }).first()).toBeVisible();
  await page.clock.fastForward(20_500);
  await expect(page.getByRole("timer")).toHaveText("0:20");
  await page.getByRole("button", { name: "读完了" }).click();

  await expect(page.getByText("原文已收起")).toBeVisible();
  await expect(page.locator('[lang="en"] p')).toHaveCount(0);
  const submit = page.getByRole("button", { name: "提交答案" });
  await expect(submit).toBeDisabled();
  for (const group of await page.getByRole("group").all()) await group.getByRole("radio").first().check();
  await submit.click();

  await expect(page.getByRole("heading", { name: /完成了/ })).toBeVisible();
  await expect(page.getByText("120", { exact: true })).toBeVisible(); // 41 words in 20.5 s
  await expect(page.getByText(/理解题答对 \d\/3/)).toBeVisible();
  await page.screenshot({ path: shots("fluency-speed-result"), fullPage: true });
});

test("repeated reading: three rounds, faster each time", async ({ page }) => {
  await ensureSignedIn(page);
  await page.clock.install();
  await page.goto(`/fluency/repeated_reading/${MIA}`);
  await freeze(page);
  for (const [i, ms] of [24_600, 20_500, 16_400].entries()) {
    await page.getByRole("button", { name: `开始第 ${i + 1} 遍` }).click();
    await expect(page.getByRole("heading", { name: `第 ${i + 1} / 3 遍：大声读` })).toBeVisible();
    await page.clock.fastForward(ms);
    await page.getByRole("button", { name: "读完了" }).click();
  }
  await expect(page.getByRole("heading", { name: /完成了/ })).toBeVisible();
  const rows = page.getByRole("table", { name: "每一遍的用时" }).getByRole("row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText("150");
  await expect(page.getByText(/第三遍比第一遍快了 33%/)).toBeVisible();
});

test("timed retelling: read first, then three shrinking rounds that end by themselves", async ({ page }) => {
  await ensureSignedIn(page);
  await page.clock.install();
  await page.goto(`/fluency/timed_retell/${MIA}`);
  await freeze(page);
  await expect(page.getByText("60 秒 → 45 秒 → 30 秒")).toBeVisible();
  await page.getByRole("button", { name: "先读原文" }).click();
  await page.getByRole("button", { name: /准备好了，开始第 1 遍/ }).click();

  // The text is hidden; cue words stay. Time runs out on its own.
  await expect(page.getByText("提示词（按原文顺序）：")).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("heading", { name: "第 1 遍：时间到" })).toBeVisible();
  const next = page.getByRole("button", { name: /开始第 2 遍（45 秒）/ });
  await expect(next).toBeDisabled(); // rate the round first
  await page.getByRole("radio", { name: "卡住好几次" }).check();
  await page.getByRole("button", { name: /再看一眼原文/ }).click();
  await expect(page.getByRole("button", { name: "收起原文" })).toBeVisible();
  await next.click();

  await page.clock.fastForward(40_000);
  await page.getByRole("button", { name: "讲完了" }).click();
  await page.getByRole("radio", { name: "还可以，停了几次" }).check();
  await page.getByRole("button", { name: /开始第 3 遍（30 秒）/ }).click();
  await page.clock.fastForward(29_000);
  await page.getByRole("button", { name: "讲完了" }).click();
  await page.getByRole("radio", { name: "讲得很顺" }).check();
  await page.getByRole("button", { name: "完成" }).click();

  await expect(page.getByRole("heading", { name: /完成了/ })).toBeVisible();
  await expect(page.getByText(/已经能自动说出来了/)).toBeVisible();
  await page.screenshot({ path: shots("fluency-retell-result"), fullPage: true });

  // The hub lists the records and counts the week's fluency time (real time again: streaming needs timers).
  await page.clock.resume();
  await page.goto("/fluency");
  await expect(page.getByText(/已练 [1-9]\d* 分钟/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近的练习" })).toBeVisible();
  await expect(page.getByText(/120 词\/分钟/).first()).toBeVisible();
  await page.screenshot({ path: shots("fluency-hub"), fullPage: true });
});
