import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] = value;
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function selectAllSummaries() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const result = await supabase.rpc("get_line_contact_admin_summaries").range(from, from + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < 1000) return rows;
  }
}

const [accounts, aliases, events, syncRuns, summaries] = await Promise.all([
  supabase.from("student_line_accounts").select("verification_status", { count: "exact" }),
  supabase.from("line_user_aliases").select("line_user_id", { count: "exact", head: true }),
  supabase.from("line_contact_registration_events").select("id", { count: "exact", head: true }),
  supabase.from("line_alias_sync_runs").select("id", { count: "exact", head: true }),
  selectAllSummaries(),
]);

for (const result of [accounts, aliases, events, syncRuns]) {
  if (result.error) throw result.error;
}

const statuses = (accounts.data ?? []).reduce((result, row) => {
  result[row.verification_status] = (result[row.verification_status] ?? 0) + 1;
  return result;
}, {});
const states = summaries.reduce((result, row) => {
  result[row.registration_state] = (result[row.registration_state] ?? 0) + 1;
  return result;
}, {});

console.log(JSON.stringify({
  ok: true,
  student_line_accounts: accounts.count,
  account_verification_statuses: statuses,
  line_user_aliases: aliases.count,
  registration_events: events.count,
  alias_sync_runs: syncRuns.count,
  contact_summaries: summaries.length,
  contact_states: states,
}, null, 2));
