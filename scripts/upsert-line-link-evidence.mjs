import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
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

async function main() {
  loadEnvFile(path.resolve(".env.local"));
  const specPath = readArg("spec");
  const apply = process.argv.includes("--apply");
  if (!specPath) throw new Error("Required: --spec=<line-link-evidence.json>");
  const rows = JSON.parse(fs.readFileSync(path.resolve(specPath), "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Evidence spec must be a non-empty JSON array.");
  const allowedRelations = new Set(["student", "mother", "father", "guardian", "family", "unknown"]);
  const prepared = rows.map((row) => {
    if (!row.line_user_id || !row.evidence_text) throw new Error("Each row requires line_user_id and evidence_text.");
    if (!allowedRelations.has(row.relation ?? "unknown")) throw new Error(`Unsupported relation: ${row.relation}`);
    return {
      line_user_id: row.line_user_id,
      manager_line_user_id: row.manager_line_user_id ?? null,
      display_name: row.display_name ?? null,
      manager_alias_name: row.manager_alias_name ?? null,
      evidence_text: row.evidence_text,
      evidence_at: row.evidence_at ?? null,
      parsed_student_name: row.parsed_student_name ?? null,
      relation: row.relation ?? "unknown",
      source: row.source ?? "line_manager_first_self_introduction",
      verified_at: row.verified_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
  const summary = prepared.map(({ line_user_id, manager_line_user_id, ...row }) => ({
    ...row,
    line_user_id_suffix: line_user_id.slice(-5),
    manager_line_user_id_suffix: manager_line_user_id?.slice(-5) ?? null,
  }));
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", count: prepared.length, evidence: summary }, null, 2));
  if (!apply) return;
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { error } = await client.from("line_link_evidence").upsert(prepared, { onConflict: "line_user_id" });
  if (error) throw error;
  const { data, error: verifyError } = await client.from("line_link_evidence")
    .select("line_user_id,evidence_text,parsed_student_name,relation,manager_alias_name")
    .in("line_user_id", prepared.map((row) => row.line_user_id));
  if (verifyError) throw verifyError;
  if ((data ?? []).length !== prepared.length) throw new Error(`Verification failed: expected ${prepared.length}, found ${(data ?? []).length}`);
  console.log(JSON.stringify({ applied: true, verified_count: data.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
