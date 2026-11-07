import { expect, test, type Page } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 3 / step 3.1 (spec §5.9, §7.6, §14.2 AI): AI Tutor with the local mock
// provider — structured corrections, new words, streamed conversation,
// understandable errors, saved sessions, settings, and no key in the browser.

const KEY = "sk-e2e-never-leak-0123456789";
const shots = (name: string) => `test-results/shots/${name}.png`;

/** Collect every text response the browser receives, to check for the key. */
function watchForKey(page: Page) {
  const leaks: string[] = [];
  page.on("response", async (res) => {
    const type = res.headers()["content-type"] ?? "";
    if (!/text|javascript|json|ndjson|x-component/.test(type)) return;
    const body = await res.text().catch(() => "");
    if (body.includes(KEY)) leaks.push(res.url());
  });
  return leaks;
}

test("tutor: corrections, new words, conversation, errors, sessions; the key never reaches the browser", async ({ page }) => {
  const leaks = watchForKey(page);
  await ensureSignedIn(page);
  await page.goto("/tutor");
  await expect(page.getByText("模拟 AI：未连接真实服务")).toBeVisible();
  await expect(page.getByText(/按 (Pre-A1|A1|A2) 调整/)).toBeVisible();

  // Correct my sentence: validated structured reply.
  await page.locator("label").filter({ hasText: "Correct my sentence" }).click();
  await page.getByLabel("你的消息").fill("I very busy today.");
  await page.getByRole("button", { name: "发送" }).click();
  const conversation = page.getByRole("list", { name: "对话" });
  await expect(conversation.getByText("✓ I am very busy today.")).toBeVisible();
  await expect(conversation.getByText("形容词前面少了 be 动词（am / is / are）。")).toBeVisible();
  await page.getByRole("button", { name: "加入词汇库：practice" }).click();
  await expect(conversation.getByText("已加入")).toBeVisible();
  await page.screenshot({ path: shots("tutor-correct"), fullPage: true });

  // A provider failure is shown in plain words, and the chat keeps working.
  await page.getByLabel("你的消息").fill("[mock:error:timeout] hello");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("AI 服务响应太慢，已经超时。请稍后再试。")).toBeVisible();

  // Conversation: streamed text, and "check this sentence" on demand.
  await page.locator("label").filter({ hasText: "Conversation" }).first().click();
  await page.getByLabel("你的消息").fill("He go to work by bus.");
  await page.keyboard.press("Enter");
  await expect(conversation.getByText(/That sounds nice!/)).toBeVisible();
  await page.getByRole("button", { name: "检查这句" }).click();
  await expect(conversation.getByText("✓ He goes to work by bus.")).toBeVisible();
  await page.screenshot({ path: shots("tutor-conversation"), fullPage: true });

  // Saved conversations: listed, reopened, deleted.
  await page.reload();
  const saved = page.getByRole("complementary", { name: "保存的对话" });
  // The inline "check" did not create a conversation of its own.
  await expect(saved.getByRole("button", { name: /^He go to work by bus. 自由对话/ })).toBeVisible();
  await expect(saved.getByRole("button", { name: /^He go to work by bus. 纠错/ })).toHaveCount(0);
  await saved.getByRole("button", { name: /^I very busy today. 纠错/ }).click();
  await expect(conversation.getByText("✓ I am very busy today.")).toBeVisible();
  await saved.getByRole("button", { name: "删除对话：He go to work by bus." }).click();
  await expect(saved.getByRole("button", { name: /He go to work by bus/ })).toHaveCount(0);

  // The word suggested by the tutor is in the vocabulary lab.
  await page.goto("/vocabulary");
  await expect(page.getByRole("link", { name: /practice/ })).toBeVisible();

  // Reading coach from a material page knows which text we're reading.
  await page.goto("/reading/rd-pa1-this-is-mia");
  await page.getByRole("link", { name: "问 AI 阅读教练" }).click();
  await expect(page.getByText(/正在陪你读：This Is Mia/)).toBeVisible();
  await page.getByLabel("你的消息").fill("What does sentence 2 mean?");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(conversation.getByText(/模拟回复/)).toBeVisible();

  // Settings: status, usage, and switching conversation saving off.
  await page.goto("/settings");
  const ai = page.locator("section, div").filter({ has: page.getByRole("heading", { name: /AI 服务/ }) }).first();
  await expect(page.getByText("模拟 AI（本地，不联网）")).toBeVisible();
  await expect(page.getByText(/^\d+ 次$/).first()).toBeVisible();
  await page.getByLabel(/保存 AI 对话/).uncheck();
  await expect(page.getByText(/以后的 AI 对话不再保存/)).toBeVisible();
  await page.screenshot({ path: shots("settings-ai"), fullPage: true });
  void ai;

  // Nothing the browser received contains the provider key.
  expect(leaks).toEqual([]);
  for (const path of ["/tutor", "/settings", "/today"]) {
    expect(await (await page.request.get(path)).text()).not.toContain(KEY);
  }
});

test("tutor API needs a session", async ({ request }) => {
  const res = await request.post("/api/ai/chat/stream", { data: { mode: "conversation", message: "hi" } });
  expect(res.status()).toBe(401);
});
