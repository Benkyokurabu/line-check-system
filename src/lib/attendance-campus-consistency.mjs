export function normalizeCampus(value) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[\s　]/g, "");
  if (!normalized) return null;
  if (normalized === "本" || normalized.includes("本校")) return "本校";
  if (normalized === "南" || normalized.includes("南教室")) return "南教室";
  return String(value).trim() || null;
}

function isDualCampus(value) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[\s　・･,，、／/]/g, "");
  return normalized === "両方" || normalized.includes("両校舎") || (normalized.includes("本") && normalized.includes("南"));
}

export function campusFromEnrollmentClassroom(value) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[\s　]/g, "");
  if (normalized === "本" || normalized === "本校") return "本校";
  if (normalized === "南" || normalized === "南教室") return "南教室";
  return null;
}

export function studentCampusIncludesLesson(studentCampus, lessonCampus) {
  const lesson = normalizeCampus(lessonCampus);
  if (!lesson) return false;
  if (isDualCampus(studentCampus)) return lesson === "本校" || lesson === "南教室";
  return normalizeCampus(studentCampus) === lesson;
}

export function normalizeLessonIdentityText(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　・･\-_／/]/g, "").toLowerCase();
}

function subjectMatches(enrollment, lesson) {
  const enrollmentSubject = normalizeLessonIdentityText(enrollment?.subject);
  const lessonSubject = normalizeLessonIdentityText(lesson?.subject);
  return Boolean(enrollmentSubject && lessonSubject) &&
    (enrollmentSubject.includes(lessonSubject) || lessonSubject.includes(enrollmentSubject));
}

function enrollmentIdentityMatchesLesson(enrollment, lesson, requireClass) {
  const enrollmentGrade = normalizeLessonIdentityText(enrollment?.grade);
  const lessonGrade = normalizeLessonIdentityText(lesson?.grade);
  const enrollmentClass = normalizeLessonIdentityText(enrollment?.class_name);
  const lessonClass = normalizeLessonIdentityText(lesson?.class_name);
  if (!enrollmentGrade || enrollmentGrade !== lessonGrade || !subjectMatches(enrollment, lesson)) return false;
  return !requireClass || Boolean(enrollmentClass && lessonClass && enrollmentClass === lessonClass);
}

export function enrollmentCampusForLesson(enrollments, lesson) {
  const subjectRows = (enrollments ?? []).filter((enrollment) => enrollmentIdentityMatchesLesson(enrollment, lesson, false));
  const exactClassRows = subjectRows.filter((enrollment) => enrollmentIdentityMatchesLesson(enrollment, lesson, true));
  const candidates = exactClassRows.length > 0 ? exactClassRows : subjectRows;
  const campuses = [...new Set(candidates.map((enrollment) => campusFromEnrollmentClassroom(enrollment?.classroom)).filter(Boolean))];
  return campuses.length === 1 ? campuses[0] : null;
}

export function enrollmentMatchesLesson(enrollment, lesson, studentCampus) {
  if (!enrollmentIdentityMatchesLesson(enrollment, lesson, true)) return false;
  const enrollmentCampus = campusFromEnrollmentClassroom(enrollment?.classroom);
  const campusMatches = enrollmentCampus
    ? enrollmentCampus === normalizeCampus(lesson?.campus)
    : studentCampusIncludesLesson(studentCampus, lesson?.campus);
  return campusMatches;
}

export function isAttendanceCrossCampus(input) {
  const lessonCampus = normalizeCampus(input?.lessonCampus);
  const enrollmentCampus = normalizeCampus(input?.enrollmentCampus);
  if (!lessonCampus) return false;
  if (enrollmentCampus === "本校" || enrollmentCampus === "南教室") return enrollmentCampus !== lessonCampus;
  return !studentCampusIncludesLesson(input?.studentCampus, lessonCampus);
}

export function validateAttendanceCampusSelection(input) {
  const studentCampus = normalizeCampus(input?.studentCampus);
  const lessonCampus = normalizeCampus(input?.lessonCampus);
  const requestedCampus = normalizeCampus(input?.requestedCampus);
  const enrollmentCampus = normalizeCampus(input?.enrollmentCampus);
  const override = input?.crossCampusOverride === true;
  const reason = String(input?.crossCampusReason ?? "").trim();

  if (!studentCampus && !enrollmentCampus) return { ok: false, crossCampus: false, error: "生徒の所属校舎を確認できません" };
  if (!lessonCampus) return { ok: false, crossCampus: false, error: "選択した授業の校舎を確認できません" };
  if (requestedCampus && requestedCampus !== lessonCampus) {
    return { ok: false, crossCampus: isAttendanceCrossCampus(input), error: "指定校舎と選択した授業の校舎が一致しません" };
  }
  const crossCampus = isAttendanceCrossCampus({ ...input, studentCampus, lessonCampus, enrollmentCampus });
  if (!crossCampus && override) {
    return { ok: false, crossCampus: false, error: "所属校舎と授業校舎が同じため、別校舎受講の指定は不要です" };
  }
  if (crossCampus && !override) {
    const basis = enrollmentCampus === "本校" || enrollmentCampus === "南教室"
      ? `科目別の通常校舎（${enrollmentCampus}）`
      : `所属校舎（${studentCampus}）`;
    return { ok: false, crossCampus: true, error: `${basis}と授業校舎（${lessonCampus}）が一致しません` };
  }
  if (crossCampus && !reason) {
    return { ok: false, crossCampus: true, error: "別校舎受講を登録する理由を入力してください" };
  }
  return { ok: true, crossCampus, error: null };
}

export function shouldDisplayAttendanceEvent(input) {
  const crossCampus = isAttendanceCrossCampus(input);
  if (!crossCampus) return Boolean(normalizeCampus(input?.lessonCampus));
  return input?.crossCampusOverride === true && Boolean(String(input?.crossCampusReason ?? "").trim());
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
