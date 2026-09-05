import { expect, test, Page } from "@playwright/test";

const fixtureRow = { id: "00000000-0000-0000-0000-000000000001", student_number: "TEST001",
  student_name: "検証用の生徒", grade: "中1", reservation_date: "2030-01-01", seat: 1,
  slot_ids: ["14:55-16:25"], status: "pending", version: 1, request_kind: "advance", intake_channel: "line_screen" };

test("reservation preview has the requested school title and cannot submit a reservation", async ({ page }) => {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3197" || url.pathname.startsWith("/api/")) await route.abort();
    else await route.continue();
  });
  await page.goto("/self-study-room/menu-preview");
  await expect(page).toHaveTitle("勉強クラブ本校自習室予約");
  await expect(page.getByText("操作デモ・実際の予約は登録されません")).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "トップページへ" })).toHaveCount(0);
  await page.goto("/self-study-room");
  await expect(page).toHaveTitle("勉強クラブ本校自習室予約");
  await expect(page.getByRole("link", { name: "トップページへ" })).toHaveCount(0);
});

async function setup(page: Page, { loseResponse = false, readOnly = false, loseIntake = false, conflictIntake = false, evidence = false } = {}) {
  let loggedIn = false;
  let row = { ...fixtureRow };
  const operations: Record<string, unknown>[] = [];
  const forbidden: string[] = [];
  const intakes: Record<string, unknown>[] = [];
  const pupil={student_number:'SOUTH001',student_name:'南の検証生徒',grade:'中1',campus:'南教室'};
  // No request goes to a real service. All API calls are intercepted, and all
  // external hosts are blocked before navigation. The server also uses fake DB env.
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.origin !== "http://127.0.0.1:3197") { forbidden.push(url.origin); await route.abort(); return; }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    if (url.pathname === "/api/staff/session") {
      if (method === "POST") loggedIn = true;
      if (method === "DELETE") { loggedIn = false; await route.fulfill({ json: { loggedOut: true } }); return; }
      await route.fulfill({ status: loggedIn ? 200 : 401, json: loggedIn ? { staff: { staffId: "test-office", displayName: "検証職員" } } : { error: "ログインしてください。" } }); return;
    }
    if (url.pathname === "/api/staff/study-room/requests") {
      if (!loggedIn) { await route.fulfill({ status: 401, json: { error: "ログインし直してください。" } }); return; }
      await route.fulfill({ json: { requests: [{...row,staff_intake:evidence ? {contactChannel:'line_message',note:'本校での利用を希望\n<script>悪意のある文字列</script>',staffName:'検証受付担当',staffCode:'OFFICE01',createdAt:'2030-01-01T00:05:00Z'} : null}], hasMore: false,
        permissions: { "study_room.approve": !readOnly, "study_room.cancel": !readOnly, "study_room.submit": !readOnly } } }); return;
    }
    if(url.pathname==='/api/staff/study-room/intake-options') {
      if(!loggedIn) {await route.fulfill({status:401,json:{error:'ログインし直してください。'}});return;}
      await route.fulfill({json:{students:[pupil],hasMore:false,student:url.searchParams.has('student') ? pupil : null,
        date:url.searchParams.get('date'),booked:[{seat:1,slotId:'16:45-18:15'}],closedSlotIds:['20:25-21:55'],
        limitMinutes:270,studentMinutes:90,pendingSlotIds:[],studentSlotIds:['18:35-20:05']}});return;
    }
    if(url.pathname==='/api/staff/study-room/intake') {
      intakes.push(route.request().postDataJSON());
      if(conflictIntake) {await route.fulfill({status:409,json:{error:'空席状況が変わりました。'}});return;}
      if(loseIntake && intakes.length===1) {await route.abort('connectionreset');return;}
      await route.fulfill({json:{request:{status:'pending'}}});return;
    }
    if (url.pathname === "/api/staff/study-room/transition") {
      operations.push(route.request().postDataJSON());
      row = { ...row, status: "approved", version: 2 };
      if (loseResponse && operations.length === 1) { await route.abort("connectionreset"); return; }
      await route.fulfill({ json: { request: row } }); return;
    }
    forbidden.push(url.pathname); await route.abort();
  });
  await page.goto("/staff/self-study-room");
  await expect(page.getByRole("link", { name: "トップページへ" })).toBeVisible();
  await page.getByLabel("職員コード").fill("TESTOFFICE");
  await page.getByLabel("パスワード").fill("test-password-not-real");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByText("検証職員 さん")).toBeVisible();
  await page.getByLabel("対象日").fill("2030-01-01");
  await page.getByRole("button", { name: "一覧を更新" }).click();
  await expect(page.getByRole("heading", { name: /検証用の生徒/ })).toBeVisible();
  return { operations, forbidden, intakes, expireSession: () => { loggedIn = false; } };
}

