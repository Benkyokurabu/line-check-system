import { test, expect } from "@playwright/test";
import { buildSchedulePreview, scheduleRows } from "../../src/lib/schedule-preview.mjs";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/schedule/status", (route) => route.fulfill({ json: { enabled: true, stale: false, months: ["2026-09", "2026-10"], runs: [] } }));
});

test("manual import shows completion or review without accepting client lesson data", async ({ page }) => {
  await page.route("**/api/schedule/preview*", (route) => route.fulfill({ json: { months: [{ month: "2026-09" }] } }));
  let review = false;
  await page.route("**/api/schedule/sync?*", (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBeNull();
    return route.fulfill({ json: { status: review ? "review" : "applied", message: review ? "休講の確認が必要です。反映を保留します。" : "授業への反映が完了しました。" } });
  });
  await page.goto("/schedule-import");
  await page.getByLabel("対象月", { exact: true }).fill("2026-09");
  await page.getByRole("button", { name: "今すぐ取り込む", exact: true }).click();
  await expect(page.getByText("授業への反映が完了しました。", { exact: true })).toBeVisible();
  review = true;
  await page.getByRole("button", { name: "今すぐ取り込む", exact: true }).click();
  await expect(page.getByText("休講の確認が必要です。反映を保留します。", { exact: true })).toBeVisible();
  await page.getByLabel("対象月", { exact: true }).fill("2026-08");
  await expect(page.getByRole("button", { name: "今すぐ取り込む", exact: true })).toBeDisabled();
});

test("foreign origins and unauthenticated cron cannot start imports", async ({ request }) => {
  expect((await request.post("/api/schedule/sync?month=2026-09", { headers: { origin: "https://foreign.invalid" } })).status()).toBe(403);
  expect((await request.post("/api/cron/schedule-sync")).status()).toBe(401);
  const anonymous=await request.post('/api/schedule/sync?month=2026-11',{headers:{origin:'https://test.invalid'}});
  expect(anonymous.status()).toBe(401);
  expect((await anonymous.json()).code).toBe('invalid_session');
});

test('room rules and source-cell review remain readable on a phone',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const report={month:'2026-11',generatedAt:'2026-10-21T10:00:00Z',source:{file:'2026年11月スケジュール.xlsm'},summary:{incoming:1,unchanged:1},warnings:[],changes:[],lessons:[],roomSchedule:{format:'bentan-room-schedule-v1',month:'2026-11',slots:[{date:'2026-11-02',start:'16:45',end:'18:15',room:'本①',status:'free',reason:'',cells:['F13']},{date:'2026-11-02',start:'18:35',end:'20:05',room:'本②',status:'review',reason:'原表の注記の確認が必要',cells:['M13']}]}};
  await page.route('**/api/schedule/preview*',route=>route.fulfill({json:new URL(route.request().url()).searchParams.has('month')?report:{months:[{month:'2026-11'}]}}));
  await page.route('**/api/schedule/calendar*',route=>route.fulfill({json:{count:1}}));
  await page.goto('/schedule-import');
  await expect(page.getByRole('heading',{name:'個別使用可能枠も自動作成'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Notionの本校個別を開く'})).toBeVisible();
  await page.getByRole('button',{name:'スケジュールを確認',exact:true}).click();
  await page.getByText('個別枠の原表判定（2枠）',{exact:true}).click();
  await expect(page.getByRole('cell',{name:'F13',exact:true})).toBeVisible();
  await expect(page.getByRole('cell',{name:'原表の注記の確認が必要',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'analysis_outputs/individual-room/schedule-import-390.png',fullPage:true});
});

test("one button reads cloud schedule and retries errors without file selection", async ({ page }) => {
  const item = { date: "2026-09-07", time: "6:35～8:05", grade: "j1", class: "S", subject: "eng", campus: "hon", room: "1", groupKey: "hon_j1_S_eng", label: "中１S 英語", teacher: "確認用講師" };
  const existing = scheduleRows([item], "2026-09").map((r) => ({ ...r, id: "test-lesson" }));
  const references = { "test-lesson": 1 };
  const report = { ...buildSchedulePreview([{ ...item, room: "2" }], existing, "2026-09", references), existing, references,
    generatedAt: "2026-09-07T10:00:00Z", source: { file: "2026年9月スケジュール.xlsm" } };
  let fail = false;
  let checks = 0;
  await page.route("**/api/schedule/preview*", async (route) => {
    expect(route.request().method()).toBe("GET");
    if (!new URL(route.request().url()).searchParams.has("month")) return route.fulfill({ json: { months: [{ month: "2026-09" }] } });
    checks++;
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: "OneDriveに接続できませんでした。" } : report });
  });
  await page.goto("/schedule-import");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "スケジュールを確認", exact: true })).toBeEnabled();
  await page.getByLabel("対象月", { exact: true }).fill("2026-09");
  await page.getByRole("button", { name: "スケジュールを確認", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2026-09 の確認結果" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /本校 1教室/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /本校 2教室/ })).toBeVisible();
  await expect(page.getByText(/変更対象に欠席/)).toBeVisible();
  await page.getByRole("button", { name: "原本の授業一覧を見る" }).click();
  await expect(page.getByLabel("校舎", { exact: true })).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "スケジュールを確認", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "OneDriveに接続できませんでした。" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2026-09 の確認結果" })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "スケジュールを確認", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2026-09 の確認結果" })).toBeVisible();
  expect(checks).toBe(3);
});
