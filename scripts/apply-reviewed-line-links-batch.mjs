import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function readArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? "";
}

async function selectAll(client, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function main() {
  loadEnv(path.resolve(".env.local"));
  const specPath = readArg("spec");
  const apply = process.argv.includes("--apply");
  if (!specPath) throw new Error("Required: --spec=<reviewed-line-links.json>");
  const specs = JSON.parse(fs.readFileSync(path.resolve(specPath), "utf8"));
  if (!Array.isArray(specs) || !specs.length) throw new Error("Spec must be a non-empty JSON array.");
  const allowedRelations = new Set(["student", "mother", "father", "guardian", "family", "unknown"]);
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const [roster, accounts, legacyLinks] = await Promise.all([
    selectAll(client, "student_roster", "student_number,student_name,grade,campus"),
    selectAll(client, "student_line_accounts", "student_number,line_user_id,relation,alias_name,friend_display_name,is_primary,source"),
    selectAll(client, "student_line_links", "student_number,line_user_id"),
  ]);
  const rosterByNumber = new Map(roster.map((row) => [row.student_number, row]));
  const prepared = [];
  const errors = [];
  for (const spec of specs) {
    if (!spec.student_number || !spec.line_user_id || !allowedRelations.has(spec.relation)) {
      errors.push({ suffix: String(spec.line_user_id ?? "").slice(-5), reason: "invalid_required_fields" });
      continue;
    }
    const student = rosterByNumber.get(spec.student_number);
    if (!student) {
      errors.push({ suffix: spec.line_user_id.slice(-5), reason: "target_student_not_found" });
      continue;
    }
    const rowsForLine = accounts.filter((row) => row.line_user_id === spec.line_user_id);
    const allowedNumbers = new Set([spec.student_number, spec.from_student_number].filter(Boolean));
    const conflicts = rowsForLine.filter((row) => !allowedNumbers.has(row.student_number));
    if (conflicts.length) {
      errors.push({ suffix: spec.line_user_id.slice(-5), reason: "linked_to_other_student", conflict_count: conflicts.length });
      continue;
    }
    const existing = rowsForLine.find((row) => row.student_number === spec.student_number)
      ?? rowsForLine.find((row) => row.student_number === spec.from_student_number)
      ?? null;
    prepared.push({
      ...spec,
      student,
      existing,
      is_primary: typeof spec.is_primary === "boolean" ? spec.is_primary : Boolean(existing?.is_primary),
    });
  }
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    count: prepared.length,
    rows: prepared.map((row) => ({
      line_user_id_suffix: row.line_user_id.slice(-5),
      student_name: row.student.student_name,
      relation: row.relation,
      alias_name: row.alias_name,
      from_student_number: row.from_student_number ?? null,
      is_primary: row.is_primary,
      existing_source: row.existing?.source ?? null,
    })),
    errors,
  }, null, 2));
  if (errors.length) throw new Error("Some reviewed links failed validation; nothing was changed.");
  if (!apply) return;

  const now = new Date().toISOString();
  for (const row of prepared) {
    const accountPayload = {
      student_number: row.student_number,
      line_user_id: row.line_user_id,
      relation: row.relation,
      alias_name: row.alias_name ?? null,
      friend_display_name: row.friend_display_name ?? null,
      source: "user_verified_first_self_introduction",
      is_primary: row.is_primary,
      updated_at: now,
    };
    if (row.from_student_number && row.from_student_number !== row.student_number && row.existing?.student_number === row.from_student_number) {
      const { error } = await client.from("student_line_accounts").update(accountPayload)
        .eq("student_number", row.from_student_number).eq("line_user_id", row.line_user_id);
      if (error) throw error;
      const oldLegacy = legacyLinks.find((link) => link.student_number === row.from_student_number && link.line_user_id === row.line_user_id);
      if (oldLegacy) {
        const { error: upsertLegacyError } = await client.from("student_line_links")
          .upsert({ student_number: row.student_number, line_user_id: row.line_user_id, updated_at: now }, { onConflict: "student_number" });
        if (upsertLegacyError) throw upsertLegacyError;
        const { error: deleteLegacyError } = await client.from("student_line_links").delete()
          .eq("student_number", row.from_student_number).eq("line_user_id", row.line_user_id);
        if (deleteLegacyError) throw deleteLegacyError;
      }
    } else {
      const { error } = await client.from("student_line_accounts").upsert(accountPayload, { onConflict: "student_number,line_user_id" });
      if (error) throw error;
    }
  }

  const verified = [];
  for (const row of prepared) {
    const { data, error } = await client.from("student_line_accounts")
      .select("student_number,line_user_id,relation,alias_name,friend_display_name,is_primary,source")
      .eq("student_number", row.student_number).eq("line_user_id", row.line_user_id).maybeSingle();
    if (error) throw error;
    if (!data || data.alias_name !== row.alias_name || data.relation !== row.relation) {
      throw new Error(`Verification failed for ${row.line_user_id.slice(-5)}`);
    }
    verified.push({ suffix: row.line_user_id.slice(-5), student_name: row.student.student_name, relation: data.relation, source: data.source });
  }
  console.log(JSON.stringify({ applied: true, verified_count: verified.length, verified }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
