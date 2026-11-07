import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 2 acceptance, import part (spec §5.14, §13 Phase 2): import a legal
// text and a subtitle file with audio, preview and save, then read / look up /
// listen sentence by sentence; import a word list into review.

const shots = (name: string) => `test-results/shots/${name}.png`;

/** A valid 5-second silent WAV (8 kHz, 8-bit mono). */
function wav(seconds = 5): Buffer {
  const data = 8000 * seconds;
  const b = Buffer.alloc(44 + data, 0x80);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(data, 40);
  return b;
}

const SRT = "1\n00:00:00,500 --> 00:00:02,000\nHello, Anna.\n\n2\n00:00:02,500 --> 00:00:04,500\nHow are you today?\n";

test("import a text: preview, confirm, read and look up", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/library");
  await page.getByLabel("标题").fill("My morning notes");
  await page.getByLabel("粘贴内容").fill("# Morning\n\nHello! I walk to the park every morning. It is quiet and green.\n\nThen I have breakfast.");
  await page.getByText("我自己写的", { exact: true }).click();
  await page.getByRole("button", { name: "解析并预览" }).click();

  // Draft preview: numbers computed from the text, sentences split.
  await expect(page).toHaveURL(/\/library\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "难度分析" })).toBeVisible();
  await expect(page.getByRole("list", { name: "分句预览" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByLabel(/建议值按句长/)).toHaveValue("a1");
  await page.screenshot({ path: shots("library-preview"), fullPage: true });

  // Not in the reading list until confirmed.
  await page.goto("/reading");
  await expect(page.getByRole("link", { name: /My morning notes/ })).toHaveCount(0);
  await page.goto("/library");
  await page.getByRole("link", { name: "My morning notes" }).click();
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page).toHaveURL(/\/reading\/imp-/);
  await expect(page.getByText("我的材料").first()).toBeVisible();

  // Lookup: a course word is found (already learned in lesson 1), others have no definition yet.
  await page.getByRole("button", { name: "Hello", exact: true }).click();
  const card = page.getByRole("region", { name: /hello/i });
  await expect(card).toContainText("课程词汇");
  await expect(card).toContainText("已在词汇库");
  await page.getByRole("button", { name: "park", exact: true }).click();
  await expect(page.getByRole("region", { name: "park" })).toContainText("暂时没有释义");
  await page.screenshot({ path: shots("library-reading"), fullPage: true });
  await page.goto("/reading");
  await expect(page.getByRole("link", { name: /My morning notes/ })).toBeVisible();
});

test("import subtitles with audio: timed sentences, A-B loop, dictation; delete", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/library");
  await page.getByRole("radio", { name: "听力", exact: true }).click();
  await page.getByLabel("标题").fill("Meeting Anna");
  await page.getByLabel(/或者选择文件/).setInputFiles({ name: "meeting.srt", mimeType: "application/x-subrip", buffer: Buffer.from(SRT) });
  await page.getByLabel(/音频（可选/).setInputFiles({ name: "meeting.wav", mimeType: "audio/wav", buffer: wav() });
  await page.getByText("合法获得，仅供个人学习", { exact: true }).click();
  await page.getByRole("button", { name: "解析并预览" }).click();

  await expect(page.getByText(/音频：meeting\.wav.*可以逐句对齐/)).toBeVisible();
  await expect(page.getByText("0:02.5")).toBeVisible();
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page).toHaveURL(/\/listening\/imp-/);

  // Owner-only audio with Range support.
  const src = await page.locator("audio").getAttribute("src");
  expect(src).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);
  const partial = await page.request.get(src!, { headers: { Range: "bytes=0-99" } });
  expect(partial.status()).toBe(206);
  expect(partial.headers()["content-range"]).toMatch(/^bytes 0-99\/40044$/);
  expect((await partial.body()).subarray(0, 4).toString()).toBe("RIFF");

  // Listen first, then subtitles; sentence playback from the real recording.
  const sentences = page.getByRole("list", { name: "逐句播放" });
  await expect(sentences.getByText("How are you today?")).toHaveCount(0);
  await page.getByRole("radio", { name: "英文", exact: true }).click();
  await expect(sentences.getByText("How are you today?")).toBeVisible();
  await page.getByRole("button", { name: "播放第 2 句" }).click();
  await expect(page.getByText("正在第 2 / 2 句")).toBeVisible();
  await page.getByRole("button", { name: "设为 A 点" }).click();
  await page.getByRole("button", { name: "设为 B 点" }).click();
  await expect(page.getByRole("group", { name: "A-B 循环" })).toContainText("A 0:");
  await page.getByRole("button", { name: "清除" }).click();
  await page.screenshot({ path: shots("library-listening"), fullPage: true });

  await page.getByRole("radio", { name: "逐句听写" }).click();
  await page.getByLabel("写下你听到的句子").fill("hello anna");
  await page.getByRole("button", { name: "检查" }).click();
  await expect(page.getByText("完全正确！")).toBeVisible();

  // Delete it again: the material and its audio are gone.
  await page.goto("/library");
  await page.getByRole("button", { name: "删除：Meeting Anna" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("link", { name: "Meeting Anna" })).toHaveCount(0);
  expect((await page.request.get(src!)).status()).toBe(404);
});

test("import a word list into the vocabulary lab", async ({ page, request }) => {
  await ensureSignedIn(page);
  await page.goto("/library");
  await page.getByRole("radio", { name: "词表", exact: true }).click();
  await page.getByLabel("标题").fill("Office words");
  await page.getByLabel("粘贴内容").fill("word,meaning,example\nmeeting,会议,The meeting starts at ten.\ndeadline,截止日期,\nhello,你好,");
  await page.getByText("我自己写的", { exact: true }).click();
  await page.getByRole("button", { name: "解析并预览" }).click();
  await expect(page.getByRole("heading", { name: /词表预览（3 个词）/ })).toBeVisible();
  await expect(page.getByText("词汇库已有，跳过")).toBeVisible();
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText(/已加入词汇库 2 个词，跳过 1 个已有的词/)).toBeVisible();
  await page.goto("/vocabulary");
  await expect(page.getByRole("link", { name: /deadline/ })).toBeVisible();

  // Media needs a session.
  expect((await request.get("/api/media/00000000-0000-4000-8000-000000000000")).status()).toBe(401);
});
