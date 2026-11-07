import { expect, test } from "@playwright/test";

import { TEST_OWNER, expectSignedIn, formAlert, signIn } from "./fixtures";

// Phase 0 acceptance (spec §13, §14.2 "用户与设置"). Tests share one database, in order.
test.describe.configure({ mode: "serial" });

test("first run: setup creates the owner, signs in, and then closes", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel("怎么称呼你").fill(TEST_OWNER.name);
  await page.getByLabel("邮箱（用于登录）").fill(TEST_OWNER.email);
  await page.getByLabel("密码", { exact: true }).fill(TEST_OWNER.password);
  await page.getByLabel("再次输入密码").fill(TEST_OWNER.password);
  await page.getByRole("button", { name: "创建账户并开始" }).click();

  await expectSignedIn(page);
  await expect(page.getByText(TEST_OWNER.email)).toBeVisible(); // sidebar account

  // Session survives a reload.
  await page.reload();
  await expectSignedIn(page);

  // Setup can't be used again.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/today$/);
});

test("signed-out visitors are sent to login; wrong credentials get a generic error", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, "definitely-wrong-password");
  await expect(formAlert(page)).toHaveText("邮箱或密码不正确。");

  // Unknown account: same message (no account enumeration).
  await page.getByLabel("邮箱").fill("someone-else@linguabloom.test");
  await page.getByLabel("密码", { exact: true }).fill("whatever-password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(formAlert(page)).toHaveText("邮箱或密码不正确。");
});

test("sign in, sign out, and protected pages are closed again", async ({ page }) => {
  await signIn(page);
  await expectSignedIn(page);

  await page.goto("/settings");
  await page.getByRole("main").getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);
});

test("owner can change the password; only the new one works afterwards", async ({ page }) => {
  await signIn(page);
  await expectSignedIn(page);

  await page.goto("/settings");
  await page.getByLabel("当前密码").fill(TEST_OWNER.password);
  await page.getByLabel("新密码", { exact: true }).fill(TEST_OWNER.newPassword);
  await page.getByLabel("再次输入新密码").fill(TEST_OWNER.newPassword);
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(page).toHaveURL(/\/settings\?passwordChanged=1$/);
  await expect(page.getByRole("status").filter({ hasText: "密码已更新" })).toBeVisible();

  // This device stays signed in with its new session.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);

  await page.getByRole("main").getByRole("button", { name: "退出登录" }).click();
  await signIn(page, TEST_OWNER.password);
  await expect(formAlert(page)).toHaveText("邮箱或密码不正确。");

  await signIn(page, TEST_OWNER.newPassword);
  await expectSignedIn(page);
});

test("sign out of all devices ends every session", async ({ browser }) => {
  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  const pageA = await deviceA.newPage();
  const pageB = await deviceB.newPage();

  await signIn(pageA, TEST_OWNER.newPassword);
  await expectSignedIn(pageA);
  await signIn(pageB, TEST_OWNER.newPassword);
  await expectSignedIn(pageB);

  await pageA.goto("/settings");
  await pageA.getByRole("button", { name: "退出所有设备" }).click();
  await pageA.getByRole("alertdialog").getByRole("button", { name: "全部退出" }).click();
  await expect(pageA).toHaveURL(/\/login$/);

  // The other device still has its cookie, but the session is gone server-side.
  await pageB.goto("/today");
  await expect(pageB).toHaveURL(/\/login$/);

  await deviceA.close();
  await deviceB.close();
});
