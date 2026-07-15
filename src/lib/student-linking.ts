export type LineAlias = {
  line_user_id: string;
  alias_name: string | null;
};

export type LineAccount = {
  line_user_id: string;
  relation: string;
  alias_name: string | null;
  friend_display_name?: string | null;
  is_primary: boolean;
};

export function selectPreferredLineUserId<T extends {
  line_user_id: string;
  relation: string;
  is_primary: boolean;
}>(accounts: T[]): string | null {
  return (
    accounts.find((account) => account.is_primary) ??
    accounts.find((account) => account.relation === "mother") ??
    accounts[0] ??
    null
  )?.line_user_id ?? null;
}

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

export function relationFromAliasName(value: string | null | undefined) {
  const text = (value ?? "").normalize("NFKC");
  if (text.includes("母")) return "mother";
  if (text.includes("父")) return "father";
  if (text.includes("保護者")) return "guardian";
  if (/[家族]|兄|姉|弟|妹/.test(text)) return "family";
  return "student";
}

export function findLinkedLineAccounts(
  studentName: string,
  aliases: LineAlias[],
): LineAccount[] {
  const normalizedStudent = normalizeStudentName(studentName);
  if (!normalizedStudent) return [];

  const matches = aliases.filter((alias) => {
    const normalizedAlias = normalizeStudentName(alias.alias_name);
    if (normalizedAlias === normalizedStudent || normalizedAlias.includes(normalizedStudent)) return true;

    // Family accounts sometimes contain a sibling name between the surname
    // and this student's given name (for example: 相良海成・空 父).
    const surname = normalizedStudent.slice(0, 2);
    const givenName = normalizedStudent.slice(2);
    return Boolean(
      surname &&
      givenName &&
      normalizedAlias.includes(surname) &&
      normalizedAlias.includes(givenName),
    );
  });

  const byUserId = new Map<string, LineAccount>();
  for (const match of matches) {
    if (byUserId.has(match.line_user_id)) continue;
    const relation = relationFromAliasName(match.alias_name);
    byUserId.set(match.line_user_id, {
      line_user_id: match.line_user_id,
      relation,
      alias_name: match.alias_name,
      is_primary: relation === "mother" || relation === "guardian",
    });
  }

  return [...byUserId.values()].sort((a, b) => {
    const rank = (relation: string) =>
      relation === "mother" ? 0 :
      relation === "guardian" ? 1 :
      relation === "father" ? 2 :
      relation === "student" ? 3 :
      4;
    return rank(a.relation) - rank(b.relation);
  });
}
