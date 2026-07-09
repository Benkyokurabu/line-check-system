import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { findLinkedLineUserId, type LineAlias } from "@/lib/student-linking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ studentNumber: string }> },
) {
  const { studentNumber } = await context.params;
  const supabase = createSupabaseAdminClient();

  const { data: student, error: studentError } = await supabase
    .from("student_roster")
    .select("student_number,grade,student_name,homeroom_teacher")
    .eq("student_number", studentNumber)
    .maybeSingle();

  if (studentError) {
    return NextResponse.json({ error: studentError.message }, { status: 500 });
  }
  if (!student) {
    return NextResponse.json({ error: "student not found" }, { status: 404 });
  }

  const [
    { data: link, error: linkError },
    { data: aliases, error: aliasesError },
  ] = await Promise.all([
    supabase
      .from("student_line_links")
      .select("line_user_id")
      .eq("student_number", studentNumber)
      .maybeSingle(),
    supabase.from("line_user_aliases").select("line_user_id,alias_name"),
  ]);

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }
  if (aliasesError) {
    return NextResponse.json({ error: aliasesError.message }, { status: 500 });
  }

  const lineUserId =
    (link?.line_user_id as string | undefined) ??
    findLinkedLineUserId(student.student_name as string, (aliases ?? []) as LineAlias[]);

  if (!lineUserId) {
    return NextResponse.json({
      student,
      line_user_id: null,
      messages: [],
      link_status: "not_linked",
    });
  }

  const { data: messages, error: messagesError } = await supabase
    .from("line_messages")
    .select("id,direction,text,message_type,received_at,created_at,sent_by")
    .eq("line_user_id", lineUserId)
    .order("received_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(300);

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  return NextResponse.json({
    student,
    line_user_id: lineUserId,
    messages: messages ?? [],
    link_status: "linked",
  });
}
