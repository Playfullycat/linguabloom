import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 5 / step 5.3: installable PWA, offline review with sync, weak-network banner.

const shots = (name: string) => `test-results/shots/${name}.png`;

test("manifest and icons make the app installable", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const body = await manifest.json();
  expect(body).toMatchObject({ name: "LinguaBloom", display: "standalone", start_url: "/today" });
  for (const icon of body.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
  const sw = await request.get("/sw.js");
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(await sw.text()).toContain("lb-shell-");
});

test("offline: banner, cached offline page, review without network, sync once back online", async ({ page, context }) => {
  await ensureSignedIn(page);
  await page.goto("/today");
  // The service worker is installed and the offline pack is downloaded in the background.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("lb.offline.pack.v1") ?? "null")?.cards?.length ?? 0), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("lb.offline.pack.v1")!).cards.length as number);

  // Losing the connection shows the banner on any page.
  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await page.screenshot({ path: shots("offline-banner"), fullPage: false });

  // A full page load while offline gets the cached offline page.
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "离线复习" })).toBeVisible();
  await expect(page.getByTestId("offline-status")).toContainText("离线中");
  await expect(page.getByText(`还剩 ${before} 张`)).toBeVisible();

  const card = page.getByTestId("offline-card");
  if (await card.getByRole("textbox").count()) {
    await card.getByRole("textbox").fill("zzz");
    await card.getByRole("button", { name: "检查" }).click();
  } else {
    await card.getByRole("button", { name: "显示答案" }).click();
  }
  await expect(page.getByTestId("offline-answer")).toBeVisible();
  await page.screenshot({ path: shots("offline-review"), fullPage: true });
  await page.getByRole("group", { name: "这次记得怎么样？" }).getByRole("button").first().click();
  await expect(page.getByTestId("offline-pending")).toHaveText("1 条复习记录等待同步");
  if (before > 1) await expect(page.getByText(`还剩 ${before - 1} 张`)).toBeVisible();

  // Back online: the answer is sent automatically, once.
  await context.setOffline(false);
  await expect(page.getByTestId("offline-status")).toContainText("已联网");
  await expect(page.getByTestId("offline-pending")).toHaveText("没有待同步的记录", { timeout: 15_000 });
  const queue = await page.evaluate(() => localStorage.getItem("lb.offline.queue.v1"));
  expect(JSON.parse(queue ?? "[]")).toEqual([]);
});
