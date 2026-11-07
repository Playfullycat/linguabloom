import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 3 / step 3.2 (spec §5.11, §10.3, §10.4) with the local mock AI:
// writing → layered feedback → second version; AI word explanations;
// generated material is a draft until confirmed; AI micro-lessons.

const shots = (name: string) => `test-results/shots/${name}.png`;
const TEXT = "My name is Lin. I very busy every day. She go to work by bus. I like music and I have a apple every morning. I live in Hangzhou with my family.";

test("writing studio: layered feedback, second version with comparison, errors into the notebook", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/writing");
  await page.getByRole("link", { name: /介绍一下你自己/ }).click();
  await page.getByLabel("你的英文").fill(TEXT);
  await expect(page.getByText(/个词（建议 30–70）/)).toBeVisible();
  await page.getByRole("button", { name: "提交，看反馈" }).click();

  await expect(page).toHaveURL(/\/writing\/[0-9a-f-]{36}$/);
  await expect(page.getByText("先改这几处")).toBeVisible();
  const grammar = page.getByRole("region", { name: /^语法/ });
  await expect(grammar.getByText("✓ I am very busy every day.")).toBeVisible();
  await expect(grammar.getByText("✓ She goes to work by bus.")).toBeVisible();
  await expect(page.getByText(/不是官方考试评分/)).toBeVisible();
  await page.getByText("看看示范（建议先自己改一遍再看）").click();
  await expect(page.getByText(/I have an apple every morning/).first()).toBeVisible();
  await page.screenshot({ path: shots("writing-feedback"), fullPage: true });

  await page.getByLabel("按反馈自己改一遍，写第二版").fill(TEXT.replace("I very busy", "I am very busy").replace("She go", "She goes").replace("a apple", "an apple"));
  await page.getByRole("button", { name: "提交第二版" }).click();
  await expect(page.getByRole("heading", { name: /第二版的反馈/ })).toBeVisible();
  await expect(page.getByText("第一版的语法问题都改好了")).toBeVisible();
  await expect(page.getByLabel("改动对比").locator("ins").first()).toContainText("am");
  await page.screenshot({ path: shots("writing-revision"), fullPage: true });

  // Sure grammar problems from writing are in the error notebook, linked to grammar points.
  await page.goto("/errors?status=active");
  await expect(page.getByRole("link", { name: /be 动词 am \/ is \/ are/ })).toBeVisible();

  // A failed AI call keeps the text; feedback can be requested again.
  await page.goto("/writing/new?prompt=w-a1-my-weekend");
  await page.getByLabel("你的英文").fill("[mock:error:timeout] On Saturday I get up late and I play football with my friends in the park.");
  await page.getByRole("button", { name: "提交，看反馈" }).click();
  await expect(page.getByText(/这篇还没有反馈/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重新请求反馈" })).toBeVisible();
  await page.goto("/writing");
  await expect(page.getByText("等待反馈")).toBeVisible();
});

test("AI explains a word in context, and the learner can keep it", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/reading/rd-pa1-this-is-mia");
  await page.getByRole("button", { name: "Mia", exact: true }).first().click();
  const card = page.getByRole("region", { name: "Mia" });
  await card.getByRole("button", { name: "用 AI 解释" }).click();
  await expect(card.getByText("AI 生成，可能有误")).toBeVisible();
  await expect(card.getByText("（模拟释义）Mia")).toBeVisible();
  await card.getByRole("button", { name: "加入词汇库" }).click();
  await expect(card.getByText("已加入词汇库。")).toBeVisible();
});

test("generated graded material and an imported text's glossary are drafts until confirmed", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/library");
  await page.getByRole("radio", { name: "对话（听力）" }).click();
  await page.getByLabel("话题").fill("cooking");
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page).toHaveURL(/\/library\/ai\/[0-9a-f-]{36}$/);
  await expect(page.getByText("AI 生成（模拟）")).toBeVisible();
  await expect(page.getByText("草稿", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Lin:\s*Hi Max, do you like cooking\?/)).toBeVisible();
  await page.screenshot({ path: shots("generation-preview"), fullPage: true });
  await page.getByRole("button", { name: "确认，加入学习库" }).click();
  await expect(page).toHaveURL(/\/listening\/ai-ls-/);
  await expect(page.getByText(/AI 生成的虚构内容/)).toBeVisible();

  // Imported text without glossary → AI proposes one (an invented word is dropped).
  await page.goto("/library");
  await page.getByLabel("标题").fill("Farmers market");
  await page.getByLabel("粘贴内容").fill("Every Saturday we visit the farmers market. The vegetables are fresh and cheap. My grandmother chooses tomatoes carefully.");
  await page.getByText("我自己写的", { exact: true }).click();
  await page.getByRole("button", { name: "解析并预览" }).click();
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page).toHaveURL(/\/reading\/imp-/);
  await page.getByRole("button", { name: "AI 生成生词表和理解题" }).click();
  await expect(page.getByText(/“notinthetextatall”不在原文里，已去掉/)).toBeVisible();
  await page.getByRole("button", { name: "确认，加到这份材料上" }).click();
  await expect(page).toHaveURL(/\/reading\/imp-/);
  await expect(page.getByRole("heading", { name: "理解练习" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^查看生词：/ }).first()).toBeVisible();
});

test("an AI micro-lesson for a recurring error, practised after confirmation", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/errors?status=active");
  await page.getByRole("link", { name: /be 动词 am \/ is \/ are/ }).first().click();
  await page.getByRole("button", { name: "生成 AI 微课" }).click();
  await expect(page.getByText("（模拟微课）再看一遍这个错误")).toBeVisible();
  await expect(page.getByText("第 4 道题格式不对，已去掉。")).toBeVisible();
  await page.getByRole("button", { name: "开始练习这 3 道题" }).click();
  await expect(page.getByText(/第 1 \/ 3 题/)).toBeVisible();
  await page.getByRole("group", { name: "选项" }).locator("label").first().click();
  await page.getByRole("button", { name: "检查" }).click();
  await expect(page.getByText("答对了！")).toBeVisible();
  await page.screenshot({ path: shots("micro-lesson"), fullPage: true });
});
