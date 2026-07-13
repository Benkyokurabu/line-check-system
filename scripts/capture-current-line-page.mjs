import fs from "node:fs";
import http from "node:http";
import process from "node:process";

const DEFAULT_PORT = 9222;
const DEFAULT_OUTPUT = "line_manager_current_page_capture.jsonl";
const DEFAULT_SECONDS = 30;

function parseArgs(argv) {
  const args = {
    port: DEFAULT_PORT,
    output: DEFAULT_OUTPUT,
    seconds: DEFAULT_SECONDS,
    reload: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--port" && next) {
      args.port = Number(next);
      i += 1;
    } else if (arg === "--output" && next) {
      args.output = next;
      i += 1;
    } else if (arg === "--seconds" && next) {
      args.seconds = Number(next);
      i += 1;
    } else if (arg === "--no-reload") {
      args.reload = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.port) || args.port < 1) args.port = DEFAULT_PORT;
  if (!Number.isFinite(args.seconds) || args.seconds < 5) args.seconds = DEFAULT_SECONDS;
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/capture-current-line-page.mjs [options]

Options:
  --output <path>  JSONL output path. Default: ${DEFAULT_OUTPUT}
  --seconds <num>  Capture duration. Default: ${DEFAULT_SECONDS}
  --no-reload      Do not reload the current page.
  --port <num>     DevTools port. Default: ${DEFAULT_PORT}`);
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

function shouldKeep(url, body, mimeType) {
  const lowerUrl = String(url ?? "").toLowerCase();
  const lowerMime = String(mimeType ?? "").toLowerCase();
  const text = String(body ?? "");
  if (lowerMime.includes("image") || lowerMime.includes("font") || lowerMime.includes("video")) {
    return false;
  }
  if (!lowerUrl.includes("line.biz") && !lowerUrl.includes("line.me")) return false;
  if (text.length > 2_000_000) return false;
  return (
    lowerUrl.includes("chat") ||
    lowerUrl.includes("contact") ||
    lowerUrl.includes("profile") ||
    text.includes("displayName") ||
    text.includes("profile") ||
    text.includes("contacts") ||
    text.includes("users")
  );
}

function writeJsonl(stream, record) {
  stream.write(`${JSON.stringify(record)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = await httpJson(`http://127.0.0.1:${args.port}/json/list`);
  const page = targets.find(
    (target) =>
      target.type === "page" &&
      target.webSocketDebuggerUrl &&
      String(target.url).includes("chat.line.biz"),
  );
  if (!page) throw new Error("No chat.line.biz page target found.");

  const client = createCdp(page.webSocketDebuggerUrl);
  await client.ready;
  const output = fs.createWriteStream(args.output, { flags: "w", encoding: "utf8" });
  writeJsonl(output, {
    type: "capture_start",
    captured_at: new Date().toISOString(),
    url: page.url,
    title: page.title,
  });

  const responses = new Map();
  client.on("Network.responseReceived", (params) => {
    const { requestId, response, type } = params;
    responses.set(requestId, {
      url: response?.url ?? "",
      status: response?.status ?? "",
      mimeType: response?.mimeType ?? "",
      resourceType: type,
    });
  });

  client.on("Network.loadingFinished", async ({ requestId }) => {
    const meta = responses.get(requestId);
    if (!meta) return;
    try {
      const result = await client.send("Network.getResponseBody", { requestId });
      const body = result.base64Encoded
        ? Buffer.from(result.body, "base64").toString("utf8")
        : result.body;
      if (!shouldKeep(meta.url, body, meta.mimeType)) return;
      writeJsonl(output, {
        type: "network_response",
        captured_at: new Date().toISOString(),
        ...meta,
        body,
      });
    } catch {
      // Some responses do not expose a body to DevTools.
    }
  });

  await client.send("Network.enable");
  await client.send("Page.enable");
  if (args.reload) await client.send("Page.reload", { ignoreCache: true });

  await new Promise((resolve) => setTimeout(resolve, args.seconds * 1000));
  writeJsonl(output, {
    type: "capture_end",
    captured_at: new Date().toISOString(),
  });
  output.end();
  client.close();
  console.log(JSON.stringify({ output: args.output, seconds: args.seconds }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
