import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requiredText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ studentNumber: string }> },
) {
  try {
    const { studentNumber: rawStudentNumber } = await context.params;
    const studentNumber = decodeURIComponent(rawStudentNumber).trim();
    const body = await request.json().catch(() => ({}));
    const lineUserId = requiredText(body.line_user_id, 255);
    const aliasName = requiredText(body.alias_name, 200);
    const performedBy = requiredText(body.performed_by, 100);

    if (!studentNumber || !lineUserId) {
      return NextResponse.json({ error: "対象の生徒LINEが指定されていません" }, { status: 400 });
    }
    if (!aliasName) {
      return NextResponse.json({ error: "新しい生徒名を200文字以内で入力してください" }, { status: 400 });
    }
    if (!performedBy) {
      return NextResponse.json({ error: "変更した先生・スタッフ名を入力してください" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const { data: account, error: accountError } = await supabase
      .from("student_line_accounts")
      .select("line_user_id,relation,friend_display_name,is_primary,evidence_message_id")
      .eq("student_number", studentNumber)
      .eq("line_user_id", lineUserId)
      .eq("relation", "student")
      .eq("verification_status", "confirmed")
      .maybeSingle();

    if (accountError) return NextResponse.json({ error: accountError.message }, { status: 500 });
    if (!account) {
      return NextResponse.json({ error: "本人確認済みの生徒LINEが見つかりません。LINE登録を確認してください" }, { status: 404 });
    }

    const { data, error } = await supabase.rpc("verify_line_contact", {
      p_line_user_id: lineUserId,
      p_targets: [{
        student_number: studentNumber,
        relation: account.relation,
        alias_name: aliasName,
        is_primary: account.is_primary,
      }],
      p_friend_display_name: account.friend_display_name,
      p_verified_by: performedBy,
      p_evidence_message_id: account.evidence_message_id,
      p_source: "students_name_edit",
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ ...(data ?? { ok: true }), alias_name: aliasName });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
