import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAliasImportPreview,
  parseLineAliasCsv,
  planAliasImportApply,
  summarizeAliasImport,
} from "../src/lib/line-alias-import.mjs";

test("LINE Manager CSV is parsed by header name and preserves quoted commas", () => {
  const rows = parseLineAliasCsv([
    "line_user_id,alias_name,friend_display_name",
    'U001,"山田, 太郎 母","やまだ"',
  ].join("\r\n"));
  assert.deepEqual(rows, [{
    source_row: 2,
    line_user_id: "U001",
    alias_name: "山田, 太郎 母",
    display_name: "やまだ",
    group_name: "",
  }]);
});

test("alias import previews inserts, matches, and protected changes", () => {
  const preview = buildAliasImportPreview([
    { source_row: 2, line_user_id: "new", alias_name: "新規 母" },
    { source_row: 3, line_user_id: "same", alias_name: "一致 父" },
    { source_row: 4, line_user_id: "changed", alias_name: "変更後 保護者" },
  ], [
    { line_user_id: "same", alias_name: "一致 父", group_name: null },
    { line_user_id: "changed", alias_name: "変更前 母", group_name: "中3" },
  ]);

  assert.deepEqual(preview.map((row) => row.status), ["insert", "same_existing", "different_existing"]);
  assert.deepEqual(preview.map((row) => row.enabled), [true, false, false]);
  assert.equal(preview[2].expected_existing_alias_name, "変更前 母");
  assert.equal(preview[2].group_name, "中3");
});

test("duplicate conflicts and unmatched rows cannot be applied", () => {
  const preview = buildAliasImportPreview([
    { source_row: 2, line_user_id: "duplicate", alias_name: "候補A" },
    { source_row: 3, line_user_id: "duplicate", alias_name: "候補B" },
    { source_row: 4, line_user_id: "", alias_name: "IDなし" },
    { source_row: 5, line_user_id: "missing-name", alias_name: "" },
  ]);

  assert.deepEqual(summarizeAliasImport(preview), { conflict: 1, unmatched: 2 });
  assert.ok(preview.every((row) => !row.enabled && !row.can_apply));
});

test("same duplicate rows are collapsed and remain idempotent", () => {
  const preview = buildAliasImportPreview([
    { source_row: 2, line_user_id: "same-id", alias_name: "同じ登録名" },
    { source_row: 3, line_user_id: "same-id", alias_name: "同じ登録名" },
  ], [{ line_user_id: "same-id", alias_name: "同じ登録名", group_name: null }]);

  assert.equal(preview.length, 1);
  assert.equal(preview[0].status, "same_existing");
  assert.match(preview[0].note, /2行を1件/);
});

test("CSV without a stable LINE user ID column is rejected", () => {
  assert.throws(
    () => parseLineAliasCsv("alias_name,display_name\n登録名,LINE名"),
    /line_user_id/,
  );
});

test("apply planning is idempotent and preserves groups", () => {
  const plan = planAliasImportApply([
    { line_user_id: "new", alias_name: "新規 母", expected_existing_alias_name: null },
    { line_user_id: "same", alias_name: "登録済 父", expected_existing_alias_name: "以前の名前" },
    { line_user_id: "change", alias_name: "変更後 母", expected_existing_alias_name: "変更前 母" },
  ], [
    { line_user_id: "same", alias_name: "登録済 父", group_name: "中2" },
    { line_user_id: "change", alias_name: "変更前 母", group_name: "中3" },
  ], "2026-08-29T00:00:00.000Z");

  assert.equal(plan.already_applied, 1);
  assert.equal(plan.skipped_stale, 0);
  assert.deepEqual(plan.upserts, [
    { line_user_id: "new", alias_name: "新規 母", group_name: null, updated_at: "2026-08-29T00:00:00.000Z" },
    { line_user_id: "change", alias_name: "変更後 母", group_name: "中3", updated_at: "2026-08-29T00:00:00.000Z" },
  ]);
});

test("apply planning skips only rows changed after preview", () => {
  const plan = planAliasImportApply([
    { line_user_id: "safe", alias_name: "安全な新規", expected_existing_alias_name: null },
    { line_user_id: "stale", alias_name: "取込名", expected_existing_alias_name: "確認時の名前" },
  ], [
    { line_user_id: "stale", alias_name: "確認後に編集された名前", group_name: null },
  ]);

  assert.equal(plan.upserts.length, 1);
  assert.equal(plan.upserts[0].line_user_id, "safe");
  assert.equal(plan.skipped_stale, 1);
});
