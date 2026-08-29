const LINE_USER_ID_HEADERS = ["line_user_id", "line id", "line_userid"];
const ALIAS_NAME_HEADERS = ["alias_name", "登録名", "registered_name", "ユーザーネーム"];
const DISPLAY_NAME_HEADERS = [
  "friend_display_name",
  "profile_display_name",
  "stored_display_name",
  "display_name",
  "line名",
];
const GROUP_NAME_HEADERS = ["group_name", "グループ", "group"];

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function valueByHeaders(record, names) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (quoted) throw new Error("CSVの引用符が閉じられていません");
  if (cell || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim()));
}

export function parseLineAliasCsv(text) {
  const parsed = parseCsv(text);
  const rawHeaders = parsed.shift() ?? [];
  const headers = rawHeaders.map((header) => header.trim().toLowerCase());
  if (!headers.some((header) => LINE_USER_ID_HEADERS.includes(header))) {
    throw new Error("line_user_id 列があるCSVを選択してください");
  }

  return parsed.map((values, index) => {
    const record = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    return {
      source_row: index + 2,
      line_user_id: valueByHeaders(record, LINE_USER_ID_HEADERS),
      alias_name: valueByHeaders(record, ALIAS_NAME_HEADERS),
      display_name: valueByHeaders(record, DISPLAY_NAME_HEADERS),
      group_name: valueByHeaders(record, GROUP_NAME_HEADERS),
    };
  });
}

export function buildAliasImportPreview(importRows, existingRows = []) {
  const existingById = new Map(
    existingRows.map((row) => [clean(row.line_user_id), {
      alias_name: clean(row.alias_name),
      group_name: clean(row.group_name),
    }]),
  );
  const invalidRows = [];
  const grouped = new Map();

  for (let index = 0; index < importRows.length; index += 1) {
    const source = importRows[index] ?? {};
    const lineUserId = clean(source.line_user_id);
    const aliasName = clean(source.alias_name);
    const row = {
      source_row: Number(source.source_row) || index + 1,
      line_user_id: lineUserId,
      alias_name: aliasName,
      display_name: clean(source.display_name),
      group_name: clean(source.group_name),
    };
    if (!lineUserId || !aliasName) {
      invalidRows.push({
        ...row,
        id: `unmatched-${row.source_row}-${index}`,
        status: "unmatched",
        enabled: false,
        can_apply: false,
        existing_alias_name: null,
        expected_existing_alias_name: null,
        note: !lineUserId ? "LINE IDがありません" : "登録名がありません",
      });
      continue;
    }
    const rows = grouped.get(lineUserId) ?? [];
    rows.push(row);
    grouped.set(lineUserId, rows);
  }

  const previewRows = [];
  for (const [lineUserId, rows] of grouped) {
    const aliases = [...new Set(rows.map((row) => row.alias_name))];
    const first = rows[0];
    const displayName = rows.find((row) => row.display_name)?.display_name ?? "";
    const groupName = rows.find((row) => row.group_name)?.group_name ?? "";
    const existing = existingById.get(lineUserId);
    const existingAlias = existing?.alias_name || null;

    if (aliases.length > 1) {
      previewRows.push({
        ...first,
        id: lineUserId,
        alias_name: aliases.join(" / "),
        display_name: displayName,
        group_name: groupName,
        status: "conflict",
        enabled: false,
        can_apply: false,
        existing_alias_name: existingAlias,
        expected_existing_alias_name: existingAlias,
        note: `同じLINE IDに異なる登録名が${aliases.length}件あります`,
      });
      continue;
    }

    let status = "insert";
    if (existingAlias === first.alias_name) status = "same_existing";
    else if (existingAlias) status = "different_existing";
    previewRows.push({
      ...first,
      id: lineUserId,
      display_name: displayName,
      group_name: groupName || existing?.group_name || "",
      status,
      enabled: status === "insert",
      can_apply: status === "insert" || status === "different_existing",
      existing_alias_name: existingAlias,
      expected_existing_alias_name: existingAlias,
      note: rows.length > 1 ? `同一内容の${rows.length}行を1件にまとめました` : "",
    });
  }

  return [...previewRows, ...invalidRows].sort((a, b) => a.source_row - b.source_row);
}

export function summarizeAliasImport(rows) {
  return rows.reduce((summary, row) => {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    return summary;
  }, {});
}

export function planAliasImportApply(requestRows, currentRows, now = new Date().toISOString()) {
  const requestCheck = buildAliasImportPreview(requestRows, []);
  const conflictingIds = new Set(
    requestCheck.filter((row) => row.status === "conflict").map((row) => row.line_user_id),
  );
  const currentById = new Map(currentRows.map((row) => [clean(row.line_user_id), row]));
  const deduplicated = new Map();
  let skippedUnmatched = 0;

  for (const row of requestRows) {
    const lineUserId = clean(row?.line_user_id);
    const aliasName = clean(row?.alias_name);
    if (!lineUserId || !aliasName) {
      skippedUnmatched += 1;
      continue;
    }
    if (conflictingIds.has(lineUserId) || deduplicated.has(lineUserId)) continue;
    deduplicated.set(lineUserId, { ...row, line_user_id: lineUserId, alias_name: aliasName });
  }

  const upserts = [];
  let alreadyApplied = 0;
  let skippedStale = 0;
  for (const row of deduplicated.values()) {
    const current = currentById.get(row.line_user_id);
    const currentAlias = clean(current?.alias_name) || null;
    if (currentAlias === row.alias_name) {
      alreadyApplied += 1;
      continue;
    }
    const expected = row.expected_existing_alias_name === null
      ? null
      : typeof row.expected_existing_alias_name === "string"
        ? clean(row.expected_existing_alias_name) || null
        : undefined;
    if (expected === undefined || expected !== currentAlias) {
      skippedStale += 1;
      continue;
    }
    upserts.push({
      line_user_id: row.line_user_id,
      alias_name: row.alias_name,
      group_name: clean(row.group_name) || clean(current?.group_name) || null,
      updated_at: now,
    });
  }

  return {
    upserts,
    already_applied: alreadyApplied,
    skipped_stale: skippedStale,
    skipped_conflict: conflictingIds.size,
    skipped_unmatched: skippedUnmatched,
  };
}
