/**
 * Capture README screenshots from a running instance (real pages, real data).
 *
 *   SHOT_BASE_URL=http://localhost:3000 SHOT_EMAIL=... SHOT_PASSWORD=... \
 *     npx tsx scripts/capture-screenshots.ts
 *
 * Writes PNGs to docs/screenshots/. Uses the installed Google Chrome.
 * The password is read from the environment and never written anywhere.
 */
import { mkdirSync } from "node:fs";

import { chromium, type Page } from "@playwright/test";

const base = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const email = process.env.SHOT_EMAIL;
const password = process.env.SHOT_PASSWORD;
if (!email || !password) {
  console.error("Set SHOT_EMAIL and SHOT_PASSWORD (an existing owner account).");
  process.exit(1);
}

const outDir = "docs/screenshots";
mkdirSync(outDir, { recursive: true });

async function shot(page: Page, path: string, name: string) {
  await page.goto(`${base}${path}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`saved ${outDir}/${name}.png`);
}

const browser = await chromium.launch({ channel: "chrome" });
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await desktop.newPage();

  await shot(page, "/login", "login");

  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/today");

  await shot(page, "/today", "today");
  await shot(page, "/learn", "learn");
  await shot(page, "/settings", "settings");

  // Dark theme (stored like a real user choice).
  await page.evaluate(() => localStorage.setItem("lb-theme", "dark"));
  await shot(page, "/today", "today-dark");

  const cookies = await desktop.cookies();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  await mobile.addCookies(cookies);
  await shot(await mobile.newPage(), "/today", "today-mobile");
} finally {
  await browser.close();
}
