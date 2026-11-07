import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 2 / step 2.1 (spec §5.6, §5.7, §13 Phase 2): read, look words up,
// collect them; listen sentence by sentence with subtitles, dictation and
// key-word listening. Runs last: it adds a word to the vocabulary.

const MIA = "/reading/rd-pa1-this-is-mia";
const CLASSMATE = "/listening/ls-pa1-new-classmate";
const shots = (name: string) => `test-results/shots/${name}.png`;

test("reading room: difficulty hint, tap a word, collect it, Chinese support, questions, notes", async ({ page }) => {
  await ensureSignedIn(page);

  await page.goto("/reading");
  const card = page.getByRole("link", { name: /This Is Mia/ });
  await expect(card).toContainText("适合你");
  await expect(card).toContainText("生词 9");
  await page.screenshot({ path: shots("reading-list"), fullPage: true });
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${MIA}$`));

  // Beginners start with sentence translations.
  await expect(page.getByRole("radio", { name: "逐句翻译" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("我叫米娅。")).toBeVisible();

  // Glossary word → word card → add to vocabulary.
  await page.getByRole("button", { name: "查看生词：friend" }).click();
  const wordCard = page.getByRole("region", { name: "friend" });
  await expect(wordCard).toContainText("朋友");
  await expect(wordCard).toContainText("本文生词表");
  await expect(wordCard).toContainText("This is my friend Ben.");
  await page.screenshot({ path: shots("reading-word-card"), fullPage: true });
  await wordCard.getByRole("button", { name: "加入词汇库" }).click();
  await expect(wordCard.getByRole("status")).toContainText("已加入词汇库");
  await expect(wordCard).toContainText("已在词汇库");

  // "Just looking": no definition outside the glossary and courses, nothing added.
  await page.getByRole("button", { name: "Mia", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Mia" })).toContainText("暂时没有释义");
  await page.getByRole("button", { name: "关闭词卡" }).click();

  // Key-word hints, then English only.
  await page.getByRole("radio", { name: "关键词提示" }).click();
  await expect(page.locator("rt", { hasText: "老师" })).toBeVisible();
  await expect(page.getByText("我叫米娅。")).toHaveCount(0);
  await page.getByRole("radio", { name: "全英文" }).click();
  await expect(page.locator("rt")).toHaveCount(0);

  // Save a sentence.
  await page.getByRole("button", { name: "收藏第 4 句" }).click();
  await expect(page.getByRole("button", { name: "收藏第 4 句" })).toHaveAttribute("aria-pressed", "true");

  // Comprehension: a wrong answer points back to the sentence.
  await page.getByText("十一岁").first().click();
  await page.getByRole("button", { name: "提交第 1 题" }).click();
  await expect(page.getByText(/正确答案：十岁/)).toBeVisible();
  await page.getByRole("button", { name: "回到原句" }).click();
  await expect(page.locator("#segment-1")).toBeFocused();
  await page.getByText("加拿大").first().click();
  await page.getByRole("button", { name: "提交第 2 题" }).click();
  await expect(page.getByText(/已答 2 \/ 3 题，答对 1 题/)).toBeVisible();

  // Note, favourite, finished.
  await page.getByLabel("阅读笔记").fill("years old = 岁");
  await page.getByRole("button", { name: "保存笔记" }).click();
  await expect(page.getByText("笔记已保存。")).toBeVisible();
  await page.getByRole("button", { name: "收藏这篇" }).click();
  await expect(page.getByRole("button", { name: "已收藏" })).toBeVisible();
  await page.getByRole("button", { name: "读完了" }).click();
  await expect(page.getByText("这篇已经读完了")).toBeVisible();
  await page.screenshot({ path: shots("reading-room"), fullPage: true });

  // Everything is still there after a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "收藏第 4 句" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("阅读笔记")).toHaveValue("years old = 岁");
  await expect(page.getByText(/正确答案：十岁/)).toBeVisible();
  await expect(page.getByRole("button", { name: "查看生词：friend（已在词汇库）" })).toBeVisible();

  // The collected word is in the vocabulary lab, linked to its source.
  await page.goto("/vocabulary/rd-pa1-this-is-mia.friend");
  await expect(page.getByRole("link", { name: /阅读：This Is Mia/ })).toBeVisible();
  await page.goto("/reading");
  await expect(page.getByRole("link", { name: /This Is Mia/ })).toContainText("生词 8");
});

test("listening studio: listen first, subtitles, sentence playback, dictation and key words", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/listening");
  await page.getByRole("link", { name: /A New Classmate/ }).click();
  await expect(page).toHaveURL(new RegExp(`${CLASSMATE}$`));

  // Listen first: the transcript is hidden until the learner reveals it.
  await expect(page.getByRole("radio", { name: "隐藏" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Hello, Anna.")).toHaveCount(0);
  await page.getByRole("radio", { name: "英文", exact: true }).click();
  await expect(page.getByText(/Hello, Anna\./)).toBeVisible();
  await page.getByRole("radio", { name: "双语" }).click();
  await expect(page.getByText("很高兴认识你，利奥。")).toBeVisible();

  // Sentence playback and speed (browser speech).
  await page.getByRole("radio", { name: "1.25×" }).click();
  await page.getByRole("button", { name: "播放第 3 句" }).click();
  await expect(page.getByText("正在第 3 / 9 句")).toBeVisible();
  await page.getByRole("button", { name: "单句循环" }).click();
  await expect(page.getByRole("button", { name: "单句循环" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: shots("listening-studio"), fullPage: true });

  // Dictation: word-by-word feedback.
  await page.getByRole("radio", { name: "逐句听写" }).click();
  await page.getByLabel("写下你听到的句子").fill("Hi, I'm Anna");
  await page.getByRole("button", { name: "检查" }).click();
  await expect(page.getByText("完全正确！")).toBeVisible();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await page.getByLabel("写下你听到的句子").fill("Hello Anna I am Leo");
  await page.getByRole("button", { name: "检查" }).click();
  await expect(page.getByText(/绿色是写对的/)).toBeVisible();
  await expect(page.getByText("本轮写对 1 / 2")).toBeVisible();
  await page.screenshot({ path: shots("listening-dictation"), fullPage: true });

  // Key-word listening.
  await page.getByRole("radio", { name: "关键词听辨" }).click();
  await page.getByLabel("填入你听到的词").fill("wrong");
  await page.getByRole("button", { name: "检查" }).click();
  await expect(page.getByText(/绿色是写对的|完全正确/)).toBeVisible();

  await page.getByRole("button", { name: "听完了" }).click();
  await expect(page.getByText("这段已经听完了。")).toBeVisible();
  await page.goto("/listening");
  await expect(page.getByRole("link", { name: /A New Classmate/ }).getByLabel("已完成")).toBeVisible();
});
