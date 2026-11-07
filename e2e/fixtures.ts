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
