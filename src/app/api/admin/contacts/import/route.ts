import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportRow = {
  line_user_id: string;
  alias_name: string;
  group_name?: string;
};

const CANDIDATE_FILES = [
  "line_manager_alias_import_report.csv",
  "line_student_link_candidates.alias.csv",
];

function hasStringField(row: unknown, key: string) {
  return typeof (row as Record<string, unknown>)[key] === "string";
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

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
  if (cell || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim()));
}

function valueByHeaders(record: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function rowsFromCsv(text: string) {
  const parsed = parseCsv(text);
  const headers = parsed.shift()?.map((header) => header.trim()) ?? [];
  if (!headers.includes("line_user_id")) throw new Error("line_user_id 列があるCSVが必要です");

  return parsed.map((values, index) => {
    const record = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const lineUserId = valueByHeaders(record, ["line_user_id"]);
    const aliasName = valueByHeaders(record, ["alias_name", "登録名", "registered_name"]);
    const displayName = valueByHeaders(record, ["display_name", "stored_display_name", "profile_display_name", "LINE名"]);
    const groupName = valueByHeaders(record, ["group_name", "グループ", "group"]);
    const sourceStatus = valueByHeaders(record, ["status", "source", "match_method"]);
    return {
      id: `${lineUserId || "row"}-${index}`,
      enabled: Boolean(lineUserId && aliasName),
      line_user_id: lineUserId,
      display_name: displayName,
      alias_name: aliasName,
      group_name: groupName,
      source_status: sourceStatus,
      note: !lineUserId ? "LINE IDなし" : !aliasName ? "登録名なし" : "",
    };
  });
}

function findImportFile() {
  const candidates = CANDIDATE_FILES
    .map((file) => {
      const fullPath = path.join(/* turbopackIgnore: true */ process.cwd(), file);
      if (!fs.existsSync(fullPath)) return null;
      const stat = fs.statSync(fullPath);
      return { file, fullPath, mtime_ms: Math.trunc(stat.mtimeMs), mtime: stat.mtime.toISOString(), size: stat.size };
    })
    .filter((file): file is NonNullable<typeof file> => file !== null)
    .sort((a, b) => b.mtime_ms - a.mtime_ms);
  return candidates[0] ?? null;
}

export async function GET() {
  try {
    const selected = findImportFile();
    if (!selected) {
      return NextResponse.json({ error: "取り込み候補CSVが見つかりません" }, { status: 404 });
    }

    const csv = fs.readFileSync(selected.fullPath, "utf8");
    const rows = rowsFromCsv(csv);
    return NextResponse.json({
      ok: true,
      file: selected.file,
      size: selected.size,
      mtime: selected.mtime,
      rows,
      enabled_count: rows.filter((row) => row.enabled && row.line_user_id && row.alias_name).length,
      message: `${selected.file} を読み込みました。内容を確認して、問題なければ確定してください。`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.rows)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const rows = (body.rows as unknown[])
    .filter(
      (row): row is ImportRow =>
        hasStringField(row, "line_user_id") &&
        hasStringField(row, "alias_name") &&
        ((row as Record<string, string>).line_user_id).trim() !== "" &&
        ((row as Record<string, string>).alias_name).trim() !== "",
    )
    .map((row) => ({
      line_user_id: row.line_user_id.trim(),
      alias_name: row.alias_name.trim(),
      group_name: typeof row.group_name === "string" ? row.group_name.trim() : undefined,
    }));

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0 });
  }

  const supabase = createSupabaseAdminClient();
  const userIds = [...new Set(rows.map((row) => row.line_user_id))];
  const { data: existingRows, error: existingError } = await supabase
    .from("line_user_aliases")
    .select("line_user_id,group_name")
    .in("line_user_id", userIds);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const existingGroupByUserId = new Map(
    (existingRows ?? []).map((row) => [row.line_user_id as string, row.group_name as string | null]),
  );
  const now = new Date().toISOString();
  const { error } = await supabase.from("line_user_aliases").upsert(
    rows.map((row) => ({
      line_user_id: row.line_user_id,
      alias_name: row.alias_name,
      group_name: row.group_name !== undefined ? row.group_name || null : existingGroupByUserId.get(row.line_user_id) ?? null,
      updated_at: now,
    })),
    { onConflict: "line_user_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imported: rows.length });
}
