import { expect, test } from "@playwright/test";
import { setupRegistration } from "./registration-fixture";

test("remembered confirmer follows attendance into LINE registration and survives reload", async ({ page }) => {
  const { writes } = await setupRegistration(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/attendance");
  const chooser = page.getByLabel("LINE確認担当者");
  await expect(chooser.getByLabel("確認担当者を選択")).toBeVisible();
  await chooser.getByLabel("確認担当者を選択").selectOption("試験先生");
  await chooser.getByRole("button", { name: "この担当者で続ける" }).click();
  await expect(chooser).toContainText("確認担当者：試験先生");
  await page.reload();
  await expect(chooser).toContainText("確認担当者：試験先生");
  await page.getByRole("link", { name: "兄弟・双子のLINE紐付け", exact: true }).click();
  const form = page.getByRole("region", { name: "生徒本人・保護者のLINE登録", exact: true });
  await expect(form.getByLabel("LINE登録の確認者名")).toHaveValue("試験先生");
  await expect(form.getByLabel("LINE登録の確認者名")).toHaveAttribute("readonly", "");
  const picker = page.getByRole("dialog", { name: "LINE登録・修正" }).getByLabel("LINE確認担当者");
  await picker.getByRole("button", { name: "担当者を変更" }).click();
  await expect(form.getByRole("button", { name: "この内容で登録して一覧の名前を更新" })).toBeDisabled();
  await picker.getByLabel("確認担当者を選択").selectOption({ label: "候補にない担当者" });
  await picker.getByLabel("担当者名").fill("試験職員");
  await picker.getByRole("button", { name: "この担当者で続ける" }).click();
  await expect(form.getByLabel("LINE登録の確認者名")).toHaveValue("試験職員");
  page.on("dialog", dialog => dialog.accept());
  const save = form.getByRole("button", { name: "この内容で登録して一覧の名前を更新" });
  await save.dblclick();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ verified_by: "試験職員" });
  expect(await picker.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "保存しました。欠席確認に戻る" }).click();
  await expect(page.locator('[aria-label="LINE確認担当者"]')).toContainText("確認担当者：試験職員");
});

test("blocked browser storage prevents an unremembered confirmer from being used", async ({ page }) => {
  const { writes } = await setupRegistration(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "line-contact-operator-name") throw new Error("storage disabled");
      return original.call(this, key, value);
    };
  });
  await page.goto("/attendance");
  const chooser = page.getByLabel("LINE確認担当者");
  await chooser.getByLabel("確認担当者を選択").selectOption("試験先生");
  await chooser.getByRole("button", { name: "この担当者で続ける" }).click();
  await expect(chooser.getByRole("alert")).toContainText("保存できません");
  await page.getByRole("link", { name: "兄弟・双子のLINE紐付け", exact: true }).click();
  await expect(page.getByRole("region", { name: "生徒本人・保護者のLINE登録", exact: true }).getByRole("button", { name: "この内容で登録して一覧の名前を更新" })).toBeDisabled();
  expect(writes).toHaveLength(0);
});
