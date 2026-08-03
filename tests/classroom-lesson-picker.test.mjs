import assert from "node:assert/strict";
import test from "node:test";
import {
  classroomLessonStartMinutes,
  pickClassroomLessonByEndBoundary,
} from "../src/lib/classroom-lesson-picker.mjs";

const lessons = [
  { id: "first", start_time: "４:４５～６:１５" },
  { id: "second", start_time: "6:35～8:05" },
  { id: "third", start_time: "8:25～9:55" },
];

test("normalizes full-width lesson times", () => {
  assert.equal(classroomLessonStartMinutes("４:４５～６:１５"), 16 * 60 + 45);
});

test("switches tabs exactly one minute after each lesson ends", () => {
  assert.equal(pickClassroomLessonByEndBoundary(lessons, 18 * 60 + 15)?.id, "first");
  assert.equal(pickClassroomLessonByEndBoundary(lessons, 18 * 60 + 16)?.id, "second");
  assert.equal(pickClassroomLessonByEndBoundary(lessons, 18 * 60 + 20)?.id, "second");
  assert.equal(pickClassroomLessonByEndBoundary(lessons, 20 * 60 + 5)?.id, "second");
  assert.equal(pickClassroomLessonByEndBoundary(lessons, 20 * 60 + 6)?.id, "third");
  assert.equal(pickClassroomLessonByEndBoundary(lessons, 21 * 60 + 56)?.id, "third");
});

test("keeps the first lesson selected before its end boundary", () => {
  assert.equal(pickClassroomLessonByEndBoundary(lessons, 12 * 60)?.id, "first");
});
