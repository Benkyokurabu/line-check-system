import fs from "node:fs";
import http from "node:http";
import process from "node:process";

const DEFAULT_PORT = 9222;
const DEFAULT_OUTPUT = "line_manager_chat_list.csv";
const DEFAULT_STEPS = 160;

function parseArgs(argv) {
  const args = {
    port: DEFAULT_PORT,
    output: DEFAULT_OUTPUT,
    steps: DEFAULT_STEPS,
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
    } else if (arg === "--steps" && next) {
      args.steps = Number(next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.steps) || args.steps < 1) args.steps = DEFAULT_STEPS;
  if (!Number.isFinite(args.port) || args.port < 1) args.port = DEFAULT_PORT;
  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run extract:line-manager-chat-list -- [options]

Options:
  --output <path>  CSV output path. Default: ${DEFAULT_OUTPUT}
  --steps <num>    Scroll steps. Default: ${DEFAULT_STEPS}
  --port <num>     DevTools port. Default: ${DEFAULT_PORT}

Run this while the Chrome window opened by capture:line-manager is on the LINE Chat list screen.`);
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
    "source",
    "alias_name",
    "message_preview",
    "time_text",
    "type_text",
    "image_src",
    "href",
    "data_attrs",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ];
  fs.writeFileSync(outputPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function getPageClient(port) {
  const targets = await httpJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!page) throw new Error("No Chrome page target found.");
  const client = createCdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  return client;
}

const collectExpression = `(() => {
  const chatRows = Array.from(document.querySelectorAll('a.d-flex.w-100.justify-content-center'));
  const fromChat = chatRows.map((row) => {
    const alias = row.querySelector('h6')?.innerText?.trim() ?? '';
    const image = row.querySelector('img')?.src ?? '';
    const preview = row.querySelector('.text-muted.small.text-truncate')?.innerText?.trim() ?? '';
    const time = row.querySelector('.datetime')?.innerText?.trim() ?? '';
    const attrs = Array.from(row.attributes ?? [])
      .filter((attr) => attr.name.startsWith('data-') || attr.name === 'id')
      .map((attr) => attr.name + '=' + attr.value)
      .join(';');
    return { source: 'chat', alias_name: alias, image_src: image, message_preview: preview, time_text: time, type_text: '', href: row.href || '', data_attrs: attrs };
  }).filter((row) => row.alias_name);

  const contactRows = Array.from(document.querySelectorAll('tbody tr')).slice(1);
  const fromContact = contactRows.map((row) => {
    const name = row.querySelector('th span[data-emoji-width], th .user-select-text, th')?.innerText?.trim().split(/\\n/)[0] ?? '';
    const image = row.querySelector('img')?.src ?? '';
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.innerText.trim());
    const typeText = cells.find((text) => text.includes('友だち') || text.includes('グループ') || text.includes('チャットのみ')) ?? '';
    const dateText = cells.find((text) => /\\d{4}\\/\\d{1,2}\\/\\d{1,2}|^-$/u.test(text.split(/\\n/)[0] ?? '')) ?? '';
    return { source: 'contact', alias_name: name, image_src: image, message_preview: '', time_text: dateText.split(/\\n/)[0] ?? '', type_text: typeText };
  }).filter((row) => row.alias_name && row.alias_name !== '名前');

  return [...fromChat, ...fromContact];
})()`;

const scrollExpression = `(() => {
  const candidates = [document.scrollingElement, ...Array.from(document.querySelectorAll('*'))]
    .filter((el) => el && el.scrollHeight > el.clientHeight + 50)
    .sort((a, b) => b.scrollHeight - a.scrollHeight);
  let moved = 0;
  let before = 0;
  let after = 0;
  for (const target of candidates) {
    const targetBefore = target.scrollTop;
    const delta = Math.max(260, Math.min(900, target.clientHeight * 0.8));
    target.scrollTop = Math.min(target.scrollTop + delta, target.scrollHeight - target.clientHeight);
    const targetAfter = target.scrollTop;
    if (targetAfter !== targetBefore) {
      moved += 1;
      before = Math.max(before, targetBefore);
      after = Math.max(after, targetAfter);
    }
  }
  return {
    moved,
    before,
    after,
    candidates: candidates.length,
  };
})()`;

const resetScrollExpression = `(() => {
  const candidates = [document.scrollingElement, ...Array.from(document.querySelectorAll('*'))]
    .filter((el) => el && el.scrollHeight > el.clientHeight + 50);
  for (const target of candidates) target.scrollTop = 0;
  return candidates.length;
})()`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = await getPageClient(args.port);
  const rowsByKey = new Map();

  await client.send("Runtime.evaluate", {
    expression: resetScrollExpression,
    returnByValue: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 700));

  for (let step = 0; step < args.steps; step += 1) {
    const collected = await client.send("Runtime.evaluate", {
      expression: collectExpression,
      returnByValue: true,
    });
    for (const row of collected.result.value ?? []) {
      const key = `${row.alias_name}|${row.image_src}`;
      if (!rowsByKey.has(key)) rowsByKey.set(key, row);
    }

    const scrollResult = await client.send("Runtime.evaluate", {
      expression: scrollExpression,
      returnByValue: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 450));
    if (!scrollResult.result.value?.moved) {
      break;
    }
  }

  const rows = [...rowsByKey.values()];
  writeCsv(args.output, rows);
  client.close();
  console.log(JSON.stringify({ rows: rows.length, output: args.output }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
