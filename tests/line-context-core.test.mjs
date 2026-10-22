import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lineTimestamp, mergeLineContext, parseLineContext, parseLineCsv } from "../src/lib/line-context-core.mjs";
import { parseArgs, syncLineContext } from "../scripts/line-context-sync.mjs";

const options = { account: "school-example", sourceRef: "fixture.csv", format: "csv" };
const history = 'message_id,line_user_id,direction,timestamp,sent_by,text\nm1,fixture-user,inbound,2026-10-22T08:00:00+09:00,,相談があります\nm2,fixture-user,outbound,2026-10-22T09:00:00+09:00,先生A,本日確認します\n';

test("CSV preserves multiline evidence and quotes", () => {
  assert.deepEqual(parseLineCsv('\uFEFFtext,direction\r\n"一行目\n二行目""引用",送信\r\n'), [{ text: '一行目\n二行目"引用', direction: "送信" }]);
  assert.throws(() => parseLineCsv('text\n"unfinished'), /Incomplete/);
});

test("explicit inbound and outbound evidence preserves source and actor", () => {
  const { records } = parseLineContext(history, options);
  assert.equal(records.length, 2);
  assert.equal(records[1].direction, "outbound");
  assert.equal(records[1].actor, "先生A");
  assert.equal(records[1].occurredAt, "2026-10-22T00:00:00.000Z");
  assert.equal(records[1].sourceRef, "fixture.csv#row=2");
  assert.equal(records[1].coverage.complete, false);
  assert.deepEqual(records[1].association, []);
});

test("missing or ambiguous direction date recipient actor remain unresolved", () => {
  const { records } = parseLineContext("text,direction,timestamp\n了解です,先生からの返信かも,昨日 12:00\n", options);
  assert.equal(records[0].direction, "unknown");
  assert.equal(records[0].occurredAt, null);
  assert.equal(records[0].lineUserId, null);
  assert.equal(records[0].actor, null);
  assert.equal(records[0].coverage.noReplyAssessment, "unknown");
});

test("chat-list CSV never becomes message evidence or claims full coverage", () => {
  const result = parseLineContext("line_user_id,latest_text,last_received_at\nfixture-user,返事しました,2026-10-22T00:00:00Z", options);
  assert.equal(result.records.length, 0);
  assert.equal(result.coverage[0].scope, "chat_list");
  assert.equal(result.coverage[0].rows, 1);
  assert.equal(result.coverage[0].complete, false);
  assert.deepEqual(result.warnings, ["CHAT_LIST_IS_NOT_MESSAGE_HISTORY"]);
});

test("native identity deduplicates repeated files but separates accounts", () => {
  const first = parseLineContext(history, options);
  const copied = parseLineContext(history, { ...options, sourceRef: "copied.csv" });
  const merged = mergeLineContext(first, copied);
  assert.equal(merged.records.length, 2);
  assert.equal(merged.added, 0);
  assert.equal(mergeLineContext(merged, parseLineContext(history, { ...options, account: "another" })).records.length, 4);
});

test("same text with different explicit timestamps remains distinct", () => {
  const rows = [{ userId: "fixture-user", direction: "outbound", timestamp: "2026-10-22T00:00:00Z", text: "確認しました" }, { userId: "fixture-user", direction: "outbound", timestamp: "2026-10-22T01:00:00Z", text: "確認しました" }];
  assert.equal(parseLineContext(JSON.stringify(rows), { ...options, format: "json" }).records.length, 2);
});

test("timestamps use explicit Japan timezone and reject invalid relative or date-only values", () => {
  assert.equal(lineTimestamp("2026/10/22 09:30"), "2026-10-22T00:30:00.000Z");
  assert.equal(lineTimestamp("2026-02-30 09:00"), null);
  assert.equal(lineTimestamp("2026-10-22"), null);
  assert.equal(lineTimestamp("12:00"), null);
});

test("capture extracts only observed message endpoint and never guesses direction from a preview", () => {
  const lines = [
    { type: "network_response", status: 200, url: "https://chat.line.biz/api/v2/bots/example/chats", body: JSON.stringify({ list: [{ latestEvent: { message: { text: "preview" } } }] }) },
    { type: "network_response", status: 200, url: "https://chat.line.biz/api/v2/bots/example/chats/fixture-user/messages", body: JSON.stringify({ list: [{ id: "native1", message: { text: "本文" }, direction: "outbound", timestamp: "2026-10-22T00:00:00Z" }] }) },
    { type: "page_text", text: "本文のように見える画面" },
  ];
  const result = parseLineContext(lines.map(JSON.stringify).join("\n"), { ...options, format: "jsonl" });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].content, "本文");
  assert.equal(result.records[0].direction, "outbound");
  assert.equal(result.records[0].lineUserId, "fixture-user");
  assert.equal(result.coverage.length, 2);
});

test("partial JSONL captures keep intact lines and flag incomplete final data", () => {
  const result = parseLineContext('{"text":"本文","direction":"inbound"}\n{"unfinished"', { ...options, format: "jsonl" });
  assert.equal(result.records.length, 1);
  assert.ok(result.warnings.includes("INVALID_JSON_LINE_2"));
});

test("CLI defaults to dry-run and requires account namespace", () => {
  assert.equal(parseArgs(["once", "--input", "test.csv", "--account", "example"]).apply, false);
  assert.throws(() => parseArgs(["--input", "test.csv"]), /account/);
  assert.throws(() => parseArgs(["--input", "test.csv", "--account", "a", "--interval", "0"]), /interval/);
});

test("local apply is idempotent, failures preserve existing evidence, dry-run writes nothing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "line-context-test-"));
  try {
    const input = path.join(dir, "history.csv"); const output = path.join(dir, "context.json");
    await fs.writeFile(input, history);
    const args = { inputs: [input], output, account: "example", apply: false };
    assert.equal((await syncLineContext(args)).records, 2);
    await assert.rejects(fs.access(output));
    assert.equal((await syncLineContext({ ...args, apply: true })).added, 2);
    assert.equal((await syncLineContext({ ...args, apply: true })).added, 0);
    const result = await syncLineContext({ ...args, apply: true, inputs: [path.join(dir, "missing.csv")] });
    assert.equal(result.failedFiles.length, 1);
    assert.equal(result.total, 2);
    assert.equal(JSON.parse(await fs.readFile(output, "utf8")).records.length, 2);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
