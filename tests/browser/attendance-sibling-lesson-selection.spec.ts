import { expect, test } from "@playwright/test";

test("ambiguous siblings remain unselected and lesson buttons toggle independently", async ({ page }) => {
  const sister = { student_number: "sister", student_name: "山田 花子", grade: "中2", campus: "本校", homeroom_teacher: "佐藤" };
  const brother = { student_number: "brother", student_name: "山田 太郎", grade: "小6", campus: "本校", homeroom_teacher: "鈴木" };
  let saveAttempts = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/attendance/candidates/sibling-candidate" && route.request().method() === "PATCH") {
      saveAttempts += 1;
      return route.fulfill({ json: { candidate: {} } });
    }
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
  await expect(math).toHaveAttribute("aria-pressed", "true");
  await expect(english).toHaveAttribute("aria-pressed", "true");
  await math.click();
  await expect(math).toHaveAttribute("aria-pressed", "false");
  await expect(math).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(english).toHaveAttribute("aria-pressed", "true");
  await english.click();
  await expect(english).toHaveAttribute("aria-pressed", "false");
  await expect(english).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByLabel("確認者名").fill("テスト担当");
  await page.getByRole("button", { name: "確認してNotionへ登録" }).click();
  await expect(page.getByText("すべての登録行で、日付・校舎・授業・理由を入力してください。")).toBeVisible();
  expect(saveAttempts).toBe(0);
  await page.getByRole("button", { name: "行を追加", exact: true }).click();
  await expect(page.getByRole("group", { name: /行目の登録内容/ })).toHaveCount(2);
});

test("changing the registration-row student refreshes that student's lessons and leaves unmatched lessons white", async ({ page }) => {
  const hanako = { student_number: "hanako", student_name: "山田 花子", grade: "中2", campus: "本校", homeroom_teacher: "佐藤" };
  const sora = { student_number: "sora", student_name: "菊池 そら", grade: "中1", campus: "本校", homeroom_teacher: "田中" };
  const taro = { student_number: "taro", student_name: "山田 太郎", grade: "小6", campus: "本校", homeroom_teacher: "鈴木" };
  const lessonRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/attendance/students") return route.fulfill({ json: { students: [hanako, sora, taro] } });
    if (url.pathname === "/api/attendance/candidates") return route.fulfill({ json: { candidates: [{
      id: "candidate-row-change",
      student_number: "hanako",
      student_roster: hanako,
      status: "pending",
      event_type: "absence",
      event_date: "2099-09-11",
      ai_summary: "体調不良",
      ai_confidence: 0.9,
      sender_profile: { display_name: "山田保護者", alias_names: [], account_names: [], tag_names: [] },
      line_messages: { id: "message-row-change", line_user_id: "line-family", display_name: "山田保護者", text: "欠席します", received_at: "2099-09-10T09:00:00Z" },
      attendance_candidate_items: [{ id: "item-row-change", student_number: "hanako", event_type: "absence", event_date: "2099-09-11", lesson_id: null, suggested_subject: null, suggested_class_name: null, ai_summary: "体調不良", status: "pending" }],
      reply_messages: [],
    }] } });
    if (url.pathname === "/api/attendance/lessons") {
      const studentNumber = url.searchParams.get("student_number") ?? "";
      lessonRequests.push(studentNumber);
      return route.fulfill({ json: { lessons: [
        { id: "math", label: "数学A", lesson_date: "2099-09-11", start_time: "17:00", campus: "本校", classroom: "A", enrolled: studentNumber === "hanako" },
        { id: "english", label: "英語B", lesson_date: "2099-09-11", start_time: "19:00", campus: "本校", classroom: "B", enrolled: studentNumber === "hanako" },
        { id: "sora-lesson", label: "理科C", lesson_date: "2099-09-11", start_time: "20:00", campus: "本校", classroom: "C", enrolled: studentNumber === "sora" },
      ] } });
    }
    if (url.pathname === "/api/attendance/status") return route.fulfill({ json: {} });
    if (url.pathname === "/api/attendance/extract") return route.fulfill({ json: { processed: 0, candidates: 0, ignored: 0, retrying: 0, dead: 0 } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/attendance");
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  const math = page.getByRole("button", { name: /数学A/ });
  await expect(math).toBeVisible();
  await math.click();
  await expect(math).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /山田 花子.*別の生徒に変更/ }).click();
  await page.getByRole("option", { name: /菊池 そら/ }).click();
  const soraLesson = page.getByRole("button", { name: /理科C/ });
  await expect(soraLesson).toHaveAttribute("aria-pressed", "true");
  await expect(soraLesson).toContainText("受講中");
  await expect(math).toHaveAttribute("aria-pressed", "false");
  await expect(math).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(lessonRequests).toContain("sora");

  await page.getByRole("button", { name: /菊池 そら.*別の生徒に変更/ }).click();
  await page.getByRole("option", { name: /山田 太郎/ }).click();
  await expect(soraLesson).toHaveAttribute("aria-pressed", "false");
  await expect(soraLesson).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: /受講中/ })).toHaveCount(0);
  expect(lessonRequests).toContain("taro");
});

