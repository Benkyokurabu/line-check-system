import { expect, test } from "@playwright/test";

test("生徒一覧から本人LINEの名前を迷わず変更できる", async ({ page }) => {
  let savedName = "本　試験一郎";
  const writes: Record<string, unknown>[] = [];
  const student = () => ({
    student_number: "UI-NAME",
    student_name: "試験一郎",
    grade: "中1",
    campus: "本校",
    homeroom_teacher: "試験先生",
    line_user_id: "student-line",
    message_count: 3,
    latest_at: null,
    line_accounts: [{
      line_user_id: "student-line",
      relation: "student",
      alias_name: savedName,
      friend_display_name: "いちろう",
      is_primary: true,
    }],
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "PUT") {
      expect(path).toBe("/api/students/UI-NAME/line-name");
      const body = request.postDataJSON();
      writes.push(body);
      savedName = body.alias_name;
      return route.fulfill({ json: { ok: true, alias_name: savedName } });
    }
    if (path === "/api/admin/teachers") return route.fulfill({ json: { teachers: [{ display_name: "試験先生" }] } });
    if (path === "/api/classes") return route.fulfill({ json: { classes: [] } });
    if (path === "/api/students") return route.fulfill({ json: { students: [student()] } });
    if (path === "/api/admin/contacts") return route.fulfill({ json: { contacts: [{ line_user_id: "student-line", display_name: "いちろう", alias_name: savedName }] } });
    if (path === "/api/students/UI-NAME/messages") return route.fulfill({ json: {
      student: student(), line_user_id: "student-line", selected_account: student().line_accounts[0], link_status: "linked", messages: [],
    } });
    return route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/students");
  await expect(page.getByText("LINEの生徒名を直すとき")).toBeVisible();
  await page.getByRole("button", { name: "名前を直す", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "試験一郎さんの名前を直す" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("LINEアプリ側の表示名：いちろう")).toBeVisible();
  await dialog.getByLabel("生徒一覧に表示する名前").fill("本　試験一郎（新）");
  await expect(dialog.getByRole("button", { name: "この名前で保存" })).toBeDisabled();
  await dialog.getByLabel("変更した先生・スタッフ名").fill("確認職員");
  await dialog.getByRole("button", { name: "この名前で保存" }).click();

  await expect(dialog.getByRole("status")).toContainText("変更しました");
  expect(writes).toEqual([{ line_user_id: "student-line", alias_name: "本　試験一郎（新）", performed_by: "確認職員" }]);
  await expect(page.getByRole("row").filter({ hasText: "UI-NAME" })).toContainText("本　試験一郎（新）");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
