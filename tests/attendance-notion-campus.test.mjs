import assert from "node:assert/strict";
import test from "node:test";

import { assertXClassPageCampus, chooseXClassNotionPage, isXClassLesson } from "../src/lib/attendance-notion-campus.mjs";

const page = (id, campus, lesson = "２Ｘ英") => ({
  id,
  properties: {
    授業: { type: "select", select: { name: lesson } },
    授業校舎: { type: "select", select: campus ? { name: campus } : null },
  },
});
const choice = { campusPropertyName: "授業校舎", lessonPropertyName: "授業", campus: "本校", lessonName: "２Ｘ英" };

test("同じ生徒・日・X授業でも配信元校舎のページだけを選ぶ", () => {
  assert.equal(isXClassLesson({ source_payload: { class: "Ｘ" } }), true);
  assert.equal(chooseXClassNotionPage([page("south", "南教室"), page("main", "本校")], choice), "main");
  assert.equal(chooseXClassNotionPage([page("south", "南教室")], choice), null);
});

test("X授業の校舎不明・重複・別校舎ページIDは上書きしない", () => {
  assert.throws(() => chooseXClassNotionPage([page("legacy", null)], choice), /校舎未設定/);
  assert.throws(() => chooseXClassNotionPage([page("one", "本校"), page("two", "本校")], choice), /複数/);
  assert.throws(() => assertXClassPageCampus(page("south", "南教室"), "授業校舎", "本校"), /一致しません/);
  assert.throws(() => assertXClassPageCampus(page("legacy", null), "授業校舎", "本校"), /一致しません/);
});
