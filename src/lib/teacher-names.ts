const TEACHER_NAME_ALIASES: Record<string, string[]> = {
  "髙山": ["高山", "髙山"],
};

const DISPLAY_NAME_BY_ALIAS = new Map<string, string>(
  Object.entries(TEACHER_NAME_ALIASES).flatMap(([displayName, aliases]) =>
    aliases.map((alias) => [alias, displayName]),
  ),
);

export function canonicalTeacherName(name: string) {
  const trimmed = name.trim();
  return DISPLAY_NAME_BY_ALIAS.get(trimmed) ?? trimmed;
}

export function teacherNameVariants(name: string) {
  const canonical = canonicalTeacherName(name);
  return TEACHER_NAME_ALIASES[canonical] ?? [canonical];
}

