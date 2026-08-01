import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanClassroom(value: unknown) {
  const text = cleanText(value);
  return text && /^[0-9A-Za-zＡ-Ｚａ-ｚ０-９_-]+$/.test(text) ? text.normalize("NFKC") : null;
}

function cleanExpiresAt(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanAction(value: unknown) {
  if (value === "archive" || value === "restore" || value === "update") return value;
  return "archive";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const campus = cleanText(url.searchParams.get("campus"));
  const classroom = cleanClassroom(url.searchParams.get("classroom"));
  const includeArchived = url.searchParams.get("include_archived") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "20") || 20, 1), 100);

  if (!campus || !classroom) {
    return NextResponse.json({ error: "校舎と教室を指定してください" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("classroom_messages")
    .select("id,campus,classroom,message,created_by,expires_at,archived_at,created_at,updated_at")
    .eq("campus", campus)
    .eq("classroom", classroom)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeArchived) {
    query = query.is("archived_at", null).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const campus = cleanText(body.campus);
  const classroom = cleanClassroom(body.classroom);
  const message = cleanText(body.message);
  const createdBy = cleanText(body.created_by) ?? "事務部";
  const expiresAt = cleanExpiresAt(body.expires_at);

  if (!campus || !classroom) {
    return NextResponse.json({ error: "校舎と教室を指定してください" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "メッセージを入力してください" }, { status: 400 });
  }
  if (message.length > 500) {
    return NextResponse.json({ error: "メッセージは500文字以内で入力してください" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("classroom_messages")
    .insert({ campus, classroom, message, created_by: createdBy, expires_at: expiresAt })
    .select("id,campus,classroom,message,created_by,expires_at,archived_at,created_at,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, message: data });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = cleanText(body.id);
  const action = cleanAction(body.action);
  if (!id) return NextResponse.json({ error: "メッセージIDを指定してください" }, { status: 400 });

  const updates: Record<string, string | null> = {};
  if (action === "archive") {
    updates.archived_at = new Date().toISOString();
  } else if (action === "restore") {
    updates.archived_at = null;
  } else {
    const message = cleanText(body.message);
    const createdBy = cleanText(body.created_by);
    const expiresAt = cleanExpiresAt(body.expires_at);
    if (!message) return NextResponse.json({ error: "メッセージを入力してください" }, { status: 400 });
    if (message.length > 500) return NextResponse.json({ error: "メッセージは500文字以内で入力してください" }, { status: 400 });
    updates.message = message;
    updates.created_by = createdBy ?? "事務部";
    updates.expires_at = expiresAt;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("classroom_messages")
    .update(updates)
    .eq("id", id)
    .select("id,campus,classroom,message,created_by,expires_at,archived_at,created_at,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, message: data });
}