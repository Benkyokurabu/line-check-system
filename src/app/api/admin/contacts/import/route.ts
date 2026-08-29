import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import {
  buildAliasImportPreview,
  parseLineAliasCsv,
  planAliasImportApply,
  summarizeAliasImport,
} from "@/lib/line-alias-import.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportRow = {
  source_row?: number;
  line_user_id?: string;
  alias_name?: string;
  display_name?: string;
  group_name?: string;
  expected_existing_alias_name?: string | null;
};

type AliasRow = {
  line_user_id: string;
  alias_name: string | null;
  group_name: string | null;
};

const CANDIDATE_FILES = [
  "line_manager_alias_import_report.csv",
  "line_manager_chats.csv",
  "line_manager_contacts.csv",
  "line_student_link_candidates.alias.csv",
];
const MAX_IMPORT_ROWS = 5000;
const LOOKUP_CHUNK_SIZE = 200;

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizedRows(rows: unknown[]) {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`一度に確認できるのは${MAX_IMPORT_ROWS}件までです`);
  }
  return rows.map((source, index): ImportRow => {
    const row = source && typeof source === "object" ? source as Record<string, unknown> : {};
    return {
      source_row: typeof row.source_row === "number" ? row.source_row : index + 1,
      line_user_id: clean(row.line_user_id, 255),
      alias_name: clean(row.alias_name, 200),
      display_name: clean(row.display_name, 200),
      group_name: clean(row.group_name, 200),
      expected_existing_alias_name:
        row.expected_existing_alias_name === null
          ? null
          : typeof row.expected_existing_alias_name === "string"
            ? clean(row.expected_existing_alias_name, 200)
            : undefined,
    };
  });
}

function uniqueUserIds(rows: ImportRow[]) {
  return [...new Set(rows.map((row) => row.line_user_id ?? "").filter(Boolean))];
}

async function selectAliases(userIds: string[]) {
  const supabase = createSupabaseAdminClient();
  const aliases: AliasRow[] = [];
  for (let index = 0; index < userIds.length; index += LOOKUP_CHUNK_SIZE) {
    const ids = userIds.slice(index, index + LOOKUP_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("line_user_aliases")
      .select("line_user_id,alias_name,group_name")
      .in("line_user_id", ids);
    if (error) throw error;
    aliases.push(...((data ?? []) as AliasRow[]));
  }
  return aliases;
}

async function previewRows(rows: ImportRow[]) {
  const aliases = await selectAliases(uniqueUserIds(rows));
  const preview = buildAliasImportPreview(rows, aliases);
  return {
    rows: preview,
    summary: summarizeAliasImport(preview),
    enabled_count: preview.filter((row: { enabled: boolean }) => row.enabled).length,
  };
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

    const rows = normalizedRows(parseLineAliasCsv(fs.readFileSync(selected.fullPath, "utf8")));
    const preview = await previewRows(rows);
    return NextResponse.json({
      ok: true,
      file: selected.file,
      size: selected.size,
      mtime: selected.mtime,
      ...preview,
      message: `${selected.file} の差分を確認しました。変更内容を選んで確定してください。`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.rows)) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const rows = normalizedRows(body.rows);
    if (body.action !== "apply") {
      return NextResponse.json({ ok: true, ...(await previewRows(rows)) });
    }

    const currentRows = await selectAliases(uniqueUserIds(rows));
    const applyPlan = planAliasImportApply(rows, currentRows);

    if (applyPlan.upserts.length > 0) {
      const supabase = createSupabaseAdminClient();
      const { error } = await supabase
        .from("line_user_aliases")
        .upsert(applyPlan.upserts, { onConflict: "line_user_id" });
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      imported: applyPlan.upserts.length,
      already_applied: applyPlan.already_applied,
      skipped_stale: applyPlan.skipped_stale,
      skipped_conflict: applyPlan.skipped_conflict,
      skipped_unmatched: applyPlan.skipped_unmatched,
      message: applyPlan.skipped_stale > 0
        ? `${applyPlan.upserts.length}件を反映しました。${applyPlan.skipped_stale}件は確認後に登録名が変わったため保護しました。再度CSVを選択して確認してください。`
        : `${applyPlan.upserts.length}件を反映しました。`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
