import { expect, test, type Page } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Book recommendations and the reading shelf: start a book, log reading time, finish it.

const shots = (name: string) => `test-results/shots/${name}.png`;
const BOOK = "Green Eggs and Ham";

/** Open one level of the full list (setting "open" directly: a click would close an already open one). */
async function openLevel(page: Page, label: string) {
  await page
    .locator("details > summary")
    .filter({ hasText: new RegExp(`^${label}\\s*\\d+ 本$`) })
    .evaluate((el) => ((el.parentElement as HTMLDetailsElement).open = true));
}

test("book list: recommendations by level, start reading, log time, finish", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/reading");
  await page.getByRole("link", { name: "书单推荐" }).click();
  await expect(page).toHaveURL(/\/reading\/books$/);
  await expect(page.getByRole("heading", { name: "我的阅读" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "全部书单" })).toBeVisible();
  await expect(page.getByText(/书单只提供书目信息和推荐理由/)).toBeVisible();

  // Graded readers name their series and stage; public-domain originals link to a search for the original.
  await openLevel(page, "B1");
  await expect(page.getByText("Oxford Bookworms Library · Stage 3").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /在 Project Gutenberg 搜索原著/ }).first()).toHaveAttribute("href", /gutenberg\.org\/ebooks\/search/);

  await openLevel(page, "Pre-A1");
  await page.getByRole("button", { name: `开始读：${BOOK}` }).first().click();
  const reading = page.getByRole("region", { name: "在读" });
  await expect(reading.getByText(BOOK)).toBeVisible();

  const form = reading.getByRole("form", { name: `记录阅读：${BOOK}` });
  await form.getByLabel("读了几分钟").fill("15");
  await form.getByLabel("页数（可不填）").fill("12");
  await form.getByRole("button", { name: "记录" }).click();
  await expect(form.getByText("记下了 15 分钟，已计入本周的阅读输入。")).toBeVisible();
  await expect(reading.getByText(/共读了 15 分钟 · 12 页/)).toBeVisible();
  await expect(page.getByText(/^\d+ 分钟$/).first()).toBeVisible();
  await page.screenshot({ path: shots("books-reading"), fullPage: true });

  await reading.getByRole("button", { name: `读完了：${BOOK}` }).click();
  const finished = page.getByRole("region", { name: "读完了" });
  await expect(finished.getByText(BOOK)).toBeVisible();
  await expect(page.getByRole("region", { name: "在读" })).toHaveCount(0);
  await expect(finished.getByText(/读完了 · .* 读完 · 共读了 15 分钟/)).toBeVisible();
});
