import fs from "node:fs";
import http from "node:http";
import process from "node:process";

function parseArgs(argv) {
  const args = { port: 9222, output: "line_chat_current_page.json", chatId: "", maxScrolls: 100, scrollOldest: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--port" && next) {
      args.port = Number(next);
      index += 1;
    } else if (arg === "--output" && next) {
      args.output = next;
      index += 1;
    } else if (arg === "--chat-id" && next) {
      args.chatId = next;
      index += 1;
    } else if (arg === "--max-scrolls" && next) {
      args.maxScrolls = Number(next);
      index += 1;
    } else if (arg === "--no-scroll") {
      args.scrollOldest = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { socket.close(); },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = await getJson(`http://127.0.0.1:${args.port}/json/list`);
  const chats = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl && String(target.url).includes("chat.line.biz"));
  if (chats.length === 0) throw new Error("No chat.line.biz page target found.");
  const results = [];
  for (const target of chats) {
    const client = connect(target.webSocketDebuggerUrl);
    await client.ready;
    if (args.chatId) {
      const accountId = new URL(target.url).pathname.split("/").filter(Boolean)[0];
      if (!accountId) throw new Error("Could not determine LINE chat account ID from the current tab.");
      await client.send("Page.enable");
      await client.send("Page.navigate", { url: `https://chat.line.biz/${accountId}/chat/${args.chatId}` });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (args.scrollOldest) {
      await client.send("Runtime.evaluate", {
        expression: `(async () => {
          let stable = 0;
          let previous = "";
          for (let index = 0; index < ${args.maxScrolls}; index += 1) {
            const scrollables = [...document.querySelectorAll("*")]
              .filter((element) => element.scrollHeight > element.clientHeight + 20);
            for (const element of scrollables) {
              element.scrollTop = 0;
              element.dispatchEvent(new Event("scroll", { bubbles: true }));
            }
            await new Promise((resolve) => setTimeout(resolve, 700));
            const marker = [document.body?.innerText?.slice(0, 1200) ?? "", document.body?.innerText?.length ?? 0,
              ...scrollables.map((element) => element.scrollHeight)].join("|");
            stable = marker === previous ? stable + 1 : 0;
            previous = marker;
            if (stable >= 4) return { iterations: index + 1, stable: true };
          }
          return { iterations: ${args.maxScrolls}, stable: false };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
    }
    const evaluated = await client.send("Runtime.evaluate", {
      expression: `(() => ({
        url: location.href,
        title: document.title,
        text: document.body ? document.body.innerText : "",
        scrollables: [...document.querySelectorAll("*")]
          .filter((element) => element.scrollHeight > element.clientHeight + 20)
          .map((element) => ({
            tag: element.tagName,
            id: element.id,
            class_name: String(element.className ?? "").slice(0, 300),
            client_height: element.clientHeight,
            scroll_height: element.scrollHeight,
            scroll_top: element.scrollTop,
            text: String(element.innerText ?? "").slice(0, 300)
          }))
      }))()`,
      returnByValue: true,
    });
    results.push(evaluated.result?.value ?? { url: target.url, title: target.title, text: "" });
    client.close();
  }
  fs.writeFileSync(args.output, `${JSON.stringify({ captured_at: new Date().toISOString(), pages: results }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: args.output, pages: results.map((row) => ({ url: row.url, title: row.title, text_length: row.text?.length ?? 0 })) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
