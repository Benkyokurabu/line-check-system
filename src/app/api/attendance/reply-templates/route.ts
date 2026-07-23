import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const SETTING_KEY = "attendance_reply_templates";
const DEFAULT_TEMPLATES = [
  "ご連絡ありがとうございます。承知しました。本日の授業は欠席として登録いたします。",
  "ご連絡ありがとうございます。お大事になさってください。本日の授業は欠席として登録いたします。",
  "承知しました。振替が必要な場合はこちらで確認いたします。",
];

function normalizeTemplates(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_TEMPLATES;
  const templates = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean)
    .slice(0, 3);
  return templates.length === 3 ? templates : DEFAULT_TEMPLATES;
}

function parseTemplates(value: unknown) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const templates = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (templates.some((template) => !template || template.length > 500)) return null;
  return templates;
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: normalizeTemplates(data?.value) });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const templates = parseTemplates(body.templates);
  if (!templates) {
    return NextResponse.json({ error: "文案は3件、各500文字以内で入力してください" }, { status: 400 });
  }
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("app_settings").upsert({
    key: SETTING_KEY,
    value: templates,
    description: "欠席確認画面のLINE返信文案",
  }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates });
}