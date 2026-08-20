import fs from "node:fs";
import path from "node:path";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function loadEnv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

loadEnv(path.resolve(argument("--env-file", ".env.attendance-production.local")));
const appUrl = argument("--app-url", "https://line-check-system.vercel.app").replace(/\/$/, "");
const token = process.env.INTERNAL_API_TOKEN || process.env.CRON_SECRET;
const limit = Math.min(Math.max(Number(argument("--limit", "10")), 1), 30);
const maxRuns = Math.max(Number(argument("--max-runs", "100")), 1);
if (!token) throw new Error("INTERNAL_API_TOKEN or CRON_SECRET is required");

const totals = { processed: 0, candidates: 0, ignored: 0, retrying: 0, dead: 0 };
for (let run = 1; run <= maxRuns; run += 1) {
  const response = await fetch(`${appUrl}/api/cron/attendance-extract?limit=${limit}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Attendance worker returned ${response.status}`);
  for (const key of Object.keys(totals)) totals[key] += Number(result[key] ?? 0);
  console.log(JSON.stringify({ run, ...result, totals }));
  if (Number(result.processed ?? 0) === 0) break;
}
console.log(JSON.stringify({ ok: true, totals }, null, 2));
