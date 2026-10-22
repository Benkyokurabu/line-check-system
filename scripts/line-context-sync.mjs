import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { mergeLineContext, parseLineContext } from "../src/lib/line-context-core.mjs";

export function parseArgs(argv) {
  const args = { mode: "once", inputs: [], apply: false, interval: 30000, output: "analysis_outputs/line-context/context.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (["once", "watch", "import"].includes(arg)) args.mode = arg;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (["--input", "--account", "--output", "--interval", "--format"].includes(arg)) {
      const value = argv[++i]; if (!value || value.startsWith("--")) throw new Error(`Missing ${arg} value`);
      if (arg === "--input") args.inputs.push(value);
      else args[arg.slice(2)] = arg === "--interval" ? Number(value) : value;
    } else if (["--help", "-h"].includes(arg)) args.help = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!args.help && (!args.account || !args.inputs.length)) throw new Error("--account and at least one --input are required");
  if (!Number.isFinite(args.interval) || args.interval < 1000) throw new Error("--interval must be at least 1000 ms");
  if (args.format && !["csv", "json", "jsonl"].includes(args.format)) throw new Error("--format must be csv, json or jsonl");
  return args;
}

export async function syncLineContext(args) {
  let previous = { records: [], coverage: [], warnings: [] };
  try { previous = JSON.parse(await fs.readFile(args.output, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  let incoming = { records: [], coverage: [], warnings: [] };
  const failures = [];
  for (const input of args.inputs) {
    try {
      const text = await fs.readFile(input, "utf8");
      const parsed = parseLineContext(text, { account: args.account, sourceRef: path.resolve(input), format: args.format ?? path.extname(input).slice(1).toLowerCase() });
      incoming = mergeLineContext(incoming, parsed);
    } catch (error) { failures.push({ input: path.basename(input), code: error.code ?? "PARSE_ERROR" }); }
  }
  const merged = mergeLineContext(previous, incoming);
  if (args.apply) {
    // Write whole store atomically: failed scans never delete prior evidence.
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    const temporary = `${args.output}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ ...merged, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, args.output);
  }
  const directions = { inbound: 0, outbound: 0, unknown: 0 };
  for (const record of incoming.records) directions[record.direction] += 1;
  return { mode: args.apply ? "apply-local" : "dry-run", files: args.inputs.length, failedFiles: failures, records: incoming.records.length, added: merged.added, total: merged.records.length, directions, coverage: incoming.coverage.map(({ scope, rows, complete, channel }) => ({ scope, rows, complete, channel })), warnings: incoming.warnings, output: args.apply ? path.resolve(args.output) : null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("node scripts/line-context-sync.mjs once|import|watch --account <account-namespace> --input <csv|json|jsonl> [--input ...] [--apply] [--output analysis_outputs/line-context/context.json] [--interval 30000]\nDefault: dry-run. --apply writes local evidence only; never sends LINE messages or modifies line_messages. watch repeatedly scans existing files; it does not collect browser data.");
    return;
  }
  let stopped = false;
  let interrupt;
  process.once("SIGINT", () => { stopped = true; interrupt?.(); });
  process.once("SIGTERM", () => { stopped = true; interrupt?.(); });
  do {
    const report = await syncLineContext(args);
    console.log(JSON.stringify(report));
    if (report.failedFiles.length && args.mode !== "watch") process.exitCode = 1;
    if (args.mode !== "watch" || stopped) break;
    await new Promise((resolve) => { const timer = setTimeout(resolve, args.interval); interrupt = () => { clearTimeout(timer); resolve(); }; });
  } while (!stopped);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; });
