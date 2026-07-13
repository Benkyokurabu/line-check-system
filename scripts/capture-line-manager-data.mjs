import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_PORT = 9222;
const DEFAULT_SECONDS = 180;
const DEFAULT_OUTPUT = "line_manager_capture.jsonl";
const DEFAULT_PROFILE_DIR = ".line-manager-chrome-profile";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function parseArgs(argv) {
  const args = {
    seconds: DEFAULT_SECONDS,
    output: DEFAULT_OUTPUT,
    port: DEFAULT_PORT,
    profileDir: DEFAULT_PROFILE_DIR,
    chromePath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--seconds" && next) {
      args.seconds = Number(next);
      i += 1;
    } else if (arg === "--output" && next) {
      args.output = next;
      i += 1;
    } else if (arg === "--port" && next) {
      args.port = Number(next);
      i += 1;
    } else if (arg === "--profile-dir" && next) {
      args.profileDir = next;
      i += 1;
    } else if (arg === "--chrome" && next) {
      args.chromePath = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.seconds) || args.seconds < 30) args.seconds = DEFAULT_SECONDS;
  if (!Number.isFinite(args.port) || args.port < 1) args.port = DEFAULT_PORT;
  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run capture:line-manager -- [options]

Options:
  --seconds <num>       Capture duration after Chrome starts. Default: ${DEFAULT_SECONDS}
  --output <path>       JSONL output path. Default: ${DEFAULT_OUTPUT}
  --profile-dir <path>  Chrome profile directory for this capture. Default: ${DEFAULT_PROFILE_DIR}
  --port <num>          DevTools port. Default: ${DEFAULT_PORT}

This opens a visible Chrome window, records LINE Manager network responses and visible page text locally,
and does not send data outside this machine.`);
}

function findChrome(explicitPath) {
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;
  const found = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome or Edge executable was not found.");
  return found;
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

async function waitForDevtools(port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await httpJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Timed out waiting for Chrome DevTools.");
}

async function findPageTarget(port) {
  const targets = await httpJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!page) throw new Error("No Chrome page target found.");
  return page;
}

function createCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }

    const handlers = listeners.get(message.method) ?? [];
    for (const handler of handlers) handler(message.params ?? {});
  });

  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    on(method, handler) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(handler);
    },
    close() {
      socket.close();
    },
  };
}

function shouldKeepResponse(url, body, mimeType) {
  const lowerUrl = String(url ?? "").toLowerCase();
  const lowerMime = String(mimeType ?? "").toLowerCase();
  if (!lowerUrl.includes("line") && !body.includes("ユーザーネーム")) return false;
  if (lowerMime.includes("image") || lowerMime.includes("font") || lowerMime.includes("video")) return false;
  if (body.includes("ユーザーネーム")) return true;
  if (body.includes("友だちが設定した名前")) return true;
  if (body.includes("displayName")) return true;
  if (body.includes("chat")) return true;
  if (body.includes("profile")) return true;
  return false;
}

function writeJsonl(stream, record) {
  stream.write(`${JSON.stringify(record)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromePath = findChrome(args.chromePath);
  const profileDir = path.resolve(args.profileDir);
  fs.mkdirSync(profileDir, { recursive: true });

  const output = fs.createWriteStream(args.output, { flags: "w", encoding: "utf8" });
  writeJsonl(output, {
    type: "capture_start",
    captured_at: new Date().toISOString(),
    seconds: args.seconds,
  });

  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${args.port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--disable-default-apps",
      "https://manager.line.biz/",
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );
  chrome.unref();

  await waitForDevtools(args.port);
  const target = await findPageTarget(args.port);
  const cdp = createCdp(target.webSocketDebuggerUrl);
  await cdp.ready;

  const responses = new Map();
  cdp.on("Network.responseReceived", (params) => {
    const { requestId, response, type } = params;
    responses.set(requestId, {
      url: response?.url ?? "",
      status: response?.status ?? "",
      mimeType: response?.mimeType ?? "",
      resourceType: type,
    });
  });
  cdp.on("Network.loadingFinished", async ({ requestId }) => {
    const meta = responses.get(requestId);
    if (!meta) return;
    try {
      const result = await cdp.send("Network.getResponseBody", { requestId });
      const body = result.base64Encoded
        ? Buffer.from(result.body, "base64").toString("utf8")
        : result.body;
      if (!shouldKeepResponse(meta.url, body, meta.mimeType)) return;
      writeJsonl(output, {
        type: "network_response",
        captured_at: new Date().toISOString(),
        ...meta,
        body,
      });
    } catch {
      // Some responses have no retrievable body. Ignore them.
    }
  });

  await cdp.send("Network.enable");
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const interval = setInterval(async () => {
    try {
      const result = await cdp.send("Runtime.evaluate", {
        expression: `(() => ({
          url: location.href,
          title: document.title,
          text: document.body ? document.body.innerText : ""
        }))()`,
        returnByValue: true,
      });
      const value = result.result?.value;
      if (value?.text) {
        writeJsonl(output, {
          type: "page_text",
          captured_at: new Date().toISOString(),
          url: value.url,
          title: value.title,
          text: value.text,
        });
      }
    } catch {
      // Page may be navigating.
    }
  }, 5000);

  console.log(`Chrome opened. Capture is running for ${args.seconds} seconds.`);
  console.log("If login is required, complete login in the opened Chrome window.");
  console.log("Open LINE Manager chat list/profile screens; captured data stays local.");

  await new Promise((resolve) => setTimeout(resolve, args.seconds * 1000));
  clearInterval(interval);
  writeJsonl(output, {
    type: "capture_end",
    captured_at: new Date().toISOString(),
  });
  output.end();
  cdp.close();
  console.log(`Capture saved: ${args.output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
