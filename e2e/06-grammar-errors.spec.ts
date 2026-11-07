import { expect, test } from "@playwright/test";

import { ensureSignedIn } from "./fixtures";

// Phase 2 / step 2.2 (spec §5.5, §5.12, §2.8): grammar map → grammar point →
// five exercise types → wrong answers in the error notebook → remediation round.

const shots = (name: string) => `test-results/shots/${name}.png`;

test("grammar studio: map, point page, five exercise types, errors into the notebook, remediation", async ({ page }) => {
  await ensureSignedIn(page);

  // Map in teaching order, with filters and planned points.
  await page.goto("/grammar");
  await expect(page.getByRole("link", { name: /be 动词 am \/ is \/ are/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /比较级/ })).toContainText("规划中");
  await page.getByRole("navigation", { name: "按等级筛选" }).getByRole("link", { name: "A2" }).click();
  await expect(page.getByRole("link", { name: /be 动词/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /一般过去时/ })).toBeVisible();
  await page.screenshot({ path: shots("grammar-map"), fullPage: true });

  // Point page: rule, breakdown, common errors, where it's taught.
  await page.goto("/grammar/articles");
  await expect(page.getByRole("heading", { name: "规则" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "句子拆解" })).toBeVisible();
  await expect(page.getByText("表语 / 补语").first()).toBeVisible();
  await expect(page.getByText("She is doctor.")).toBeVisible();
  const practice = page.locator("#practice");

  // Two wrong answers → two occurrences of the same error.
  await practice.getByText("a", { exact: true }).click();
  await practice.getByRole("button", { name: "检查" }).click();
  await expect(practice.getByText("还不太对。")).toBeVisible();
  await expect(practice.getByText(/已记入/)).toBeVisible();
  await practice.getByRole("button", { name: "下一题" }).click();
  await practice.getByText("A", { exact: true }).click();
  await practice.getByRole("button", { name: "检查" }).click();
  await expect(practice.getByText("正确答案：The")).toBeVisible();

  // Word order: tap the words in order.
  await practice.getByRole("button", { name: /^第 7 题/ }).click();
  for (const w of ["There", "is", "an", "apple", "on", "the", "table"]) {
    await practice.getByRole("group", { name: "可选的词" }).or(practice.locator('[aria-label="可选的词"]')).getByRole("button", { name: w, exact: true }).first().click();
  }
  await practice.getByRole("button", { name: "检查" }).click();
  await expect(practice.getByText("答对了！")).toBeVisible();

  // Sentence building: write, compare with the checklist, self-assess.
  await practice.getByRole("button", { name: /^第 8 题/ }).click();
  await practice.getByLabel("写下你的句子").fill("I have a cat. The cat is black.");
  await practice.getByRole("button", { name: "写好了，对照检查" }).click();
  for (const box of await practice.getByRole("checkbox").all()) await box.check();
  await practice.getByRole("button", { name: "提交自评" }).click();
  await expect(practice.getByText(/已记录你的自评（100%）/)).toBeVisible();
  await page.screenshot({ path: shots("grammar-point"), fullPage: true });

  // Error notebook: the repeated error asks for remediation.
  await page.goto("/errors");
  const item = page.getByRole("link", { name: /冠词 a \/ an \/ the/ });
  await expect(item).toContainText("需要补救");
  await expect(item).toContainText("出现 2 次");
  await page.screenshot({ path: shots("error-notebook"), fullPage: true });
  await item.click();
  await expect(page.getByRole("heading", { name: "出错记录" })).toBeVisible();

  // Remediation: 3 exercises, the two missed ones first.
  await page.getByRole("button", { name: "开始补救练习（3 道题）" }).click();
  await page.getByRole("group", { name: "选项" }).getByText("an", { exact: true }).click();
  await page.getByRole("button", { name: "检查" }).click();
  await expect(page.getByText("答对了！")).toBeVisible();
  await page.getByRole("button", { name: "下一题" }).click();
  await page.getByRole("group", { name: "选项" }).getByText("The", { exact: true }).click();
  await page.getByRole("button", { name: "检查" }).click();
  await page.getByRole("button", { name: "下一题" }).click();
  await page.getByLabel("填入空格").fill("an");
  await page.getByRole("button", { name: "检查" }).click();
  await expect(page.getByText(/补救练习通过了/)).toBeVisible();
  await expect(page.getByText(/起可以再测/)).toBeVisible();
  await page.screenshot({ path: shots("error-remediation"), fullPage: true });

  // Note.
  await page.getByLabel("我的备注").fill("职业前要加 a / an");
  await page.getByRole("button", { name: "保存备注" }).click();
  await expect(page.getByText("备注已保存。")).toBeVisible();

  // The grammar point now shows where it went wrong; progress shows the category.
  await page.goto("/grammar/articles");
  await expect(page.getByRole("link", { name: /冠词 · 出现 2 次/ })).toBeVisible();
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "错误类型与语法薄弱点" })).toBeVisible();
  await expect(page.getByText("冠词").first()).toBeVisible();
});
