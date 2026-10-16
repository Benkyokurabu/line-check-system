import type { SupabaseClient } from "@supabase/supabase-js";

export const STUDENT_IDENTITY_ALIASES_KEY = "verified_student_identity_aliases";
export type StudentIdentityAlias = { from: string; to: string; verified: true };

export async function loadStudentIdentityAliases(db: SupabaseClient): Promise<StudentIdentityAlias[]> {
  const { data, error } = await db.from("app_settings").select("value")
    .eq("key", STUDENT_IDENTITY_ALIASES_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const aliases: unknown = data?.value?.aliases;
  if (!Array.isArray(aliases)) return [];
  return aliases.filter((item): item is StudentIdentityAlias => item?.verified === true
    && typeof item.from === "string" && !!item.from.trim()
    && typeof item.to === "string" && !!item.to.trim());
}
