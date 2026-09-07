import { expect, test } from "@playwright/test";

const unavailable = {
  code: "legacy_study_room_unavailable",
  error: "この自習室予約・管理機能は現在利用できません。必要な場合は教室へお問い合わせください。",
};
const routes = ["/api/self-study-room", "/api/self-study-room/cancel", "/api/admin/self-study-room"];

// The server has staff auth enabled and an unreachable dummy DB. These hit real
// handlers, which must neither authenticate nor access any database.
test("legacy reads never disclose reservations, including for a supplied student number", async ({ request }) => {
  for (const path of [routes[0], routes[2]]) {
    for (const query of ["", "?date=2030-01-01", "?date=2030-01-01&studentNumber=SECURITY_TEST_ONLY"]) {
      const response = await request.get(path + query);
      expect(response.status()).toBe(503);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual(unavailable);
    }
    const response = await request.head(path + "?date=2030-01-01");
    expect(response.status()).toBe(503);
    expect(await response.body()).toHaveLength(0);
  }
});

test("legacy writes reject all input before parsing or checking forged credentials", async ({ request }) => {
  const bodies = [
    { date: "2030-01-01", studentNumber: "SECURITY_TEST_ONLY", seat: 1, slotIds: ["14:55-16:25"] },
    { id: "00000000-0000-0000-0000-000000000001", studentNumber: "SECURITY_TEST_ONLY" },
    { cancelId: "00000000-0000-0000-0000-000000000001" },
    { date: "2030-01-01", limitMinutes: 90, closedSlotIds: ["14:55-16:25"] },
    { date: "2030-01-01", limitMinutes: 0, closedSlotIds: [] },
    "{malformed-json",
  ];
  for (const path of routes) {
    for (const data of bodies) {
      const response = await request.post(path, { data, headers: {
        "Content-Type": "application/json", "Authorization": "Bearer security-test-not-a-token",
        "Origin": "https://attacker.invalid", "X-Staff-Id": "test-staff",
      } });
      expect(response.status()).toBe(503);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual(unavailable);
    }
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const response = await request.fetch(path, { method, data: bodies[0] });
      expect(response.status()).toBe(405);
    }
  }
});

test("retired pages collect no pupil identifiers and never fetch reservation APIs", async ({ page }) => {
  const apiRequests: string[] = [];
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push(url.pathname);
      await route.abort();
    } else if (url.origin !== "http://127.0.0.1:3197") await route.abort();
    else await route.continue();
  });
  await page.goto("/self-study-room");
  await expect(page.getByRole("status")).toHaveText("オンライン予約の受付は準備中です。");
  await expect(page.locator("input, select, button, table")).toHaveCount(0);
  await page.goto("/admin/self-study-room");
  await expect(page.getByRole("status")).toHaveText("この管理画面は利用を終了しました。");
  await expect(page.getByRole("link", { name: "職員専用画面へ" })).toHaveAttribute("href", "/staff/self-study-room");
  await expect(page.locator("input, select, button, table")).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});
