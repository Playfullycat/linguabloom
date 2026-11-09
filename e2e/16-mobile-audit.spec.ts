import { expect, test, type Page } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 5 / step 5.3: every main page on a phone-sized screen — no sideways
// scrolling, controls big enough to tap, nothing hidden under the keyboard bar.

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const ROUTES = [
  "/today",
  "/learn/path",
  "/learn/levels/a2",
  "/learn/units/b1-u06-opinions",
  "/lesson/c1-u03-argument-l2",
  "/vocabulary",
  "/review",
  "/grammar",
  "/grammar/discourse-markers",
  "/errors",
  "/reading",
  "/reading/rd-c1-machine-translation",
  "/listening",
  "/listening/ls-b2-saying-no",
  "/pronunciation",
  "/fluency",
  "/fluency/speed_reading/rd-c1-machine-translation",
  "/speaking",
  "/writing",
  "/tutor",
  "/library",
  "/progress",
  "/progress/abilities",
  "/progress/trends",
  "/assessment",
  "/pte",
  "/pte/r_mcma",
  "/pte/report",
  "/settings",
  "/offline",
];

/** Elements wider than the viewport, and tap targets smaller than 24 × 24 px (WCAG 2.2 minimum). */
async function audit(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const wide: string[] = [];
    if (overflow > 1) {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0 && getComputedStyle(el).position !== "fixed") {
          // Skip descendants of an element that scrolls horizontally on purpose.
          let p: HTMLElement | null = el.parentElement;
          let scrolls = false;
          while (p && p !== document.body) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === "auto" || ox === "scroll" || ox === "hidden") scrolls = true;
            p = p.parentElement;
          }
          if (!scrolls) wide.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ").slice(0, 3).join(".")} → ${Math.round(r.right)}px`);
        }
      }
    }
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("a[href], button, [role=button], input, select, textarea"))) {
      let r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || el.closest("[aria-hidden=true], svg, .sr-only")) continue;
      // Inline targets inside running text are exempt (WCAG 2.5.8): plain inline links and tap-a-word buttons.
      if ((el.tagName === "A" && style.display === "inline") || el.hasAttribute("data-inline-target")) continue;
      // A checkbox or radio is tapped through its label, which is the real target.
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        const label = el.closest("label") ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
        if (label) r = label.getBoundingClientRect();
      }
      if (r.width < 24 || r.height < 24) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return { overflow, wide: wide.slice(0, 8), small: small.slice(0, 12) };
  });
}

test("main pages fit a 375px phone screen with tappable controls", async ({ page }) => {
  test.setTimeout(240_000);
  await ensureSignedIn(page);
  const problems: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toBeVisible();
    if (!(await page.locator("main, [role=main]").count())) problems.push(`${route}: no <main> landmark`);
    const result = await audit(page);
    if (result.overflow > 1) problems.push(`${route}: scrolls sideways by ${result.overflow}px (${result.wide.join("; ")})`);
    if (result.small.length > 0) problems.push(`${route}: small tap targets: ${result.small.join("; ")}`);
  }
  await page.goto("/today");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/shots/mobile-today.png", fullPage: true });
  await page.goto("/progress/trends");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "test-results/shots/mobile-trends.png", fullPage: true });
  expect(problems, problems.join("\n")).toEqual([]);
});
