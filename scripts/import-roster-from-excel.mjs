import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getRosterImportPreview, importRosterFromExcel } from "../src/lib/roster-import-logic.mjs";

const root = process.cwd();
const force = process.argv.includes("--force");
const previewOnly = process.argv.includes("--preview");

function loadEnvFile(fileName) {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(".env.local");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

try {
  const result = previewOnly
    ? await getRosterImportPreview({ supabase, root })
    : await importRosterFromExcel({ supabase, root, force });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
