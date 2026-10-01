import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const secret = "isolated-webhook-test-secret";
const signed = (body: string) => ({
  "content-type": "application/json",
  "x-line-signature": createHmac("sha256", secret).update(body).digest("base64"),
});

test("LINE受信はDB保存失敗を成功扱いせず、空イベントと不正署名を区別する", async ({ request }) => {
  const empty = JSON.stringify({ events: [] });
  expect((await request.post("/api/line/webhook", { headers: signed(empty), data: empty })).status()).toBe(200);
  expect((await request.post("/api/line/webhook", { headers: { "x-line-signature": "invalid" }, data: empty })).status()).toBe(401);
  const message = JSON.stringify({ events: [{ type: "message", message: { id: "isolated-message", type: "text", text: "テスト" },
    source: { userId: "Utestonly" }, timestamp: Date.now() }] });
  const failed = await request.post("/api/line/webhook", { headers: signed(message), data: message });
  expect(failed.status()).toBe(503);
  expect(await failed.json()).toEqual({ error: "message persistence failed" });
});