test("login, explicit confirmation, approval refresh and logout remove student data", async ({ page }) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "承認して確定", exact: true }).click();
  expect(state.operations).toHaveLength(0);
  await page.getByRole("button", { name: "内容を確認して実行" }).click();
  await expect(page.getByRole("article").getByText("確定", { exact: true })).toBeVisible();
  expect(state.operations).toHaveLength(1);
  expect(state.operations[0].expectedVersion).toBe(1);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page.getByLabel("職員コード")).toBeVisible();
  await expect(page.getByRole("heading", { name: /検証用の生徒/ })).toHaveCount(0);
  expect(state.forbidden).toEqual([]);
});

test('proxy evidence is labeled, escaped, uses Japan time and disappears at logout',async ({page})=>{
  const state=await setup(page,{evidence:true,readOnly:true});
  await page.getByText('代理受付の経緯を確認',{exact:true}).click();
  const detail=page.locator('article details');
  await expect(detail.getByText('LINE個別メッセージ',{exact:true})).toBeVisible();
  await expect(detail.getByText('検証受付担当（OFFICE01）',{exact:true})).toBeVisible();
  await expect(detail.getByText('2030/01/01 09:05',{exact:true})).toBeVisible();
  await expect(detail.getByText(/<script>悪意のある文字列<\/script>/)).toBeVisible();
  await expect(detail.locator('script')).toHaveCount(0);
  await page.getByRole('button',{name:'ログアウト',exact:true}).click();
  await expect(page.getByText(/検証受付担当/)).toHaveCount(0);
  expect(state.forbidden).toEqual([]);
});

test("lost response retains operation key and freezes other operations until retry", async ({ page }) => {
  const state = await setup(page, { loseResponse: true });
  await page.getByRole("button", { name: "承認して確定", exact: true }).click();
  await page.getByRole("button", { name: "内容を確認して実行" }).click();
  await expect(page.getByRole("button", { name: "結果を再確認" })).toBeVisible();
  await expect(page.getByRole("button", { name: "一覧を更新" })).toBeDisabled();
  await page.getByRole("button", { name: "結果を再確認" }).click();
  await expect(page.getByRole("article").getByText("確定", { exact: true })).toBeVisible();
  expect(state.operations).toHaveLength(2);
  expect(state.operations[0]).toEqual(state.operations[1]);
  expect(state.forbidden).toEqual([]);
});

