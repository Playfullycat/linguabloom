import { expect, test, type Page } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 3 / step 3.3 (spec §5.10, §7.7, §11.2, §14.2 audio) with the local
// mock AI and Chrome's fake microphone: realtime (simulated) conversation with
// interruption, a dropped connection falling back to the standard voice mode,
// read-aloud, consent for recordings and deleting them, microphone denial and
// a browser without WebRTC.

const shots = (name: string) => `test-results/shots/${name}.png`;

/** Keep every microphone stream the page opens, to prove the tracks are released. */
async function trackMicrophone(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __mics: MediaStream[] };
    w.__mics = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await original(c);
      w.__mics.push(s);
      return s;
    };
  });
}

const micState = (page: Page) =>
  page.evaluate(() => {
    const mics = (window as unknown as { __mics: MediaStream[] }).__mics;
    return { opened: mics.length, live: mics.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length };
  });

const phase = (page: Page) => page.getByTestId("voice-phase");

test("realtime conversation (simulated): states, interruption, end → feedback; no key in the browser", async ({ page }) => {
  await trackMicrophone(page);
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.url().includes("/api/speaking/")) bodies.push(await r.text().catch(() => ""));
  });
  await ensureSignedIn(page);
  await page.goto("/speaking");
  await expect(page.getByRole("heading", { level: 1, name: /Speaking/ })).toBeVisible();
  await page.getByRole("link", { name: /情景对话：咖啡馆点单/ }).click();

  // Consent before anything is recorded.
  await expect(page.getByTestId("speaking-consent")).toContainText("模拟 AI");
  await expect(page.getByLabel(/保存这次的文字转录/)).toBeChecked();
  await expect(page.getByLabel(/保存我的录音/)).not.toBeChecked();
  await page.getByRole("button", { name: "开始实时对话" }).click();

  // connecting → teacher speaks the opening → listening.
  await expect(page.getByTestId("turn-list").filter({ visible: true })).toContainText("Welcome to Corner Café");
  await expect(phase(page)).toHaveAttribute("data-phase", "listening");
  expect((await micState(page)).live).toBeGreaterThan(0);

  await page.getByLabel("模拟说一句").fill("Can I have a coffee, please?");
  await page.getByRole("button", { name: "模拟说话" }).click();
  await expect(page.getByTestId("turn-list").filter({ visible: true })).toContainText("Can I have a coffee, please?");
  // Interrupt the teacher while it is speaking.
  await expect(phase(page)).toHaveAttribute("data-phase", "speaking");
  await page.getByRole("button", { name: "打断老师" }).click();
  await expect(phase(page)).toHaveAttribute("data-phase", "listening");
  await expect(page.getByTestId("turn-list").filter({ visible: true })).toContainText("（被打断）");

  await page.getByLabel("模拟说一句").fill("A small one, please. I like coffee very much.");
  await page.getByRole("button", { name: "模拟说话" }).click();
  await expect(page.getByTestId("turn-list").filter({ visible: true })).toContainText("I like coffee very much");
  await page.screenshot({ path: shots("speaking-realtime"), fullPage: true });

  await page.getByRole("button", { name: "结束练习" }).click();
  await expect(page).toHaveURL(/\/speaking\/attempts\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("speaking-feedback")).toBeVisible();
  await expect(page.getByText(/不是 PTE 或任何官方考试的评分/)).toBeVisible();
  await expect(page.getByText(/没有评价发音/)).toBeVisible();
  await expect(page.getByTestId("privacy-summary")).toContainText("转录：已保存 · 录音：没有保存");
  await expect(page.getByLabel("对话记录").filter({ visible: true })).toContainText("Can I have a coffee, please?");
  await page.screenshot({ path: shots("speaking-feedback"), fullPage: true });

  // The microphone is released; no provider key ever reached the browser.
  expect(await micState(page)).toMatchObject({ live: 0 });
  expect(bodies.join("\n")).toContain("mock-answer");
  expect(bodies.join("\n")).not.toContain("sk-e2e-never-leak");
  expect(await page.content()).not.toContain("sk-e2e-never-leak");
});

