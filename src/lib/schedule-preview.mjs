// Pure read-only planning shared by the command-line worker and browser viewer.
const subjects = { arith: "算数", math: "数学", eng: "英語", jp: "国語", sci: "理科", soc: "社会" };
const grades = { e4: "小4", e5: "小5", e6: "小6", j1: "中1", j2: "中2", j3: "中3" };
const campuses = { hon: "本校", minami: "南教室" };
const fields = ["lesson_date", "start_time", "grade", "class_name", "subject", "campus", "classroom", "teacher_name", "label"];
export const scheduleFieldLabels = { lesson_date: "日付", start_time: "時間", grade: "学年", class_name: "クラス", subject: "科目", campus: "校舎", classroom: "教室", teacher_name: "担当", label: "授業名", source_payload: "授業の属性" };
const normalized = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, "");
const stable = (value) => JSON.stringify(value, Object.keys(value ?? {}).sort());

export function validateScheduleMonth(month) {
  if (typeof month !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("年月は YYYY-MM で指定してください。");
  return month;
}

export function scheduleRows(items, month) {
  validateScheduleMonth(month);
  if (!Array.isArray(items) || items.length === 0 || items.length > 10000) throw new Error("授業データは1～10000件必要です。空の表を休講とは判定しません。");
  const seen = new Set();
  return items.map((item, index) => {
    const fail = (message) => { throw new Error(`${index + 1}件目: ${message}`); };
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("授業データが不正です。");
    for (const key of ["date", "time", "campus", "room", "groupKey", "label"]) {
      if (typeof item[key] !== "string" || !item[key].trim() || item[key].length > 500) fail(`${key}が未入力または不正です。`);
    }
    for (const key of ["teacher", "displayTitle", "grade", "class", "subject"]) {
      if (item[key] !== undefined && (typeof item[key] !== "string" || item[key].length > 500)) fail(`${key}が不正です。`);
    }
    for (const key of ["isSpecialLesson", "faceToFace", "special"]) {
      if (item[key] !== undefined && typeof item[key] !== "boolean") fail(`${key}が不正です。`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !item.date.startsWith(`${month}-`)
      || Number.isNaN(Date.parse(item.date)) || new Date(item.date).toISOString().slice(0, 10) !== item.date) fail("対象月外または存在しない日付です。");
    if (!Object.hasOwn(campuses, item.campus) || !/^\d{1,2}$/.test(item.room) || Number(item.room) < 1) fail("校舎または教室が不正です。");
    if (!/^\d{1,2}:[0-5]\d\s*[～〜~\-–－]\s*\d{1,2}:[0-5]\d$/.test(item.time.normalize("NFKC"))
      || [...item.time.matchAll(/(\d{1,2}):/g)].some((m) => Number(m[1]) > 23)) fail("授業時間を読み取れません。");
    if (!item.isSpecialLesson && (!Object.hasOwn(grades, item.grade) || !Object.hasOwn(subjects, item.subject) || !item.class)) fail("学年・クラス・科目が不明です。");
    const source_key = [item.date, item.time, item.campus, item.groupKey, item.room].join("|");
    if (seen.has(source_key)) fail("同じ授業が重複しています。");
    seen.add(source_key);
    return { lesson_date: item.date, start_time: item.time, grade: grades[item.grade] ?? item.grade ?? null,
      class_name: item.class || null, subject: subjects[item.subject] ?? item.subject ?? null,
      campus: campuses[item.campus], classroom: item.room, teacher_name: item.teacher || null,
      label: item.displayTitle || item.label, source_key, source_file: `schedule_${month}.json`, source_payload: item };
  });
}

function identity(row) {
  // Dates/campuses are deliberately NOT inferred across moves; those need review.
  return [row.lesson_date, row.campus, row.grade, row.class_name, row.subject,
    row.source_payload?.isSpecialLesson ? row.source_payload.groupKey : ""].map(normalized).join("|");
}

export function buildSchedulePreview(items, existing, month, references = {}) {
  const incoming = scheduleRows(items, month);
  if (!Array.isArray(existing) || existing.some((row) => !row.id || !row.lesson_date?.startsWith(`${month}-`))) throw new Error("比較元の授業データが不正です。");
  if (existing.length > 10000 || existing.some((row) => fields.some((key) => row[key] != null && (typeof row[key] !== "string" || row[key].length > 500)))) throw new Error("比較元の授業項目が不正です。");
  if (new Set(existing.map((r) => r.id)).size !== existing.length || new Set(existing.map((r) => r.source_key)).size !== existing.length) throw new Error("比較元に重複があります。");
  const pending = new Map(incoming.map((row) => [row.source_key, row]));
  const previous = new Map(existing.map((row) => [row.source_key, row]));
  const changes = [];
  let unchanged = 0;
  const compare = (before, after) => {
    const changedFields = fields.filter((key) => (before[key] ?? "") !== (after[key] ?? ""));
    if (stable(before.source_payload) !== stable(after.source_payload)) changedFields.push("source_payload");
    if (!changedFields.length && before.source_key === after.source_key) { unchanged++; return; }
    changes.push({ kind: "update", before, after, changedFields, linkedRecords: references[before.id] ?? 0 });
  };
  for (const [key, after] of pending) {
    const before = previous.get(key);
    if (!before) continue;
    compare(before, after); previous.delete(key); pending.delete(key);
  }
  const identities = new Set([...pending.values(), ...previous.values()].map(identity));
  for (const key of identities) {
    const oldRows = [...previous.values()].filter((r) => identity(r) === key);
    const newRows = [...pending.values()].filter((r) => identity(r) === key);
    if (oldRows.length === 1 && newRows.length === 1) compare(oldRows[0], newRows[0]);
    else if (oldRows.length && newRows.length) {
      changes.push({ kind: "ambiguous", before: oldRows, after: newRows, changedFields: [], linkedRecords: oldRows.reduce((n, r) => n + (references[r.id] ?? 0), 0) });
    } else {
      for (const before of oldRows) changes.push({ kind: "remove", before, after: null, changedFields: [], linkedRecords: references[before.id] ?? 0 });
      for (const after of newRows) changes.push({ kind: "add", before: null, after, changedFields: [], linkedRecords: 0 });
    }
  }
  const summary = { existing: existing.length, incoming: incoming.length, unchanged, add: 0, update: 0, remove: 0, ambiguous: 0 };
  for (const change of changes) summary[change.kind]++;
  const warnings = [];
  if (summary.remove) warnings.push("原本に見当たらない授業があります。休講・日付変更・校舎変更を確認してください。削除は実行しません。");
  if (summary.ambiguous) warnings.push("同日・同クラスの授業が複数あり、変更前後を一意に対応付けられません。");
  if (changes.some((c) => c.linkedRecords > 0)) warnings.push("変更対象に欠席・遅刻の記録または候補が紐付いています。反映時に関連を保つ必要があります。");
  const missingTeachers = incoming.filter((r) => !r.teacher_name).length;
  if (missingTeachers) warnings.push(`担当講師が空欄の授業が${missingTeachers}件あります。推測で補完していません。`);
  return { format: "bentan-schedule-preview-v1", month, summary, warnings, changes, lessons: incoming,
    requiresReview: Boolean(summary.remove || summary.ambiguous || changes.some((c) => c.linkedRecords > 0)), applied: false };
}

export function readSchedulePreview(value) {
  if (!value || value.format !== "bentan-schedule-preview-v1" || value.applied !== false
    || !Array.isArray(value.lessons) || !Array.isArray(value.changes) || !Array.isArray(value.warnings)
    || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt)) || !value.source || typeof value.source.file !== "string") throw new Error("勉たんのスケジュール確認ファイルを選択してください。");
  // Recompute the plan from the snapshot; never trust uploaded summary/change labels.
  if (!Array.isArray(value.existing) || !value.references || typeof value.references !== "object") throw new Error("比較元の記録がありません。");
  for (const count of Object.values(value.references)) if (!Number.isSafeInteger(count) || count < 0) throw new Error("関連件数が不正です。");
  const checked = buildSchedulePreview(value.lessons.map((r) => r.source_payload), value.existing, value.month, value.references);
  return { ...checked, generatedAt: value.generatedAt, source: value.source };
}
