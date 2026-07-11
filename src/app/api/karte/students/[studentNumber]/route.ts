import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase";
import { findLinkedLineUserId, type LineAlias } from "@/lib/student-linking";
import { canonicalTeacherName } from "@/lib/teacher-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Student = {
  student_number: string;
  grade: string;
  student_name: string;
  homeroom_teacher: string;
  campus: string | null;
  school_name: string | null;
  gender: string | null;
  source_file: string | null;
  updated_at: string;
};

type LinkRow = { line_user_id: string };

type MessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  message_type: string;
  received_at: string | null;
  created_at: string;
  sent_by: string | null;
};

type ClassEnrollment = {
  id: string;
  grade: string;
  subject: string;
  class_name: string;
  classroom: string | null;
  source_file: string | null;
  updated_at: string;
};

type Interaction = {
  id: string;
  title: string;
  interaction_date: string | null;
  method: string | null;
  purposes: string[];
  staff_name: string | null;
  grade_at_time: string | null;
  campus: string | null;
  body: string | null;
  attachment_count: number;
};

type Survey = {
  id: string;
  source_name: string;
  subject: string | null;
  school_year: string | null;
  round_label: string | null;
  answered_at: string | null;
  link_status: string | null;
  follow_status: string | null;
  grade: string | null;
  campus: string | null;
  answers: Record<string, unknown>;
  free_text: Record<string, unknown>;
};

async function optionalSelect<T>(
  query: PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
) {
  const { data, error } = await query;
  if (error) return [] as T[];
  return data ?? [];
}

async function optionalInsert(
  query: PromiseLike<{ error: { message: string; code?: string } | null }>,
) {
  const { error } = await query;
  return !error;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ studentNumber: string }> },
) {
  const { studentNumber } = await context.params;
  const actor = new URL(request.url).searchParams.get("actor")?.trim() || null;
  const supabase = createSupabaseAdminClient();

  const { data: student, error: studentError } = await supabase
    .from("student_roster")
    .select("student_number,grade,student_name,homeroom_teacher,campus,school_name,gender,source_file,updated_at")
    .eq("student_number", studentNumber)
    .maybeSingle();

  if (studentError) return NextResponse.json({ error: studentError.message }, { status: 500 });
  if (!student) return NextResponse.json({ error: "student not found" }, { status: 404 });

  const [
    { data: explicitLink },
    { data: aliases },
    classes,
    interactions,
    surveys,
  ] = await Promise.all([
    supabase.from("student_line_links").select("line_user_id").eq("student_number", studentNumber).maybeSingle(),
    supabase.from("line_user_aliases").select("line_user_id,alias_name"),
    optionalSelect<ClassEnrollment>(
      supabase
        .from("student_class_enrollments")
        .select("id,grade,subject,class_name,classroom,source_file,updated_at")
        .eq("student_number", studentNumber)
        .order("subject", { ascending: true }),
    ),
    optionalSelect<Interaction>(
      supabase
        .from("student_interactions")
        .select("id,title,interaction_date,method,purposes,staff_name,grade_at_time,campus,body,attachment_count")
        .eq("student_number", studentNumber)
        .order("interaction_date", { ascending: false, nullsFirst: false })
        .limit(50),
    ),
    optionalSelect<Survey>(
      supabase
        .from("survey_responses")
        .select("id,source_name,subject,school_year,round_label,answered_at,link_status,follow_status,grade,campus,answers,free_text")
        .eq("student_number", studentNumber)
        .eq("visible_in_karte", true)
        .order("answered_at", { ascending: false, nullsFirst: false })
        .limit(50),
    ),
  ]);

  const typedStudent = student as Student;
  const lineUserId =
    ((explicitLink as LinkRow | null)?.line_user_id) ??
    findLinkedLineUserId(typedStudent.student_name, (aliases ?? []) as LineAlias[]);

  const messages = lineUserId
    ? await optionalSelect<MessageRow>(
        supabase
          .from("line_messages")
          .select("id,direction,text,message_type,received_at,created_at,sent_by")
          .eq("line_user_id", lineUserId)
          .order("received_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(80),
      )
    : [];

  await optionalInsert(
    supabase.from("audit_logs").insert({
      actor,
      action: "karte_view",
      subject_type: "student",
      subject_id: studentNumber,
      student_number: studentNumber,
      metadata: { line_linked: Boolean(lineUserId), line_message_count: messages.length },
    }),
  );

  const timeline = [
    ...messages.map((message) => ({
      id: "line:" + message.id,
      kind: "line",
      occurred_at: message.received_at ?? message.created_at,
      title: message.direction === "inbound" ? "LINE受信" : "LINE送信",
      summary: message.text ?? "(" + message.message_type + ")",
      meta: message.sent_by,
    })),
    ...interactions.map((interaction) => ({
      id: "interaction:" + interaction.id,
      kind: "interaction",
      occurred_at: interaction.interaction_date,
      title: interaction.title,
      summary: [interaction.method, ...interaction.purposes].filter(Boolean).join(" / "),
      meta: interaction.staff_name,
    })),
    ...surveys.map((survey) => ({
      id: "survey:" + survey.id,
      kind: "survey",
      occurred_at: survey.answered_at,
      title: survey.source_name,
      summary: [survey.subject, survey.school_year, survey.round_label, survey.follow_status].filter(Boolean).join(" / "),
      meta: survey.link_status,
    })),
  ].sort((a, b) => new Date(b.occurred_at ?? 0).getTime() - new Date(a.occurred_at ?? 0).getTime());

  return NextResponse.json({
    student: { ...typedStudent, homeroom_teacher: canonicalTeacherName(typedStudent.homeroom_teacher) },
    line_user_id: lineUserId,
    classes,
    messages,
    interactions,
    surveys,
    timeline,
    notes: {
      change_friendly_design:
        "Notion項目マッピング、表示ブロック、名寄せ条件を後から変更しやすい前提で構成しています。",
    },
  });
}
