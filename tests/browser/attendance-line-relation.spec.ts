import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, options: { evidence?: boolean; reject?: boolean; staff?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  let savedAlias = "";
  let staffGroup = false;
  const student = { student_number: "relation-test", student_name: "続柄試験", grade: "中1", campus: "本校" };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/attendance/students") return route.fulfill({ json: { students: options.staff ? [] : [student] } });
    if (path === "/api/attendance/candidates") return route.fulfill({ json: { candidates: [{
      id: "relation-candidate", student_number: options.staff ? null : student.student_number, student_roster: options.staff ? null : student,
      status: "pending", event_type: "absence", event_date: "2099-09-11", ai_summary: "欠席",
      sender_profile: { display_name: "sample-line", alias_names: [savedAlias || "sample-line"], account_names: [], tag_names: staffGroup ? ["スタッフ"] : [] },
      line_messages: { id: options.evidence === false ? undefined : "test-evidence", line_user_id: "test-line-user", display_name: "sample-line", text: "続柄試験です。欠席します" },
    }] } });
    if (path === "/api/admin/contacts/test-line-user") {
      expect(route.request().method()).toBe("PUT");
      const body = route.request().postDataJSON(); writes.push(body);
      if (options.reject) return route.fulfill({ status: 500, json: { error: "保存できませんでした" } });
      expect(body.group_name).toBe("スタッフ"); savedAlias = body.alias_name; staffGroup = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/admin/contacts/test-line-user/verify") {
      expect(route.request().method()).toBe("POST"); writes.push(route.request().postDataJSON());
      if (options.reject) return route.fulfill({ status: 409, json: { error: "確認メッセージが一致しません" } });
      savedAlias = route.request().postDataJSON().targets[0].alias_name;
      return route.fulfill({ json: { ok: true } });
    }
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: {} });
  });
  await page.goto("/attendance");
  const registration = page.getByRole("button", { name: "生徒本人・保護者を登録", exact: true });
  await expect(registration).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("group", { name: "1. LINEの利用者を選ぶ" })).toHaveCount(0);
  await registration.click();
  await expect(page.getByText("生徒本人・保護者のLINE登録", { exact: true })).toBeVisible();
  await expect(page.getByText("2. 対象の生徒を選ぶ", { exact: true })).toBeVisible();
  await expect(page.getByText("3. 表示名・確認者名を確認して登録", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "LINE登録を閉じる", exact: true }).click();
  await expect(page.getByRole("group", { name: "1. LINEの利用者を選ぶ" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "LINEへ送信", exact: true })).toBeVisible();
  await registration.click();
  await expect(registration).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "LINE登録を閉じる", exact: true }).click();
  await expect(page.getByRole("group", { name: "1. LINEの利用者を選ぶ" })).toHaveCount(0);
  await expect(registration).toHaveAttribute("aria-expanded", "false");
  await registration.click();
  await expect(page.getByRole("button", { name: "この内容で登録して一覧の名前を更新" })).toBeDisabled();
  await page.getByLabel("LINE登録の確認者名", { exact: true }).fill("試験職員");
  return writes;
}

for (const [label, relation, primary] of [["生徒本人", "student", true], ["保護者", "guardian", false], ["本人・保護者で共有", "shared", false]] as const) {
  test(`${label} registration uses the chosen relation and primary setting`, async ({ page }) => {
    const writes = await setup(page);
    const alias = `本　続柄試験${relation === "student" ? "" : relation === "shared" ? "　生徒・保護者共有" : "　保護者"}`;
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByLabel("登録後に一覧へ表示する名前")).toHaveValue(alias);
    page.on("dialog", async (dialog) => { expect(dialog.message()).toContain(alias); await dialog.accept(); });
    await page.getByRole("button", { name: "この内容で登録して一覧の名前を更新" }).click();
    await expect(page.getByText(`${alias} として登録しました。一覧の登録名も更新しました。`, { exact: true })).toBeVisible();
    expect(writes).toEqual([{ targets: [{ student_number: "relation-test", relation, is_primary: primary, alias_name: alias }], friend_display_name: "sample-line", evidence_message_id: "test-evidence", verified_by: "試験職員", source: "attendance_review" }]);
    await expect(page.getByText(`${alias}（sample-line）`, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(`${alias}（sample-line）`, { exact: true })).toBeVisible();
  });
}

test("cancelling student registration sends no update", async ({ page }) => {
  const writes = await setup(page);
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "生徒本人", exact: true }).click();
  await page.getByRole("button", { name: "この内容で登録して一覧の名前を更新" }).click();
  expect(writes).toHaveLength(0);
});

test("rejected registration retains the original name and allows correction", async ({ page }) => {
  await setup(page, { reject: true });
  await page.getByRole("button", { name: "生徒本人", exact: true }).click();
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "この内容で登録して一覧の名前を更新" }).click();
  await expect(page.getByText("確認メッセージが一致しません", { exact: true })).toBeVisible();
  await expect(page.getByText("sample-line（sample-line）", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "この内容で登録して一覧の名前を更新" })).toBeEnabled();
});

test("missing evidence cannot register even with student, role and operator", async ({ page }) => {
  const writes = await setup(page, { evidence: false });
  await page.getByRole("button", { name: "保護者", exact: true }).click();
  await expect(page.getByRole("button", { name: "この内容で登録して一覧の名前を更新" })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test("staff is a peer choice and registers without a student, refreshing name and staff tag", async ({ page }) => {
  const writes = await setup(page, { staff: true });
  const choices = page.getByRole("group", { name: "1. LINEの利用者を選ぶ" });
  for (const role of ["生徒本人", "保護者", "先生・スタッフ", "本人・保護者で共有"]) await expect(choices.getByRole("button", { name: role, exact: true })).toBeVisible();
  await choices.getByRole("button", { name: "先生・スタッフ", exact: true }).click();
  await expect(page.getByRole("button", { name: "先生・スタッフとして保存して一覧を更新" })).toBeDisabled();
  await expect(page.getByText("連絡した生徒", { exact: true })).toHaveCount(0);
  await page.getByLabel("先生・スタッフの登録名").fill("試験先生");
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "先生・スタッフとして保存して一覧を更新" }).click();
  await expect(page.getByText("試験先生（sample-line）", { exact: true })).toBeVisible();
  await expect(page.getByText("スタッフ", { exact: true })).toBeVisible();
  expect(writes).toEqual([{ alias_name: "試験先生", group_name: "スタッフ" }]);
  await page.reload();
  await expect(page.getByText("試験先生（sample-line）", { exact: true })).toBeVisible();
});

test("staff save failure keeps the input and original name", async ({ page }) => {
  await setup(page, { staff: true, reject: true });
  await page.getByRole("button", { name: "先生・スタッフ", exact: true }).click();
  await page.getByLabel("先生・スタッフの登録名").fill("試験先生");
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "先生・スタッフとして保存して一覧を更新" }).click();
  await expect(page.getByText("保存できませんでした", { exact: true })).toBeVisible();
  await expect(page.getByLabel("先生・スタッフの登録名")).toHaveValue("試験先生");
  await expect(page.getByText("sample-line（sample-line）", { exact: true })).toBeVisible();
});
