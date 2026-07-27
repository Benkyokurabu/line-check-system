import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

function readArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? "";
}

loadEnvFile(".env.local");

const studentNumber = readArg("student");
const lineUserId = readArg("line-user");
const relation = readArg("relation");
const aliasName = readArg("alias") || null;
const displayName = readArg("display-name") || null;
const isPrimary = readArg("primary") === "true";
const apply = process.argv.includes("--apply");
const allowedRelations = new Set(["student", "mother", "father", "guardian", "family", "unknown"]);

if (!studentNumber || !lineUserId || !allowedRelations.has(relation)) {
  throw new Error(
    "Required: --student=... --line-user=... --relation=student|mother|father|guardian|family|unknown",
  );
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const [
  rosterResult,
  studentAccountsResult,
  lineAccountResult,
  legacyResult,
] = await Promise.all([
  supabase
    .from("student_roster")
    .select("student_number,student_name,grade,campus,homeroom_teacher")
    .eq("student_number", studentNumber)
    .maybeSingle(),
  supabase
    .from("student_line_accounts")
    .select("student_number,line_user_id,relation,alias_name,friend_display_name,is_primary,source")
    .eq("student_number", studentNumber),
  supabase
    .from("student_line_accounts")
    .select("student_number,line_user_id,relation,alias_name,is_primary")
    .eq("line_user_id", lineUserId),
  supabase
    .from("student_line_links")
    .select("student_number,line_user_id")
    .eq("student_number", studentNumber)
    .maybeSingle(),
]);

for (const result of [rosterResult, studentAccountsResult, lineAccountResult, legacyResult]) {
  if (result.error) throw result.error;
}
if (!rosterResult.data) throw new Error(`Student not found: ${studentNumber}`);

const conflictingAccounts = (lineAccountResult.data ?? []).filter(
  (row) => row.student_number !== studentNumber,
);
if (conflictingAccounts.length) {
  throw new Error(`LINE account is already linked to another student: ${JSON.stringify(conflictingAccounts)}`);
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  student: rosterResult.data,
  requested_account: {
    line_user_id: lineUserId,
    relation,
    alias_name: aliasName,
    friend_display_name: displayName,
    is_primary: isPrimary,
  },
  existing_student_accounts: studentAccountsResult.data ?? [],
  existing_primary_link: legacyResult.data ?? null,
  conflicts: conflictingAccounts,
}, null, 2));

if (!apply) process.exit(0);

const now = new Date().toISOString();
if (isPrimary) {
  const { error: clearPrimaryError } = await supabase
    .from("student_line_accounts")
    .update({ is_primary: false, updated_at: now })
    .eq("student_number", studentNumber)
    .neq("line_user_id", lineUserId);
  if (clearPrimaryError) throw clearPrimaryError;
}

const { error: accountError } = await supabase
  .from("student_line_accounts")
  .upsert({
    student_number: studentNumber,
    line_user_id: lineUserId,
    relation,
    alias_name: aliasName,
    friend_display_name: displayName,
    source: "user_verified",
    is_primary: isPrimary,
    updated_at: now,
  }, { onConflict: "student_number,line_user_id" });
if (accountError) throw accountError;

if (isPrimary) {
  const { error: legacyError } = await supabase
    .from("student_line_links")
    .upsert({
      student_number: studentNumber,
      line_user_id: lineUserId,
      updated_at: now,
    }, { onConflict: "student_number" });
  if (legacyError) throw legacyError;
}

const { data: verifiedAccounts, error: verifyAccountsError } = await supabase
  .from("student_line_accounts")
  .select("student_number,line_user_id,relation,alias_name,friend_display_name,is_primary,source")
  .eq("student_number", studentNumber)
  .order("is_primary", { ascending: false });
if (verifyAccountsError) throw verifyAccountsError;

const { data: verifiedLegacy, error: verifyLegacyError } = await supabase
  .from("student_line_links")
  .select("student_number,line_user_id")
  .eq("student_number", studentNumber)
  .maybeSingle();
if (verifyLegacyError) throw verifyLegacyError;

console.log(JSON.stringify({
  applied: true,
  verified_accounts: verifiedAccounts ?? [],
  verified_primary_link: verifiedLegacy ?? null,
}, null, 2));
