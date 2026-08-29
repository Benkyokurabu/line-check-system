import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { helperOriginAllowed } from "../src/lib/line-contact-registration.mjs";
import { parseLineAliasCsv } from "../src/lib/line-alias-import.mjs";

const execFileAsync = promisify(execFile);
const HOST = "127.0.0.1";
const HELPER_PORT = Number(process.env.LINE_SYNC_HELPER_PORT ?? 39123);
const DEVTOOLS_PORT = Number(process.env.LINE_MANAGER_DEVTOOLS_PORT ?? 9222);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_DIR = path.join(ROOT, ".line-manager-chrome-profile");
const EXPORT_SCRIPT = path.join(ROOT, "scripts", "export-line-manager-chats.mjs");
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
let running = false;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function send(response, status, body, origin) {
  response.writeHead(status, corsHeaders(origin));
  response.end(JSON.stringify(body));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(1500, () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

async function chatTargetAvailable() {
  try {
    const targets = await getJson(`http://${HOST}:${DEVTOOLS_PORT}/json/list`);
    return Array.isArray(targets) && targets.some((target) => target.type === "page" && String(target.url).includes("chat.line.biz"));
  } catch {
    return false;
  }
}

function findChrome() {
  const chrome = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!chrome) throw new Error("Google Chrome または Microsoft Edge が見つかりません");
  return chrome;
}

async function ensureLineManagerOpen() {
  if (await chatTargetAvailable()) return true;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const child = spawn(findChrome(), [
    `--remote-debugging-port=${DEVTOOLS_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--disable-default-apps",
    "https://chat.line.biz/",
  ], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await chatTargetAvailable()) return true;
  }
  return false;
}

async function exportRows() {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "line-alias-sync-"));
  const output = path.join(tempDirectory, "aliases.csv");
  try {
    await execFileAsync(process.execPath, [EXPORT_SCRIPT, "--port", String(DEVTOOLS_PORT), "--output", output], {
      cwd: ROOT,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const rows = parseLineAliasCsv(fs.readFileSync(output, "utf8"));
    return rows.filter((row) => row.line_user_id && row.alias_name);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

const server = http.createServer(async (request, response) => {
  const origin = String(request.headers.origin ?? "");
  if (!helperOriginAllowed(origin)) {
    send(response, 403, { error: "この画面からは同期できません" }, "null");
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/status") {
    send(response, 200, { ok: true, busy: running }, origin);
    return;
  }
  if (request.method !== "POST" || request.url !== "/sync") {
    send(response, 404, { error: "not found" }, origin);
    return;
  }
  if (running) {
    send(response, 409, { error: "別の同期処理が進行中です" }, origin);
    return;
  }

  running = true;
  try {
    if (!(await ensureLineManagerOpen())) {
      send(response, 409, { error: "専用LINE管理画面でログインしてください。ログイン後に同期ボタンをもう一度押してください" }, origin);
      return;
    }
    const rows = await exportRows();
    send(response, 200, { ok: true, rows, count: rows.length, fetched_at: new Date().toISOString() }, origin);
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : String(error) }, origin);
  } finally {
    running = false;
  }
});

server.listen(HELPER_PORT, HOST, () => {
  console.log(JSON.stringify({ ok: true, service: "line-manager-sync-helper", url: `http://${HOST}:${HELPER_PORT}` }));
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
