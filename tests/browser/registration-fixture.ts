import { expect, type Page } from "@playwright/test";
export async function setupRegistration(page: Page, options: { relation?: string; linked?: boolean; evidence?: boolean; reject?: boolean; loadFail?: boolean; siblings?: boolean } = {}) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let alias = "旧登録名";
  let relation = options.relation ?? "student";
  let linked = options.linked !== false;
  let numbers = linked ? options.siblings ? ["UI-ONE", "UI-TWO"] : ["UI-ONE"] : [];
  let group = relation === "staff" ? "スタッフ" : null;
  const student = { student_number: "UI-ONE", student_name: "試験一郎", grade: "中1", campus: "本校", homeroom_teacher: "試験先生", instruction_type: "集団", message_count: 1, latest_at: null };
  const sibling = { ...student, student_number: "UI-TWO", student_name: "試験二郎" };
  const accounts = () => numbers.map(number => ({ student_number: number, student_name: number === "UI-ONE" ? student.student_name : sibling.student_name, relation, alias_name: alias, friend_display_name: "登録試験LINE", verification_status: "confirmed", is_primary: relation === "student" }));
  const contact = () => ({ line_user_id: "ui-line", display_name: "登録試験LINE", alias_name: alias, group_name: group, pending_evidence: !linked, system_verified: linked, registered_accounts: accounts() });
  const messages = options.evidence === false ? [] : [{ id: "ui-evidence", text: "試験一郎と試験二郎の保護者です。", direction: "inbound", message_type: "text", created_at: "2026-10-02T00:00:00Z" }];
  const studentView = () => ({ ...student, line_user_id: linked ? "ui-line" : null, line_accounts: linked ? [{ line_user_id: "ui-line", relation, alias_name: alias, friend_display_name: "登録試験LINE", is_primary: relation === "student" }] : [] });
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (request.method() !== "GET") {
      const body = request.postDataJSON(); writes.push({ path, body });
      if (options.reject) return route.fulfill({ status: 409, json: { error: "保存できませんでした" } });
      if (path.endsWith("/verify")) {
        const targets = body.targets as { student_number: string; relation: string; alias_name: string }[];
        numbers = targets.map(target => target.student_number); relation = targets[0].relation; alias = targets[0].alias_name; linked = true;
      } else { alias = body.alias_name; if (body.group_name) group = body.group_name; }
      return route.fulfill({ json: { ok: true, alias_name: alias } });
    }
    if (path === "/api/admin/contacts") {
      if (options.loadFail && url.searchParams.has("userId")) return route.fulfill({ status: 500, json: { error: "登録情報を取得できませんでした" } });
      return route.fulfill({ json: { contacts: [contact()] } });
    }
    if (path === "/api/admin/contacts/ui-line/messages") return route.fulfill({ json: { messages, registration_history: [] } });
    if (path === "/api/admin/contacts/students" || path === "/api/attendance/students") return route.fulfill({ json: { students: [student, sibling] } });
    if (path === "/api/admin/teachers") return route.fulfill({ json: { teachers: [{ display_name: "試験先生" }] } });
    if (path === "/api/students") return route.fulfill({ json: { students: [studentView()] } });
    if (path === "/api/students/UI-ONE/messages") return route.fulfill({ json: { student: studentView(), link_status: linked ? "linked" : "unlinked", line_user_id: linked ? "ui-line" : null, selected_account: linked ? studentView().line_accounts[0] : null, messages: [] } });
    if (path === "/api/attendance/line-link-candidates") return route.fulfill({ json: { candidates: [{ line_user_id: "ui-line", display_name: "登録試験LINE", default_student_number: "UI-ONE", evidence_message_id: options.evidence === false ? null : "ui-evidence", latest_text: messages[0]?.text, suggestions: [], suggested_names: [] }] } });
    if (path === "/api/attendance/candidates") return route.fulfill({ json: { candidates: [{ id: "ui-candidate", student_number: "UI-ONE", student_roster: student, status: "pending", event_type: "absence", event_date: "2099-10-02", ai_summary: "欠席", sender_profile: { display_name: "登録試験LINE", alias_names: [alias], account_names: [], student_accounts: accounts(), tag_names: group ? [group] : [] }, line_messages: { id: options.evidence === false ? undefined : "ui-evidence", line_user_id: "ui-line", display_name: "登録試験LINE", text: messages[0]?.text ?? "欠席します" } }] } });
    expect(request.method()).toBe("GET");
    return route.fulfill({ json: {} });
  });
  return { writes };
}
