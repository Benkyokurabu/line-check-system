import { normalizeStudentName } from "./student-linking.ts";

const text = value => String(value ?? "").normalize("NFKC").replace(/\s/g, "");
const pageKey = value => text(value).replace(/-/g, "");
const identityKey = row => row.grade && row.campus
  ? [normalizeStudentName(row.student_name), text(row.grade), text(row.campus)].join("|") : null;

// A match is a warning, never evidence for automatically merging real people.
export function planStudentImport(incoming, existing, profiles = [], aliases = []) {
  const verified = aliases.filter(alias => alias.verified === true && alias.from && alias.to && alias.from !== alias.to);
  const approved = (from, to) => verified.some(alias => alias.from === from && alias.to === to);
  const byNumber = new Map(existing.map(row => [row.student_number, row]));
  const byPage = new Map(profiles.map(row => [pageKey(row.notion_page_id), row]));
  const issues = [];
  const safe = [];
  for (const row of incoming) {
    const conflicts = [];
    const number = row.student_number;
    const current = byNumber.get(number);
    const previous = row.notion_page_id && byPage.get(pageKey(row.notion_page_id));
    if (!/^\d{7}$/.test(number) && !/^notion:[a-f0-9]{32}$/i.test(number)) {
      conflicts.push({ reason: "学籍番号の形式を確認してください", previous_student_number: null });
    }
    if (verified.some(alias => alias.from === number)) {
      conflicts.push({ reason: "確認済みの旧番号が元データに残っています", previous_student_number: verified.find(alias => alias.from === number).to });
    }
    if (incoming.filter(other => other.student_number === number).length > 1) {
      conflicts.push({ reason: "元データに同じ学籍番号が複数あります", previous_student_number: number });
    }
    if (current && normalizeStudentName(current.student_name) !== normalizeStudentName(row.student_name)) {
      conflicts.push({ reason: "同じ学籍番号に異なる氏名が登録されています", previous_student_number: number });
    }
    if (previous && previous.student_number !== number && !approved(previous.student_number, number)) {
      conflicts.push({ reason: "同じNotionページの学籍番号が変更されています", previous_student_number: previous.student_number });
    }
    const key = identityKey(row);
    const others = key ? [...existing, ...incoming].filter(other => other.student_number !== number
      && identityKey(other) === key && !approved(other.student_number, number)) : [];
    for (const other of others) {
      conflicts.push({ reason: "同じ氏名・学年・教室に別の学籍番号があります（別人の場合もあるため自動統合しません）", previous_student_number: other.student_number });
    }
    if (conflicts.length) {
      for (const conflict of conflicts) {
        const issue = { ...conflict, student_number: number, student_name: row.student_name,
          grade: row.grade ?? null, campus: row.campus ?? null,
          notion_page_id: row.notion_page_id ?? null, source_file: row.source_file ?? "Notion生徒情報DB" };
        if (!issues.some(item => JSON.stringify(item) === JSON.stringify(issue))) issues.push(issue);
      }
    } else safe.push(row);
  }
  return { safe, issues, held_student_numbers: [...new Set(issues.map(issue => issue.student_number))] };
}

export async function readStudentImportContext(supabase) {
  async function all(table, columns) {
    const result = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from(table).select(columns).range(start, start + 999);
      if (error) throw error;
      result.push(...(data ?? []));
      if ((data?.length ?? 0) < 1000) return result;
    }
  }
  const [existing, profiles, setting] = await Promise.all([
    all("student_roster", "student_number,student_name,grade,campus,source_file"),
    all("notion_student_profiles", "notion_page_id,student_number,student_name"),
    supabase.from("app_settings").select("value").eq("key", "verified_student_identity_aliases").maybeSingle(),
  ]);
  if (setting.error) throw setting.error;
  return { existing, profiles, aliases: setting.data?.value?.aliases ?? [] };
}

export function planWithContext(rows, context) {
  return planStudentImport(rows, context.existing, context.profiles, context.aliases);
}

export async function recordStudentImportReview(supabase, source, plan) {
  // One independent key per import path. A corrected source clears its own queue on the next run.
  const { error } = await supabase.from("app_settings").upsert({
    key: `student_import_review_${source}`,
    value: { source, checked_at: new Date().toISOString(), issues: plan.issues,
      held_student_numbers: plan.held_student_numbers },
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (error) throw error;
}
