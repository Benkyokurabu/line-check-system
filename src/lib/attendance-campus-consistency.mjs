export function normalizeCampus(value) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[\s　]/g, "");
  if (!normalized) return null;
  if (normalized === "本" || normalized.includes("本校")) return "本校";
  if (normalized === "南" || normalized.includes("南教室")) return "南教室";
  return String(value).trim() || null;
}

export function normalizeLessonIdentityText(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　・･\-_／/]/g, "").toLowerCase();
}

export function enrollmentMatchesLesson(enrollment, lesson, studentCampus) {
  const enrollmentGrade = normalizeLessonIdentityText(enrollment?.grade);
  const lessonGrade = normalizeLessonIdentityText(lesson?.grade);
  const enrollmentClass = normalizeLessonIdentityText(enrollment?.class_name);
  const lessonClass = normalizeLessonIdentityText(lesson?.class_name);
  const enrollmentSubject = normalizeLessonIdentityText(enrollment?.subject);
  const lessonSubject = normalizeLessonIdentityText(lesson?.subject);
  const campusMatches = normalizeCampus(studentCampus) === normalizeCampus(lesson?.campus);
  const subjectMatches = Boolean(enrollmentSubject && lessonSubject) &&
    (enrollmentSubject.includes(lessonSubject) || lessonSubject.includes(enrollmentSubject));
  return campusMatches && enrollmentGrade === lessonGrade && enrollmentClass === lessonClass && subjectMatches;
}

export function validateAttendanceCampusSelection(input) {
  const studentCampus = normalizeCampus(input?.studentCampus);
  const lessonCampus = normalizeCampus(input?.lessonCampus);
  const requestedCampus = normalizeCampus(input?.requestedCampus);
  const override = input?.crossCampusOverride === true;
  const reason = String(input?.crossCampusReason ?? "").trim();

  if (!studentCampus) return { ok: false, crossCampus: false, error: "生徒の所属校舎を確認できません" };
  if (!lessonCampus) return { ok: false, crossCampus: false, error: "選択した授業の校舎を確認できません" };
  if (requestedCampus && requestedCampus !== lessonCampus) {
    return { ok: false, crossCampus: studentCampus !== lessonCampus, error: "指定校舎と選択した授業の校舎が一致しません" };
  }
  const crossCampus = studentCampus !== lessonCampus;
  if (!crossCampus && override) {
    return { ok: false, crossCampus: false, error: "所属校舎と授業校舎が同じため、別校舎受講の指定は不要です" };
  }
  if (crossCampus && !override) {
    return { ok: false, crossCampus: true, error: `所属校舎（${studentCampus}）と授業校舎（${lessonCampus}）が一致しません` };
  }
  if (crossCampus && !reason) {
    return { ok: false, crossCampus: true, error: "別校舎受講を登録する理由を入力してください" };
  }
  return { ok: true, crossCampus, error: null };
}

export function shouldDisplayAttendanceEvent(input) {
  return validateAttendanceCampusSelection({
    studentCampus: input?.studentCampus,
    lessonCampus: input?.lessonCampus,
    requestedCampus: input?.lessonCampus,
    crossCampusOverride: input?.crossCampusOverride,
    crossCampusReason: input?.crossCampusReason,
  }).ok;
}

const gradeAliases = new Map([
  ["j1", "1"], ["j2", "2"], ["j3", "3"], ["e4", "4"], ["e5", "5"], ["e6", "6"],
]);
const subjectAliases = new Map([
  ["eng", "英"], ["english", "英"], ["英語", "英"],
  ["math", "数"], ["数学", "数"], ["arith", "算"], ["算数", "算"],
  ["jp", "国"], ["japanese", "国"], ["国語", "国"],
  ["sci", "理"], ["science", "理"], ["理科", "理"],
  ["soc", "社"], ["social", "社"], ["社会", "社"],
]);

export function lessonNotionIdentity(lesson) {
  const payload = lesson?.source_payload ?? {};
  const gradeSource = String(payload.grade ?? lesson?.grade ?? "").normalize("NFKC").toLowerCase();
  const subjectSource = String(payload.subject ?? lesson?.subject ?? "").normalize("NFKC").toLowerCase();
  const grade = gradeAliases.get(gradeSource) ?? gradeSource.replace(/[^0-9]/g, "");
  const className = String(payload.class ?? lesson?.class_name ?? "").normalize("NFKC").replace(/[\s　]/g, "").toUpperCase();
  const subject = subjectAliases.get(subjectSource) ?? subjectSource.slice(0, 1);
  if (grade && className && subject) return normalizeLessonIdentityText(`${grade}${className}${subject}`);
  return normalizeLessonIdentityText(lesson?.label);
}

export function resolveNotionLesson(lessons, input) {
  const date = String(input?.date ?? "").slice(0, 10);
  const campus = normalizeCampus(input?.campus);
  const notionLesson = normalizeLessonIdentityText(input?.lessonName);
  const matches = (lessons ?? []).filter((lesson) => {
    if (date && String(lesson?.lesson_date ?? "").slice(0, 10) !== date) return false;
    if (campus && normalizeCampus(lesson?.campus) !== campus) return false;
    if (notionLesson && lessonNotionIdentity(lesson) !== notionLesson) return false;
    return true;
  });
  return { lesson: matches.length === 1 ? matches[0] : null, matches };
}
