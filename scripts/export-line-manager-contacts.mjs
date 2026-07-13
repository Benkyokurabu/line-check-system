import fs from "node:fs";
import http from "node:http";
import process from "node:process";

const DEFAULT_PORT = 9222;
const DEFAULT_OUTPUT = "line_manager_contacts.csv";
const DEFAULT_LIMIT = 100;

function parseArgs(argv) {
  const args = {
    port: DEFAULT_PORT,
    output: DEFAULT_OUTPUT,
    limit: DEFAULT_LIMIT,
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
    } else if (arg === "--limit" && next) {
      args.limit = Number(next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.port) || args.port < 1) args.port = DEFAULT_PORT;
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = DEFAULT_LIMIT;
  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run export:line-manager-contacts -- [options]

Options:
  --output <path>  CSV output path. Default: ${DEFAULT_OUTPUT}
  --limit <num>    Contacts per request. Default: ${DEFAULT_LIMIT}
  --port <num>     DevTools port. Default: ${DEFAULT_PORT}

Run this while the Chrome window opened by capture:line-manager is logged in to LINE Chat.`);
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

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
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
    close() {
      socket.close();
    },
  };
}

function csvValue(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(outputPath, rows) {
  const headers = [
    "line_user_id",
    "alias_name",
    "friend",
    "chat_available",
    "chat_exists",
    "done",
    "followed_up",
    "spam",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ];
  fs.writeFileSync(outputPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function getPageClient(port) {
  const targets = await httpJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find(
    (target) =>
      target.type === "page" &&
      target.webSocketDebuggerUrl &&
      String(target.url).includes("chat.line.biz"),
  );
  if (!page) throw new Error("No chat.line.biz page target found.");
  const client = createCdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  return client;
}

function exportExpression(limit) {
  return `async () => {
    const botId = location.pathname.split('/').filter(Boolean)[0];
    if (!botId) throw new Error('Bot ID was not found in current URL.');
    const rows = [];
    let next = '';
    let guard = 0;
    do {
      const url = new URL('/api/v2/bots/' + botId + '/contacts', location.origin);
      url.searchParams.set('query', '');
      url.searchParams.set('sortKey', 'DISPLAY_NAME');
      url.searchParams.set('sortOrder', 'ASC');
      url.searchParams.set('filterKey', 'ALL');
      url.searchParams.set('limit', String(${Number(limit)}));
      if (next) url.searchParams.set('next', next);
      const response = await fetch(url.toString(), { credentials: 'include' });
      if (!response.ok) throw new Error('contacts API failed: ' + response.status);
      const data = await response.json();
      for (const item of data.list ?? []) {
        rows.push({
          line_user_id: item.profile?.userId ?? item.contactId ?? '',
          alias_name: item.profile?.name ?? '',
          friend: item.friend ?? item.profile?.friend ?? '',
          chat_available: item.chatAvailable ?? '',
          chat_exists: item.chatExists ?? '',
          done: item.done ?? '',
          followed_up: item.followedUp ?? '',
          spam: item.spam ?? '',
        });
      }
      next = data.next || '';
      guard += 1;
    } while (next && guard < 200);
    return rows;
  }`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = await getPageClient(args.port);
  const result = await client.send("Runtime.evaluate", {
    expression: `(${exportExpression(args.limit)})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  client.close();

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Failed to export contacts.");
  }
  const rows = result.result.value ?? [];
  writeCsv(args.output, rows);
  console.log(JSON.stringify({ rows: rows.length, output: args.output }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