test("read-only staff see no approval buttons and mobile layout stays within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, { readOnly: true });
  await expect(page.getByRole("button", { name: "承認して確定", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "予約を取り消す", exact: true })).toHaveCount(0);
  await expect(page.getByRole('button',{name:'職員による代理受付',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/staff-study-room-mobile.png", fullPage: true });
  expect(state.forbidden).toEqual([]);
});

async function prepareIntake(page:Page) {
  await page.getByRole('button',{name:'職員による代理受付',exact:true}).click();
  const panel=page.getByRole('region',{name:'職員代理受付'});
  await panel.getByLabel('代理申請の利用日').fill('2030-01-01');
  await panel.getByLabel('生徒名・学籍番号').fill('南');
  await panel.getByRole('button',{name:'生徒を検索'}).click();
  await panel.getByRole('button',{name:/南の検証生徒/}).click();
  await expect(panel.getByRole('checkbox',{name:/16:45-18:15/})).toBeDisabled();
  await panel.getByLabel('希望座席').selectOption('2');
  await expect(panel.getByRole('checkbox',{name:/16:45-18:15/})).toBeEnabled();
  await expect(panel.getByRole('checkbox',{name:/18:35-20:05/})).toBeDisabled();
  await expect(panel.getByRole('checkbox',{name:/20:25-21:55/})).toBeDisabled();
  await panel.getByRole('checkbox',{name:/14:55-16:25/}).check();
  await expect(panel.getByRole('button',{name:'申請内容を確認',exact:true})).toBeDisabled();
  await panel.getByLabel('受付内容・理由（必須）').fill('LINEで本校利用の希望を確認');
  await panel.getByRole('button',{name:'申請内容を確認',exact:true}).click();
  return panel;
}

test('staff proxy retries exactly the same request and protects concurrent confirmation',async ({page})=>{
  const state=await setup(page,{loseIntake:true});
  const panel=await prepareIntake(page);
  expect(state.intakes).toHaveLength(0);
  await page.getByRole('button',{name:'承認して確定',exact:true}).click();
  await panel.getByRole('button',{name:'承認待ちとして登録'}).click();
  await expect(panel.getByRole('button',{name:'同じ申請の結果を再確認'})).toBeVisible();
  await expect(page.getByRole('button',{name:'内容を確認して実行'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'代理受付を閉じる'})).toBeDisabled();
  await expect(panel.getByLabel('生徒名・学籍番号')).toBeDisabled();
  await panel.getByRole('button',{name:'同じ申請の結果を再確認'}).click();
  await expect(panel.getByRole('status')).toContainText('承認待ちとして受け付けました');
  expect(state.intakes).toHaveLength(2);
  expect(state.intakes[0]).toEqual(state.intakes[1]);
  expect(state.intakes[0]).toMatchObject({studentNumber:'SOUTH001',seat:2,slotIds:['14:55-16:25'],contactChannel:'line_message'});
  expect(state.operations).toHaveLength(0);
  expect(state.forbidden).toEqual([]);
});

test('proxy conflict requires fresh availability and expired session removes pupil details',async ({page})=>{
  const state=await setup(page,{conflictIntake:true});
  const panel=await prepareIntake(page);
  await panel.getByRole('button',{name:'承認待ちとして登録'}).click();
  await expect(page.getByRole('status')).toContainText('空席状況が変わりました');
  await expect(panel.getByRole('button',{name:'承認待ちとして登録'})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'同じ申請の結果を再確認'})).toHaveCount(0);
  state.expireSession();
  await panel.getByRole('button',{name:'空席を再確認'}).click();
  await expect(page.getByLabel('職員コード')).toBeVisible();
  await expect(page.getByText(/選択中：南の検証生徒/)).toHaveCount(0);
  expect(state.intakes).toHaveLength(1);
  expect(state.forbidden).toEqual([]);
});

test("the selected status is restored for the same staff without storing pupil data", async ({ page }) => {
  await setup(page);
  await page.getByRole("combobox").selectOption("pending");
  await page.reload();
  await expect(page.getByRole("combobox")).toHaveValue("pending");
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain("TEST001");
  expect(stored).not.toContain("test-password-not-real");
});

test("expired session clears displayed pupils before allowing another login", async ({ page }) => {
  const state = await setup(page);
  state.expireSession();
  await page.getByRole("button", { name: "一覧を更新" }).click();
  await expect(page.getByLabel("職員コード")).toBeVisible();
  await expect(page.getByRole("heading", { name: /検証用の生徒/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "承認して確定", exact: true })).toHaveCount(0);
  expect(state.forbidden).toEqual([]);
});
