import { expect, test } from "@playwright/test";

test("ambiguous siblings remain unselected and only the chosen lesson is colored", async ({ page }) => {
  const sister = { student_number: "sister", student_name: "山田 花子", grade: "中2", campus: "本校", homeroom_teacher: "佐藤" };
  const brother = { student_number: "brother", student_name: "山田 太郎", grade: "小6", campus: "本校", homeroom_teacher: "鈴木" };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/attendance/students") return route.fulfill({ json: { students: [sister, brother] } });
    if (url.pathname === "/api/attendance/candidates") return route.fulfill({ json: { candidates: [{
      id: "sibling-candidate",
      student_number: null,
      student_roster: null,
      student_selection_required: true,
      student_selection_reason: "同じLINE連絡先の2名から選んでください。",
      student_suggestions: [sister, brother],
      status: "pending",
      event_type: "absence",
      event_date: "2099-09-11",
      ai_summary: "体調不良",
      ai_confidence: 0.5,
      sender_profile: { display_name: "山田保護者", alias_names: ["山田保護者"], account_names: [], tag_names: [] },
      line_messages: { id: "message-1", line_user_id: "line-family", display_name: "山田保護者", text: "今日は欠席します", received_at: "2099-09-10T09:00:00Z" },
      attendance_candidate_items: [{ id: "item-1", student_number: null, event_type: "absence", event_date: "2099-09-11", lesson_id: null, suggested_subject: null, suggested_class_name: null, ai_summary: "体調不良", status: "pending" }],
      reply_messages: [],
    }] } });
    if (url.pathname === "/api/attendance/lessons") return route.fulfill({ json: { lessons: [
      { id: "math", label: "数学A", lesson_date: "2099-09-11", start_time: "17:00", campus: "本校", classroom: "A", enrolled: true },
      { id: "english", label: "英語B", lesson_date: "2099-09-11", start_time: "19:00", campus: "本校", classroom: "B", enrolled: true },
    ] } });
    if (url.pathname === "/api/attendance/status") return route.fulfill({ json: {} });
    if (url.pathname === "/api/attendance/extract") return route.fulfill({ json: { processed: 0, candidates: 0, ignored: 0, retrying: 0, dead: 0 } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/attendance");
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  const siblingChoices = page.getByRole("group", { name: "連絡した生徒の候補" });
  const sisterButton = siblingChoices.getByRole("button", { name: "中2 山田 花子", exact: true });
  const brotherButton = siblingChoices.getByRole("button", { name: "小6 山田 太郎", exact: true });
  await expect(sisterButton).toHaveAttribute("aria-pressed", "false");
  await expect(brotherButton).toHaveAttribute("aria-pressed", "false");

  await sisterButton.click();
  const math = page.getByRole("button", { name: /数学A/ });
  const english = page.getByRole("button", { name: /英語B/ });
  await expect(math).toHaveAttribute("aria-pressed", "false");
  await expect(english).toHaveAttribute("aria-pressed", "false");
  await expect(math).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(english).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await math.click();
  await expect(math).toHaveAttribute("aria-pressed", "true");
  await expect(english).toHaveAttribute("aria-pressed", "false");
  await english.click();
  await expect(math).toHaveAttribute("aria-pressed", "false");
  await expect(math).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(english).toHaveAttribute("aria-pressed", "true");
});
