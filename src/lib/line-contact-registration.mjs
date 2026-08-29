const ALLOWED_RELATIONS = new Set(["student", "mother", "father", "guardian", "family", "unknown"]);

export function compactStudentName(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　]/g, "");
}
export function buildLineContactAlias(student, relation) {
  if (!student?.student_name) return "";
  const campus = String(student.campus ?? "").includes("南") ? "南" : "本";
  const base = `${campus}　${compactStudentName(student.student_name)}`;
  if (relation === "student") return base;
  if (relation === "mother") return `${base}　母`;
  if (relation === "father") return `${base}　父`;
  return `${base}　保護者`;
}

export function studentInstructionTypeLabel(value) {
  const instructionType = String(value ?? "").trim();
  return instructionType || "授業形態未設定";
}

export function studentRegistrationLabel(student) {
  if (!student) return "";
  return [
    student.grade || "学年未設定",
    student.student_name || "氏名未設定",
    studentInstructionTypeLabel(student.instruction_type),
    student.campus || "校舎未設定",
    student.school_name || null,
    student.student_number ? `生徒番号 ${student.student_number}` : null,
  ].filter(Boolean).join("｜");
}

export function studentRegistrationSearchText(student) {
  if (!student) return "";
  return [
    student.student_number,
    student.student_name,
    student.grade,
    student.instruction_type,
    student.campus,
    student.school_name,
    student.homeroom_teacher,
  ].filter(Boolean).join("").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

export function normalizeVerificationTargets(targets) {
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 10) {
    throw new Error("登録する生徒を1名以上選択してください");
  }
  const seen = new Set();
  return targets.map((source) => {
    const row = source && typeof source === "object" ? source : {};
    const studentNumber = String(row.student_number ?? "").trim().slice(0, 100);
    const relation = ALLOWED_RELATIONS.has(String(row.relation ?? "")) ? String(row.relation) : "guardian";
    const aliasName = String(row.alias_name ?? "").trim().slice(0, 200);
    if (!studentNumber || !aliasName) throw new Error("生徒と登録名を確認してください");
    if (seen.has(studentNumber)) throw new Error("同じ生徒が重複しています");
    seen.add(studentNumber);
    return {
      student_number: studentNumber,
      relation,
      alias_name: aliasName,
      is_primary: row.is_primary === true || relation === "student",
    };
  });
}

export function classifyLineContact(contact) {
  if (contact?.system_verified === true || contact?.registration_state === "system_registered") return "system_registered";
  if (contact?.pending_evidence === true || contact?.registration_state === "pending") return "pending";
  return "other";
}

export function relationLabel(value) {
  return ({ student: "本人", mother: "母", father: "父", guardian: "保護者", family: "家族", unknown: "続柄未確認" })[value] ?? "保護者";
}

export function helperOriginAllowed(origin) {
  if (!origin) return false;
  if (origin === "https://line-check-system.vercel.app") return true;
  if (/^https:\/\/line-check-system-[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000";
}
