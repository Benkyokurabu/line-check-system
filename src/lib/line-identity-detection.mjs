const RELATION_PATTERNS = [
  { relation: "mother", suffixes: ["の母です", "母です"] },
  { relation: "father", suffixes: ["の父です", "父です"] },
  { relation: "guardian", suffixes: ["の保護者です", "保護者です"] },
  { relation: "student", suffixes: ["本人です"] },
];

export function normalizeIdentityText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u3000・･()（）\[\]【】「」『』]/g, "")
    .replace(/[齊齋斉]/g, "斎")
    .replaceAll("髙", "高");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExplicitStatement(text, phrase) {
  const pattern = new RegExp(`${escapeRegExp(phrase)}(?:$|[、,。.!！\\n])`);
  return pattern.test(text);
}

export function detectExplicitLineIdentities(textValue, students) {
  const text = normalizeIdentityText(textValue);
  if (!text) return [];

  const matches = [];
  for (const student of students) {
    const name = normalizeIdentityText(student.student_name);
    if (!name) continue;

    for (const pattern of RELATION_PATTERNS) {
      if (pattern.suffixes.some((suffix) => isExplicitStatement(text, `${name}${suffix}`))) {
        matches.push({
          student_number: student.student_number,
          student_name: student.student_name,
          relation: pattern.relation,
        });
      }
    }

    if (isExplicitStatement(text, `生徒の${name}です`)) {
      matches.push({
        student_number: student.student_number,
        student_name: student.student_name,
        relation: "student",
      });
    }
  }

  return [...new Map(matches.map((match) => [
    `${match.student_number}|${match.relation}`,
    match,
  ])).values()];
}