test("dropped connection: clear reason, mic released, fall back to the standard voice mode", async ({ page }) => {
  await trackMicrophone(page);
  await ensureSignedIn(page);
  await page.goto("/speaking/sp-opinion-city");
  await page.getByRole("button", { name: "开始实时对话" }).click();
  await expect(phase(page)).toHaveAttribute("data-phase", "listening");
  await page.getByRole("button", { name: "模拟断线" }).click();

  await expect(phase(page)).toHaveAttribute("data-phase", "failed");
  await expect(page.getByText(/连接中断了/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重新连接" })).toBeVisible();
  expect(await micState(page)).toMatchObject({ live: 0 });

  await page.getByRole("button", { name: "改用标准语音模式" }).click();
  await expect(page.getByText(/已改用标准语音模式/)).toBeVisible();
  await expect(page.getByText(/标准语音模式：每次说完按停止/)).toBeVisible();

  // Record one turn with the fake microphone.
  await page.getByRole("button", { name: "按下开始说" }).click();
  await expect(phase(page)).toHaveAttribute("data-phase", "recording");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "说完了" }).click();
  await expect(page.getByTestId("turn-list").filter({ visible: true })).toContainText("She like reading books in the evening.");
  await expect(page.getByTestId("turn-list").filter({ visible: true })).toContainText("（模拟）");
  expect(await micState(page)).toMatchObject({ live: 0 });
  await page.screenshot({ path: shots("speaking-standard"), fullPage: true });

  // The typed fallback works inside the same session.
  await page.getByRole("button", { name: "改用文字回答" }).click();
  await page.getByLabel("你的回答").fill("I prefer the city because there are many jobs.");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByTestId("turn-list").filter({ visible: true })).toContainText("many jobs");

  await page.getByRole("button", { name: "结束练习" }).click();
  await expect(page).toHaveURL(/\/speaking\/attempts\//);
  await expect(page.getByTestId("speaking-feedback")).toBeVisible();
  await expect(page.getByText("She like reading books in the evening.").first()).toBeVisible();

  // Both attempts are in the history: the dropped realtime one and the standard one.
  await page.goto("/speaking");
  await expect(page.getByTestId("speaking-history").getByRole("link", { name: /观点表达：城市还是乡村/ })).toHaveCount(2);
});

test("read aloud with a saved recording; deleting the recording, then the session", async ({ page }) => {
  await ensureSignedIn(page);
  await page.goto("/speaking/sp-read-greetings");
  await page.getByLabel(/保存我的录音/).check();
  await expect(page.getByText(/录音会保存在这台服务器上/)).toBeVisible();
  await page.getByRole("button", { name: "开始录音练习" }).click();

  await page.getByRole("button", { name: "开始录音" }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /读完了/ }).click();
  await expect(page.getByTestId("item-score")).toHaveText("识别出 4 / 5 个词");
  await expect(page.getByTestId("compared-sentence").locator(".underline")).toHaveText("Anna.");
  await expect(page.getByText(/这不是发音评分/)).toBeVisible();
  await page.screenshot({ path: shots("speaking-read-aloud"), fullPage: true });

  await page.getByRole("button", { name: "结束练习" }).click();
  await expect(page).toHaveURL(/\/speaking\/attempts\//);
  await expect(page.getByTestId("privacy-summary")).toContainText("录音：已保存 1 段");
  await expect(page.getByTestId("recordings").locator("audio")).toHaveCount(1);
  await expect(page.getByLabel("对话记录").filter({ visible: true })).toContainText("第 1 句：Hello! My name is Anna.（识别出 80%）");

  await page.getByRole("button", { name: "删除录音" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "删除录音" }).click();
  await expect(page.getByTestId("privacy-summary")).toContainText("录音：已删除或没有录到");
  await expect(page.getByTestId("recordings")).toHaveCount(0);

  await page.getByRole("button", { name: "删除这次练习" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "删除" }).click();
  await expect(page).toHaveURL(/\/speaking$/);
});

test("microphone denied and no WebRTC: explained, with working fallbacks; privacy settings", async ({ page, context }) => {
  await ensureSignedIn(page);

  // No WebRTC: the realtime option is replaced by the standard mode, and the page says so.
  const noRtc = await context.newPage();
  await noRtc.addInitScript(() => {
    delete (window as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection;
  });
  await noRtc.goto("/speaking/sp-guided-family");
  await expect(noRtc.getByText(/不支持实时语音（WebRTC）/)).toBeVisible();
  await expect(noRtc.getByRole("button", { name: "开始实时对话" })).toHaveCount(0);
  await expect(noRtc.getByRole("button", { name: "标准语音模式" })).toBeVisible();
  await noRtc.close();

  // Microphone permission denied.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await page.goto("/speaking/sp-guided-family");
  await page.getByRole("button", { name: "开始实时对话" }).click();
  await expect(phase(page)).toHaveAttribute("data-phase", "failed");
  await expect(page.getByText(/没有拿到麦克风权限/)).toBeVisible();

  await page.goto("/speaking/sp-guided-family");
  await page.getByRole("button", { name: "用文字回答" }).click();
  await expect(page.getByTestId("turn-list").filter({ visible: true })).toContainText("Who is in your family?");
  await page.getByLabel("你的回答").fill("There are three people in my family.");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByTestId("turn-list").filter({ visible: true })).toContainText("three people");

  // Settings: defaults for speaking privacy and the saved-session count.
  await page.goto("/settings");
  await expect(page.getByText(/已保存 \d+ 次口语练习/)).toBeVisible();
  await expect(page.getByLabel("口语练习默认保存文字转录")).toBeChecked();
  await expect(page.getByLabel(/口语练习默认保存录音/)).not.toBeChecked();
  await expect(page.getByText(/语音：实时对话 可用/)).toBeVisible();
});
