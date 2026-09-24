function uniqueNumbers(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

export function resolveAttendanceStudentFromLine({ confirmedStudentNumbers, linkedStudentNumbers, explicitStudentNumbers, currentStudentNumber }) {
  const confirmed = uniqueNumbers(confirmedStudentNumbers);
  const linked = uniqueNumbers(linkedStudentNumbers);
  const explicit = uniqueNumbers(explicitStudentNumbers);

  if (confirmed.length === 1) {
    if (explicit.some((studentNumber) => studentNumber !== confirmed[0])) {
      return {
        requiresSelection: true,
        resolvedStudentNumber: null,
        reason: "本文の生徒名と、確認済みのLINE登録が一致しません。対象生徒を確認してください。",
      };
    }
    return { requiresSelection: false, resolvedStudentNumber: confirmed[0], reason: null };
  }

  if (confirmed.length > 1) {
    if (explicit.length === 1 && confirmed.includes(explicit[0])) {
      return { requiresSelection: false, resolvedStudentNumber: explicit[0], reason: null };
    }
    return {
      requiresSelection: true,
      resolvedStudentNumber: null,
      reason: "同じLINE連絡先に複数の生徒が確認済みで登録されています。本文から1人に特定できないため、対象生徒を選択してください。",
    };
  }

  if (linked.length > 1) {
    if (explicit.length === 1) return { requiresSelection: false, resolvedStudentNumber: explicit[0], reason: null };
    return {
      requiresSelection: true,
      resolvedStudentNumber: null,
      reason: "同じLINE連絡先に複数の生徒候補が残っています。確定済みの登録がないため、対象生徒を選択してください。",
    };
  }

  return { requiresSelection: false, resolvedStudentNumber: explicit[0] ?? currentStudentNumber ?? null, reason: null };
}
