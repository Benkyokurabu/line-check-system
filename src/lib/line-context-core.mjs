import { createHash } from "node:crypto";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scalar = (value) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const key = (value) => String(value).replace(/^\uFEFF/, "").normalize("NFKC").toLowerCase().replace(/[\s_\-：:]/g, "");
const get = (row, names) => {
  const accepted = names.map(key);
  for (const name of accepted) {
    const value = Object.entries(row).find(([field, value]) => key(field) === name && ["string", "number"].includes(typeof value))?.[1];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
};

export function lineDirection(value) {
  const text = key(value ?? "");
  if (["inbound", "incoming", "received", "receive", "受信", "受信メッセージ", "友だち", "user"].includes(text)) return "inbound";
  if (["outbound", "outgoing", "sent", "send", "送信", "送信メッセージ", "bot", "公式アカウント"].includes(text)) return "outbound";
  return "unknown";
}

// No date-only, relative time, Excel serial or machine-local timezone guesses.
export function lineTimestamp(value, timezone = "+09:00") {
  if (typeof value === "number" && Number.isFinite(value) && value > 1e9) {
    const date = new Date(value < 1e11 ? value * 1000 : value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const text = scalar(value).normalize("NFKC");
  if (/^\d{10}(\d{3})?$/.test(text)) return lineTimestamp(Number(text), timezone);
  const cleaned = text.replace(/年|月|\//g, "-").replace(/日/g, "").replace(/\s+/, "T");
  if (!/^\d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(cleaned)) return null;
  const normalized = cleaned.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):/, (_, y, m, d, h) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:`);
  const zoned = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}${timezone}`;
  const date = new Date(zoned);
  if (!Number.isFinite(date.getTime())) return null;
  const day = Number(normalized.slice(8, 10));
  const month = Number(normalized.slice(5, 7));
  const year = Number(normalized.slice(0, 4));
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return date.toISOString();
}

export function parseLineCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (quoted || cell === "") quoted = !quoted;
      else cell += char;
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(cell); cell = "";
      if (char !== ",") { rows.push(row); row = []; if (char === "\r" && input[i + 1] === "\n") i += 1; }
    } else cell += char;
  }
  if (quoted) throw new Error("Incomplete quoted CSV field");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() ?? [];
  if (new Set(header.map(key)).size !== header.length) throw new Error("Duplicate CSV headers");
  return rows.filter((cells) => cells.some(Boolean)).map((cells) => {
    if (cells.length > header.length) throw new Error("CSV row has more fields than header");
    return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""]));
  });
}

export function normalizeLineRow(row, options) {
  const { account, sourceRef, rowNumber, fileHash, channel = "manager_export", timezone } = options;
  if (!account) throw new Error("An explicit account namespace is required");
  const originalContent = get(row, ["content", "text", "message", "本文", "メッセージ", "メッセージ内容", "内容"]);
  const content = typeof originalContent === "string" ? originalContent : scalar(originalContent);
  if (!content.trim()) return null;
  const nativeId = scalar(get(row, ["nativeId", "line_message_id", "message_id", "messageId", "id"])) || null;
  const direction = lineDirection(get(row, ["direction", "方向", "送受信", "送受信区分", "種別"]));
  const userId = scalar(get(row, ["line_user_id", "userId", "chatId", "ユーザーID"])) || null;
  const occurredAt = lineTimestamp(get(row, ["occurredAt", "received_at", "sent_at", "timestamp", "日時", "送信日時", "受信日時"]), timezone);
  const actor = scalar(get(row, ["actor", "sent_by", "sender", "送信者", "担当者"])) || null;
  const messageKey = nativeId ? [account, "id", nativeId] : occurredAt && userId ? [account, userId, direction, occurredAt, actor, content] : [account, "unresolved", fileHash, rowNumber];
  return {
    sourceKey: `line_manager:${digest(messageKey)}`, sourceType: "line", nativeId, account,
    direction, actor, occurredAt, content, lineUserId: userId,
    sourceRef: `${sourceRef}#row=${rowNumber}`, identityStatus: userId ? "line_id_only" : "unresolved", association: [],
    coverage: { scope: "message_history", channel, complete: false, outboundCoverage: channel === "webhook" ? "unavailable" : "partial", noReplyAssessment: "unknown" },
    verification: { direction: direction === "unknown" ? "unresolved" : "explicit", timestamp: occurredAt ? "parsed" : "unresolved", actor: actor ? "source_declared" : "unknown", recipient: userId ? "source_line_id" : "unresolved" },
  };
}

