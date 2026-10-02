import { expect, test } from "@playwright/test";
import { setupRegistration } from "./registration-fixture";
for (const [label, relation] of [["生徒本人", "student"], ["保護者", "guardian"], ["本人・保護者で共有", "shared"]]) {
  test(`attendance opens the dedicated page and registers ${relation}`, async ({ page }) => {
    const { writes } = await setupRegistration(page);
    await page.goto("/attendance");
    await page.getByRole("textbox", { name: "確認者名", exact: true }).fill("試験職員");
    await page.getByRole("link", { name: "兄弟・双子のLINE紐付け", exact: true }).click();
    await expect(page).toHaveURL(/\/line-registration\?/);
    const form = page.getByRole("region", { name: "生徒本人・保護者のLINE登録", exact: true });
    await form.getByRole("button", { name: label, exact: true }).click();
    await expect(form.getByLabel("LINE登録の確認者名")).toHaveValue("試験職員");
    page.on("dialog", dialog => dialog.accept());
    await form.getByRole("button", { name: "この内容で登録して一覧の名前を更新" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body).toMatchObject({ verified_by: "試験職員", evidence_message_id: "ui-evidence", source: "attendance_review", targets: [{ student_number: "UI-ONE", relation, is_primary: relation === "student" }] });
    await page.getByRole("button", { name: "保存しました。欠席確認に戻る", exact: true }).click();
    await expect(page).toHaveURL(/\/attendance$/);
    await expect(page.getByRole("textbox", { name: "確認者名", exact: true })).toHaveValue("試験職員");
  });
}
for (const reject of [false, true]) test(`siblings preserve existing registration on mobile; reject=${reject}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes } = await setupRegistration(page, { relation: "mother", reject });
  await page.goto("/attendance");
  await page.getByRole("textbox", { name: "確認者名", exact: true }).fill("試験職員");
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  const reply = page.locator("textarea").last();
  await reply.fill("保存前の返信下書き");
  await page.getByRole("link", { name: "兄弟・双子のLINE紐付け", exact: true }).click();
  const form = page.getByRole("region", { name: "生徒本人・保護者のLINE登録", exact: true });
  await expect(form.getByRole("button", { name: "試験一郎 を外す", exact: true })).toBeVisible();
  await expect(form.getByLabel("保護者の続柄")).toHaveValue("mother");
  await form.getByLabel("生徒を検索", { exact: true }).fill("試験二郎");
  await form.getByRole("button", { name: /UI-TWO/ }).click();
  const commonAlias = "本　試験一郎　母 / 本　試験二郎　母";
  await expect(form.getByLabel("登録後に一覧へ表示する共通の名前")).toHaveValue(commonAlias);
  const back = page.getByRole("button", { name: "← 欠席確認に戻る", exact: true });
  const bounds = await back.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  if (!reject) await page.screenshot({ path: "analysis_outputs/line-registration-page-mobile.png", fullPage: false });
  page.on("dialog", dialog => dialog.accept());
  await form.getByRole("button", { name: "この内容で登録して一覧の名前を更新" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.targets).toEqual(["UI-ONE", "UI-TWO"].map(student_number => ({ student_number, relation: "mother", alias_name: commonAlias, is_primary: false })));
  if (reject) { await expect(form.getByRole("status")).toContainText("保存できませんでした"); await expect(form.getByLabel("登録後に一覧へ表示する共通の名前")).toHaveValue(commonAlias); }
  else await expect(page.getByRole("button", { name: "保存しました。欠席確認に戻る", exact: true })).toBeVisible();
  await back.click();
  await expect(reply).toHaveValue("保存前の返信下書き");
});
test("missing evidence and cancel do not write", async ({ page }) => {
  const { writes } = await setupRegistration(page, { evidence: false, relation: "guardian" });
  await page.goto("/attendance");
  await page.getByRole("link", { name: "兄弟・双子のLINE紐付け", exact: true }).click();
  await page.getByLabel("LINE登録の確認者名").fill("試験職員");
  await expect(page.getByRole("button", { name: "この内容で登録して一覧の名前を更新" })).toBeDisabled();
  await page.getByRole("button", { name: "← 欠席確認に戻る", exact: true }).click();
  expect(writes).toHaveLength(0);
});

test("existing twins stay selected when the page is reopened", async ({ page }) => {
  const { writes } = await setupRegistration(page, { relation: "mother", siblings: true });
  await page.goto("/attendance");
  await page.getByRole("link", { name: "兄弟・双子のLINE紐付け", exact: true }).click();
  const form = page.getByRole("region", { name: "生徒本人・保護者のLINE登録", exact: true });
  for (const name of ["試験一郎", "試験二郎"]) await expect(form.getByRole("button", { name: `${name} を外す`, exact: true })).toBeVisible();
  await expect(form.getByLabel("登録後に一覧へ表示する共通の名前")).toHaveValue("旧登録名");
  await page.getByRole("button", { name: "← 欠席確認に戻る", exact: true }).click();
  expect(writes).toHaveLength(0);
});