test("changing a row to a student already listed below merges the selected lessons into one registration row", async ({ page }) => {
  const sora = { student_number: "sora", student_name: "菊池 そら", grade: "中1", campus: "本校", homeroom_teacher: "田中" };
  const shota = { student_number: "shota", student_name: "菊池 翔太", grade: "小6", campus: "本校", homeroom_teacher: "佐藤" };
  let savedItems: Array<{ student_number: string; lesson_id: string }> = [];
  const lessons = [
    { id: "sora-lesson", label: "理科C", lesson_date: "2099-09-11", start_time: "16:00", campus: "本校", classroom: "C" },
    { id: "math", label: "数学A", lesson_date: "2099-09-11", start_time: "17:00", campus: "本校", classroom: "A" },
    { id: "english", label: "英語B", lesson_date: "2099-09-11", start_time: "19:00", campus: "本校", classroom: "B" },
  ];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/attendance/students") return route.fulfill({ json: { students: [sora, shota] } });
    if (url.pathname === "/api/attendance/candidates") return route.fulfill({ json: { candidates: [{
      id: "candidate-two-rows",
      student_number: "sora",
      student_roster: sora,
      status: "pending",
      event_type: "absence",
      event_date: "2099-09-11",
      ai_summary: "体調不良",
      ai_confidence: 0.9,
      sender_profile: { display_name: "菊池保護者", alias_names: [], account_names: [], tag_names: [] },
      line_messages: { id: "message-two-rows", line_user_id: "line-family", display_name: "菊池保護者", text: "欠席します", received_at: "2099-09-10T09:00:00Z" },
      attendance_candidate_items: [
        { id: "item-sora", student_number: "sora", event_type: "absence", event_date: "2099-09-11", lesson_id: "sora-lesson", suggested_subject: null, suggested_class_name: null, ai_summary: "体調不良", status: "pending" },
        { id: "item-shota", student_number: "shota", event_type: "absence", event_date: "2099-09-11", lesson_id: "math", suggested_subject: null, suggested_class_name: null, ai_summary: "体調不良", status: "pending" },
      ],
      reply_messages: [],
    }] } });
    if (url.pathname === "/api/attendance/lessons") {
      const studentNumber = url.searchParams.get("student_number");
      return route.fulfill({ json: { lessons: lessons.map((lesson) => ({ ...lesson, enrolled: studentNumber === "sora" ? lesson.id === "sora-lesson" : lesson.id !== "sora-lesson" })) } });
    }
    if (url.pathname === "/api/attendance/candidates/candidate-two-rows" && route.request().method() === "PATCH") {
      savedItems = JSON.parse(route.request().postData() ?? "{}").items;
      return route.fulfill({ json: { candidate: {} } });
    }
    if (url.pathname === "/api/attendance/candidates/candidate-two-rows/confirm") return route.fulfill({ json: { notion_page_ids: ["page-1", "page-2"] } });
    if (url.pathname === "/api/attendance/status") return route.fulfill({ json: {} });
    if (url.pathname === "/api/attendance/extract") return route.fulfill({ json: { processed: 0, candidates: 0, ignored: 0, retrying: 0, dead: 0 } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/attendance");
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  await expect(page.getByRole("button", { name: /数学A/ }).nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /菊池 そら.*別の生徒に変更/ }).click();
  await page.getByRole("option", { name: /菊池 翔太/ }).click();

  const row = page.getByRole("group", { name: "1行目の登録内容" });
  await expect(page.getByRole("group", { name: /行目の登録内容/ })).toHaveCount(1);
  await expect(row.getByRole("button", { name: /英語B/ })).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByRole("button", { name: /数学A/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("確認者名").fill("テスト担当");
  await page.getByRole("button", { name: "確認してNotionへ登録" }).click();
  await expect.poll(() => savedItems.length).toBe(2);
  expect(savedItems.map((item) => [item.student_number, item.lesson_id]).sort()).toEqual([["shota", "english"], ["shota", "math"]]);
});

test("two saved lessons for one student and day reopen as one row", async ({ page }) => {
  const shota = { student_number: "shota", student_name: "菊池 翔太", grade: "小6", campus: "本校", homeroom_teacher: "佐藤" };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/attendance/students") return route.fulfill({ json: { students: [shota] } });
    if (url.pathname === "/api/attendance/candidates") return route.fulfill({ json: { candidates: [{
      id: "candidate-two-saved-lessons",
      student_number: "shota",
      student_roster: shota,
      status: "pending",
      event_type: "absence",
      event_date: "2099-09-11",
      ai_summary: "体調不良",
      ai_confidence: 0.9,
      sender_profile: { display_name: "菊池保護者", alias_names: [], account_names: [], tag_names: [] },
      line_messages: { id: "message-saved-lessons", line_user_id: "line-family", display_name: "菊池保護者", text: "欠席します", received_at: "2099-09-10T09:00:00Z" },
      attendance_candidate_items: [
        { id: "item-math", student_number: "shota", event_type: "absence", event_date: "2099-09-11", lesson_id: "math", suggested_subject: null, suggested_class_name: null, ai_summary: "体調不良", status: "pending" },
        { id: "item-english", student_number: "shota", event_type: "absence", event_date: "2099-09-11", lesson_id: "english", suggested_subject: null, suggested_class_name: null, ai_summary: "体調不良", status: "pending" },
      ],
      reply_messages: [],
    }] } });
    if (url.pathname === "/api/attendance/lessons") return route.fulfill({ json: { lessons: [
      { id: "math", label: "数学A", lesson_date: "2099-09-11", start_time: "17:00", campus: "本校", enrolled: true },
      { id: "english", label: "英語B", lesson_date: "2099-09-11", start_time: "19:00", campus: "本校", enrolled: true },
    ] } });
    if (url.pathname === "/api/attendance/status") return route.fulfill({ json: {} });
    if (url.pathname === "/api/attendance/extract") return route.fulfill({ json: { processed: 0, candidates: 0, ignored: 0, retrying: 0, dead: 0 } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/attendance");
  await page.getByRole("button", { name: "対応する", exact: true }).click();
  const row = page.getByRole("group", { name: "1行目の登録内容" });
  await expect(page.getByRole("group", { name: /行目の登録内容/ })).toHaveCount(1);
  await expect(row.getByRole("button", { name: /数学A/ })).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByRole("button", { name: /英語B/ })).toHaveAttribute("aria-pressed", "true");
  await row.getByPlaceholder("例：体調不良").fill("連続授業の欠席");
  await expect(row.getByPlaceholder("例：体調不良")).toHaveValue("連続授業の欠席");
  await row.getByRole("button", { name: /英語B/ }).click();
  await expect(row.getByRole("button", { name: /数学A/ })).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByRole("button", { name: /英語B/ })).toHaveAttribute("aria-pressed", "false");
});
