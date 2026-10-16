import assert from "node:assert/strict";
import test from "node:test";
import { organizeStudentSuggestions } from "../src/lib/attendance-student-options.mjs";
const options = [{ student_number: "1", student_name: "架空 一郎" }, { student_number: "2", student_name: "架空 二郎" }];
test("確認済み1人が選択中なら他候補を折り畳む", () => {
  const result = organizeStudentSuggestions(options, ["1", "1"], ["1"], false, "欠席します");
  assert.deepEqual(result.primary, [options[0]]);
  assert.deepEqual(result.other, [options[1]]);
});
test("兄弟・本文の食い違い・人による選択・選択必須を隠さない", () => {
  for (const args of [ [["1", "2"], ["1"], false, "欠席します"], [["1"], ["1"], false, "架 空　二 郎が欠席します"], [["1"], ["2"], false, "欠席します"], [["1"], ["1"], true, "欠席します"], [[], ["1"], false, "欠席します"], [["1"], ["1", "2"], false, "欠席します"] ]) {
    assert.deepEqual(organizeStudentSuggestions(options, ...args).primary, options);
    assert.deepEqual(organizeStudentSuggestions(options, ...args).other, []);
  }
});