export function parseLineContext(text, options) {
  const fileHash = digest(text); const records = []; const warnings = []; const coverage = [];
  const base = { ...options, fileHash };
  const addRows = (rows, channel = "manager_export", sourceRef = options.sourceRef) => {
    const summaries = rows.some((row) => Object.keys(row).some((name) => ["latesttext", "messagepreview", "lastreceivedat"].includes(key(name))));
    if (summaries) {
      coverage.push({ sourceRef, account: options.account, scope: "chat_list", channel, complete: false, rows: rows.length, outboundCoverage: "unknown", noReplyAssessment: "unknown" });
      warnings.push("CHAT_LIST_IS_NOT_MESSAGE_HISTORY"); return;
    }
    rows.forEach((row, index) => { const record = normalizeLineRow(row, { ...base, sourceRef, channel, rowNumber: index + 1 }); if (record) records.push(record); });
    coverage.push({ sourceRef, account: options.account, scope: "message_history", channel, complete: false, rows: rows.length, outboundCoverage: channel === "webhook" ? "unavailable" : "partial", noReplyAssessment: "unknown" });
  };
  if (options.format === "csv") addRows(parseLineCsv(text));
  else {
    let documents;
    if (options.format === "jsonl") documents = text.split(/\r?\n/).filter(Boolean).map((line, index) => { try { return JSON.parse(line); } catch { warnings.push(`INVALID_JSON_LINE_${index + 1}`); return null; } }).filter(Boolean);
    else { const parsed = JSON.parse(text); documents = Array.isArray(parsed) ? parsed : [parsed]; }
    const direct = [];
    documents.forEach((document, index) => {
      if (document.type === "network_response") {
        // Ignore HTML/visible page text and chat-list latestEvent previews.
        if (document.status && (Number(document.status) < 200 || Number(document.status) >= 300)) return;
        let body; try { body = typeof document.body === "string" ? JSON.parse(document.body) : document.body; } catch { return; }
        const endpoint = (() => { try { return new URL(document.url).pathname; } catch { return ""; } })();
        if (/\/chats\/?$/.test(endpoint)) { coverage.push({ sourceRef: `${options.sourceRef}#capture=${index + 1}`, account: options.account, scope: "chat_list", channel: "manager_capture", complete: false, rows: body?.list?.length ?? 0, outboundCoverage: "unknown", noReplyAssessment: "unknown" }); return; }
        if (!/\/(messages|events)(\/|$)/.test(endpoint)) return;
        const rows = Array.isArray(body) ? body : body?.messages ?? body?.events ?? body?.list;
        if (!Array.isArray(rows)) return;
        const chatId = endpoint.match(/\/chats\/([^/]+)\//)?.[1];
        addRows(rows.map((event) => ({ ...event, text: event.message?.text ?? event.text, messageId: event.message?.id ?? event.messageId ?? event.id, userId: event.line_user_id ?? event.userId ?? chatId, direction: event.direction, timestamp: event.timestamp ?? event.createdAt ?? event.sentAt, sender: typeof event.sender === "string" ? event.sender : event.sender?.displayName })), "manager_capture", `${options.sourceRef}#capture=${index + 1}`);
      } else if (!["capture_start", "capture_end", "capture_resume", "page_text"].includes(document.type)) direct.push(document);
    });
    if (direct.length) addRows(direct, options.channel ?? "manager_export");
  }
  return { version: 1, records: [...new Map(records.map((record) => [record.sourceKey, record])).values()], coverage, warnings: [...new Set(warnings)] };
}

export function mergeLineContext(previous, incoming) {
  const records = new Map((previous?.records ?? []).map((record) => [record.sourceKey, record]));
  let added = 0;
  for (const record of incoming.records) { if (!records.has(record.sourceKey)) { records.set(record.sourceKey, record); added += 1; } }
  const coverages = new Map((previous?.coverage ?? []).map((item) => [digest(item), item]));
  for (const item of incoming.coverage) coverages.set(digest(item), item);
  return { version: 1, records: [...records.values()], coverage: [...coverages.values()], warnings: [...new Set([...(previous?.warnings ?? []), ...incoming.warnings])], added };
}
