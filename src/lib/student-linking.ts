export type LineAlias = {
  line_user_id: string;
  alias_name: string | null;
};

export function normalizeStudentName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[ \t\r\n\u3000]/g, "")
    .replace(/(さん|様|くん|君|ちゃん)$/g, "")
    .replace(/(父|母|保護者|お父様|お母様)$/g, "")
    .trim();
}

export function findLinkedLineUserId(
  studentName: string,
  aliases: LineAlias[],
): string | null {
  const normalizedStudent = normalizeStudentName(studentName);
  if (!normalizedStudent) return null;

  const matches = aliases.filter(
    (alias) => normalizeStudentName(alias.alias_name) === normalizedStudent,
  );
  const uniqueUserIds = [...new Set(matches.map((match) => match.line_user_id))];

  return uniqueUserIds.length === 1 ? uniqueUserIds[0] : null;
}
