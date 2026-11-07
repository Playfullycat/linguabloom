import { expect, type Page } from "@playwright/test";

/** Test-only owner account, created in the throwaway test database. */
export const TEST_OWNER = {
  name: "E2E Learner",
  email: "e2e-owner@linguabloom.test",
  password: "e2e-initial-password-1",
  newPassword: "e2e-changed-password-2",
} as const;

export async function signIn(page: Page, password: string = TEST_OWNER.password) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(TEST_OWNER.email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
}

export async function expectSignedIn(page: Page) {
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { name: /Welcome to LinguaBloom/ })).toBeVisible();
}

/** The form's own alert (Next.js also renders an empty route-announcer with role="alert"). */
export function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

/**
 * Sign in for specs that run after auth.spec.ts (which changes the password),
 * or set up the owner when the test database is still fresh.
 */
export async function ensureSignedIn(page: Page) {
  await page.goto("/");
  await page.waitForURL(/\/(setup|login|today)$/);
  if (page.url().endsWith("/today")) return;
  if (page.url().endsWith("/setup")) {
    await page.getByLabel("怎么称呼你").fill(TEST_OWNER.name);
    await page.getByLabel("邮箱（用于登录）").fill(TEST_OWNER.email);
    await page.getByLabel("密码", { exact: true }).fill(TEST_OWNER.password);
    await page.getByLabel("再次输入密码").fill(TEST_OWNER.password);
    await page.getByRole("button", { name: "创建账户并开始" }).click();
    await expectSignedIn(page);
    return;
  }
  for (const password of [TEST_OWNER.newPassword, TEST_OWNER.password]) {
    await signIn(page, password);
    if (await page.waitForURL(/\/today$/, { timeout: 5_000 }).then(() => true, () => false)) return;
  }
  throw new Error("Could not sign in with any known test password.");
}
