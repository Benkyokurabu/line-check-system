"use client";

// Notion registration settings are supplied by the Vercel production environment.

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { isAttendanceCrossCampus, normalizeCampus, studentCampusIncludesLesson } from "@/lib/attendance-campus-consistency.mjs";
import {
  actionCandidatesForReview,
  candidateHasError,
  doneCandidatesForReview,
  visibleCandidateCountAfterReload,
  visibleCandidatesForReview,
} from "@/lib/attendance-review-logic.mjs";

type Student = { student_number: string; student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null };
type Lesson = { id: string; label: string; start_time: string | null; campus: string | null; grade?: string | null; subject?: string | null; class_name?: string | null; classroom?: string | null; enrolled?: boolean; enrollment_campus?: string | null };
type StudentSuggestion = Student & { score: number; reason: string };
type SenderProfile = { display_name: string | null; alias_names: string[]; account_names: string[]; tag_names?: string[] };
type ReplyMessage = { id: string; text: string | null; received_at: string | null; sent_by: string | null };
type CandidateItem = {
  id: string; student_number: string | null; event_type: string; event_date: string | null; lesson_id: string | null;
  suggested_subject: string | null; suggested_class_name: string | null; ai_summary: string | null;
  arrival_expected_time: string | null; note_internal: string | null; note_for_classroom: string | null;
  cross_campus_override: boolean | null; cross_campus_reason: string | null;
  status: string; notion_error: string | null; lessons: Lesson | null;
};
type Candidate = {
  id: string; student_number: string | null; suggested_student_name: string | null;
  event_type: string; event_date: string | null; lesson_id: string | null;
  suggested_subject: string | null; suggested_class_name: string | null;
  ai_summary: string | null; ai_confidence: number | null; ai_reason: string | null;
  status: string; notion_error: string | null;
  reply_status?: { sent: boolean; count: number; last_sent_at: string | null; last_sent_by: string | null };
  reply_messages?: ReplyMessage[];
  attendance_candidate_items?: CandidateItem[];
  sender_profile?: SenderProfile;
  student_suggestions?: StudentSuggestion[];
  student_selection_required?: boolean;
  student_selection_reason?: string | null;
  student_roster: { student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null } | null;
  lessons: Lesson | null; line_messages: { text: string | null; received_at: string | null; display_name: string | null; line_user_id?: string | null } | null;
};
type EditableItem = {
  client_id: string; id?: string; student_number: string; event_type: string; event_date: string; campus: string; lesson_id: string;
  suggested_subject: string | null; suggested_class_name: string | null; ai_summary: string;
  arrival_expected_time: string; note_internal: string; note_for_classroom: string; status?: string;
  cross_campus_override: boolean; cross_campus_reason: string;
};
type ManualEvent = {
  id: string; contact_method: string; contact_received_at: string | null; received_by: string | null;
  student_number: string; lesson_id: string; event_date: string; event_type: string; reason: string | null;
  arrival_expected_time: string | null; note_internal: string | null; note_for_classroom: string | null;
  cross_campus_override: boolean | null; cross_campus_reason: string | null;
  status: string; confirmed_by: string | null; confirmed_at: string | null; cancelled_by: string | null; cancelled_at: string | null;
  notion_page_id: string | null; notion_status: string; notion_error: string | null;
  student_roster: { student_name: string; grade: string; campus: string | null; homeroom_teacher: string | null } | null;
  lessons: Lesson | null;
};
type HistoryDays = 3 | 5 | 7 | 14;
type ReviewTab = "action" | "done" | "all";
type AnalysisStatus = {
  queued: number;
  ready: number;
  processing: number;
  retry_wait: number;
  dead: number;
  oldest_queued_at: string | null;
  processed_last_hour: number;
  last_worker_succeeded_at: string | null;
  last_worker_error: string | null;
  alert_active: boolean;
  last_checked_at: string | null;
};
type LineLinkSuggestion = Student & { score: number; reason: string; proposed_alias_name: string };
type LineLinkCandidate = {
  line_user_id: string;
  line_user_id_short: string;
  display_name: string | null;
  latest_received_at: string | null;
  candidate_count: number;
  suggested_names: string[];
  latest_text: string | null;
  identity_evidence: {
    manager_alias_name: string | null;
    evidence_text: string;
    evidence_at: string | null;
    parsed_student_name: string | null;
    relation: string;
    source: string;
    review_status: "pending" | "confirmed" | "rejected";
    reviewed_at: string | null;
    detected_message_id: string | null;
    verified_at: string | null;
  } | null;
  suggestions: LineLinkSuggestion[];
  default_student_number: string;
  default_relation: string;
};

const pageTitle = "遅刻・欠席確認";

const defaultReplyTemplates = [
  "ご連絡ありがとうございます。承知しました。本日の授業連絡として登録いたします。",
  "ご連絡ありがとうございます。承知しました。担当にも共有いたします。",
  "承知しました。必要があればこちらで確認いたします。",
];

const reasonOptions = ["体調不良", "発熱", "学校行事", "通院", "家庭都合", "部活動", "交通事情", "電車遅延", "欠席連絡", "遅刻連絡", "早退連絡", "その他"];
const eventTypeOptions = [
  { value: "absence", label: "欠席" },
  { value: "late", label: "遅刻" },
  { value: "early_leave", label: "早退" },
];
function eventTypeLabel(value: string) { return eventTypeOptions.find((option) => option.value === value)?.label ?? "その他"; }
function fallbackReason(value: string) { return value === "late" ? "遅刻連絡" : value === "early_leave" ? "早退連絡" : "欠席連絡"; }

const buttonStyle = { border: 0, borderRadius: 6, padding: "10px 14px", background: "var(--accent)", color: "white", fontWeight: 700, cursor: "pointer" } as const;
const secondaryButtonStyle = { ...buttonStyle, background: "#555" } as const;
const dangerButtonStyle = { ...buttonStyle, background: "#b42318" } as const;
const ghostButtonStyle = { border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", background: "white", color: "#222", fontWeight: 700, cursor: "pointer" } as const;
const inputStyle = { width: "100%", height: 40, boxSizing: "border-box", padding: "9px", border: "1px solid var(--line)", borderRadius: 6, background: "white" } as const;
const readonlyStyle = { ...inputStyle, minHeight: 40, background: "#f7f7f4", display: "flex", alignItems: "center" } as const;
const fieldStyle = { display: "grid", gap: 6, alignContent: "start" } as const;
const tagStyle = { display: "inline-flex", alignItems: "center", border: "1px solid #b7d7c2", background: "#f2fbf5", borderRadius: 6, padding: "3px 7px", color: "#087a3d", fontSize: 12, fontWeight: 700 } as const;

function campusFromLineManagedName(value: string | null | undefined) {
  const normalized = (value ?? "").normalize("NFKC");
  const prefix = normalized.match(/^([本南])\s/);
  if (prefix?.[1] === "本") return "本校";
  if (prefix?.[1] === "南") return "南教室";
  return "";
}

function selectableCampus(value: string | null | undefined) {
  const campus = normalizeCampus(value);
  return campus === "本校" || campus === "南教室" ? campus : "";
}

function studentMatchesCampus(student: Student, campus: string) {
  return studentCampusIncludesLesson(student.campus, campus);
}

function lessonIsCrossCampus(student: Student | null | undefined, lesson: Lesson | null | undefined, fallbackCampus = "") {
  if (!student) return false;
  return isAttendanceCrossCampus({
    studentCampus: student.campus,
    lessonCampus: lesson?.campus ?? fallbackCampus,
    enrollmentCampus: lesson?.enrollment_campus,
  });
}

function uniqueByNumber(students: Student[]) {
  const seen = new Set<string>();
  return students.filter((student) => {
    if (seen.has(student.student_number)) return false;
    seen.add(student.student_number);
    return true;
  });
}

function formatReceivedAt(value: string | null | undefined) {
  if (!value) return "受信日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "受信日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatStatusTime(value: string | null | undefined) {
  if (!value) return "";
  const formatted = formatReceivedAt(value);
  return formatted === "受信日時不明" ? "" : formatted;
}

function statusBadgeStyle(kind: "done" | "pending" | "failed" | "partial") {
  if (kind === "done") return { border: "1px solid #b7d7c2", background: "#f2fbf5", color: "#087a3d" } as const;
  if (kind === "failed") return { border: "1px solid #fecaca", background: "#fef2f2", color: "#b42318" } as const;
  if (kind === "partial") return { border: "1px solid #fed7aa", background: "#fff7ed", color: "#c2410c" } as const;
  return { border: "1px solid var(--line)", background: "#f7f7f4", color: "#59635e" } as const;
}

function StatusBadge({ label, detail, kind }: { label: string; detail: string; kind: "done" | "pending" | "failed" | "partial" }) {
  return <span style={{ ...statusBadgeStyle(kind), display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "5px 9px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
    <span>{label}</span><span style={{ opacity: 0.82 }}>{detail}</span>
  </span>;
}

function normalizeLessonText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

function lessonsByTime(lessons: Lesson[]) {
  return lessons.reduce<Array<{ time: string; lessons: Lesson[] }>>((groups, lesson) => {
    const time = lesson.start_time ?? "時刻なし";
    const current = groups.find((group) => group.time === time);
    if (current) current.lessons.push(lesson);
    else groups.push({ time, lessons: [lesson] });
    return groups;
  }, []);
}

function makeClientId() {
  return Math.random().toString(36).slice(2);
}

function initialItems(candidate: Candidate, initialCampus: string, fallbackStudentNumber: string) {
  const source = (candidate.attendance_candidate_items ?? []).length > 0 ? candidate.attendance_candidate_items! : [{
    id: "", student_number: candidate.student_number, event_type: candidate.event_type, event_date: candidate.event_date, lesson_id: candidate.lesson_id,
    suggested_subject: candidate.suggested_subject, suggested_class_name: candidate.suggested_class_name,
    ai_summary: candidate.ai_summary, arrival_expected_time: null, note_internal: null, note_for_classroom: null, cross_campus_override: false, cross_campus_reason: null, status: candidate.status, notion_error: candidate.notion_error, lessons: candidate.lessons,
  }];
  return source.map((item) => ({
    client_id: item.id || makeClientId(),
    id: item.id || undefined,
    student_number: item.student_number ?? candidate.student_number ?? fallbackStudentNumber,
    event_type: item.event_type || candidate.event_type || "absence",
    event_date: item.event_date ?? "",
    campus: item.lessons?.campus ?? initialCampus,
    lesson_id: item.lesson_id ?? "",
    suggested_subject: item.suggested_subject,
    suggested_class_name: item.suggested_class_name,
    ai_summary: item.ai_summary ?? fallbackReason(item.event_type || candidate.event_type),
    arrival_expected_time: item.arrival_expected_time ?? "",
    note_internal: item.note_internal ?? "",
    note_for_classroom: item.note_for_classroom ?? "",
    cross_campus_override: item.cross_campus_override === true,
    cross_campus_reason: item.cross_campus_reason ?? "",
    status: item.status,
  }));
}

function candidateLesson(candidate: Candidate, item: EditableItem) {
  const itemLesson = candidate.attendance_candidate_items?.find((source) => source.id === item.id)?.lessons;
  if (itemLesson) return itemLesson;
  if (candidate.lesson_id === item.lesson_id) return candidate.lessons;
  return null;
}

export default function AttendancePage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [replyTemplates, setReplyTemplates] = useState(defaultReplyTemplates);
  const [confirmedBy, setConfirmedBy] = useState("");
  const [historyDays, setHistoryDays] = useState<HistoryDays>(7);
  const [reviewTab, setReviewTab] = useState<ReviewTab>("action");
  const [includePastPending, setIncludePastPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [message, setMessage] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEventsOpen, setManualEventsOpen] = useState(false);
  const [manualRefreshKey, setManualRefreshKey] = useState(0);
  const [visibleCandidateCount, setVisibleCandidateCount] = useState(20);
  const [linkReviewOpen, setLinkReviewOpen] = useState(false);
  const [linkCandidates, setLinkCandidates] = useState<LineLinkCandidate[]>([]);
  const [linkCandidatesLoading, setLinkCandidatesLoading] = useState(false);
  useEffect(() => {
    document.title = pageTitle;
  }, []);
  const load = useCallback(async (keepVisibleCandidateId?: string, keepVisibleTab: ReviewTab = "action") => {
    const params = new URLSearchParams({ status: "review", days: String(historyDays) });
    if (includePastPending) params.set("include_past", "1");
    const response = await fetch(`/api/attendance/candidates?${params.toString()}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "候補を取得できませんでした");
    const nextCandidates = (body.candidates ?? []) as Candidate[];
    setCandidates(nextCandidates);
    setVisibleCandidateCount((currentCount) => visibleCandidateCountAfterReload({
      candidates: nextCandidates,
      reviewTab: keepVisibleTab,
      keepVisibleCandidateId,
      currentCount,
    }));
    if (keepVisibleCandidateId) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        document.getElementById(`attendance-candidate-${keepVisibleCandidateId}`)?.scrollIntoView({ block: "nearest" });
      }));
    }
  }, [historyDays, includePastPending]);
  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/attendance/status");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "解析状態を取得できませんでした");
    setAnalysisStatus({
      queued: Number(body.queued ?? 0),
      ready: Number(body.ready ?? 0),
      processing: Number(body.processing ?? 0),
      retry_wait: Number(body.retry_wait ?? 0),
      dead: Number(body.dead ?? body.failed ?? 0),
      oldest_queued_at: body.oldest_queued_at ?? null,
      processed_last_hour: Number(body.processed_last_hour ?? 0),
      last_worker_succeeded_at: body.last_worker_succeeded_at ?? null,
      last_worker_error: body.last_worker_error ?? null,
      alert_active: Boolean(body.alert_active),
      last_checked_at: body.last_checked_at ?? null,
    });
  }, []);
  useEffect(() => {
    async function initialize() {
      try {
        const [, , studentResponse, templateResponse] = await Promise.all([
          load(),
          loadStatus(),
          fetch("/api/attendance/students"),
          fetch("/api/attendance/reply-templates"),
        ]);
        const [studentBody, templateBody] = await Promise.all([studentResponse.json(), templateResponse.json()]);
        if (!studentResponse.ok) throw new Error(studentBody.error ?? "生徒一覧を取得できませんでした");
        if (!templateResponse.ok) throw new Error(templateBody.error ?? "LINE返信文案を取得できませんでした");
        setStudents(studentBody.students ?? []);
        setReplyTemplates(templateBody.templates ?? defaultReplyTemplates);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
    void initialize();
  }, [load, loadStatus]);

  async function updateReplyTemplates(nextTemplates: string[]) {
    const response = await fetch("/api/attendance/reply-templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templates: nextTemplates }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "文案の保存に失敗しました");
    setReplyTemplates(body.templates ?? nextTemplates);
  }

  async function refreshLatest() {
    setStatusBusy(true); setMessage("最新状態を確認しています...");
    try {
      await Promise.all([load(), loadStatus()]);
      setMessage("最新状態に更新しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setStatusBusy(false); }
  }

  async function analyze() {
    setBusy(true); setMessage("待機中のLINE解析ジョブを処理しています...");
    try {
      const response = await fetch("/api/attendance/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 10 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "解析に失敗しました");
      setMessage(`${body.processed}件を解析し、連絡候補${body.candidates}件を追加しました。対象外${body.ignored}件、再試行${body.retrying ?? 0}件、要確認${body.dead ?? 0}件です。`);
      await Promise.all([load(), loadStatus()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const loadLineLinkCandidates = useCallback(async () => {
    setLinkCandidatesLoading(true);
    try {
      const response = await fetch("/api/attendance/line-link-candidates");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "LINE登録候補を取得できませんでした");
      setLinkCandidates(body.candidates ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLinkCandidatesLoading(false);
    }
  }, []);

  async function toggleLineLinkReview() {
    const nextOpen = !linkReviewOpen;
    setLinkReviewOpen(nextOpen);
    if (nextOpen) await loadLineLinkCandidates();
  }
  const actionCandidates = useMemo(() => actionCandidatesForReview(candidates) as Candidate[], [candidates]);
  const doneCandidates = useMemo(() => doneCandidatesForReview(candidates) as Candidate[], [candidates]);
  const visibleCandidates = useMemo(() => visibleCandidatesForReview(candidates, reviewTab) as Candidate[], [candidates, reviewTab]);
  const errorCount = actionCandidates.filter(candidateHasError).length;
  return <main className="shell" style={{ maxWidth: 1180 }}>
    <p className="eyebrow">Attendance review</p>
    <h1>遅刻・欠席連絡の確認</h1>
    <p>LINEの確認作業に近い流れで、返信文案とNotion登録内容を確認できます。</p>
    <section className="panel" style={{ padding: 16, marginTop: 20, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ display: "grid", gap: 6, minWidth: 220 }}><span>確認者名</span><input style={inputStyle} value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)} placeholder="例：吉川" /></label>
      <button style={buttonStyle} disabled={statusBusy} onClick={refreshLatest}>{statusBusy ? "更新中" : "最新状態に更新"}</button>
      <button type="button" style={ghostButtonStyle} disabled={busy} onClick={analyze}>{busy ? "解析中" : "待機中LINEを今すぐ解析"}</button>
      <button type="button" style={includePastPending ? secondaryButtonStyle : ghostButtonStyle} onClick={() => setIncludePastPending((value) => !value)}>{includePastPending ? "過去の要対応を非表示" : "過去の要対応も表示"}</button>
      <button type="button" style={ghostButtonStyle} disabled={linkCandidatesLoading} onClick={() => void toggleLineLinkReview()}>{linkReviewOpen ? "LINE登録候補を閉じる" : "LINE登録候補を表示"}</button>
      <button type="button" style={secondaryButtonStyle} onClick={() => setManualOpen((value) => !value)}>{manualOpen ? "手入力を閉じる" : "電話・口頭連絡を手入力"}</button>
      <label style={{ display: "grid", gap: 6, minWidth: 170 }}><span>対応済みの表示期間</span><select style={inputStyle} value={historyDays} onChange={(event) => setHistoryDays(Number(event.target.value) as HistoryDays)}><option value={3}>直近3日</option><option value={5}>直近5日</option><option value={7}>直近7日</option><option value={14}>直近14日</option></select></label>
      {analysisStatus && <p role={analysisStatus.alert_active || analysisStatus.dead > 0 ? "alert" : undefined} style={{ flexBasis: "100%", margin: 0, color: analysisStatus.alert_active || analysisStatus.dead > 0 ? "#b42318" : "#555", fontWeight: analysisStatus.alert_active || analysisStatus.dead > 0 ? 800 : 400 }}>待機 {analysisStatus.queued}件（実行可能 {analysisStatus.ready}件・再試行待ち {analysisStatus.retry_wait}件） / 解析中 {analysisStatus.processing}件 / 要確認 {analysisStatus.dead}件 / 直近1時間 {analysisStatus.processed_last_hour}件 / 最終正常実行 {formatTime(analysisStatus.last_worker_succeeded_at)} / 最終確認 {formatTime(analysisStatus.last_checked_at)}{analysisStatus.oldest_queued_at ? ` / 最古 ${formatDateTime(analysisStatus.oldest_queued_at)}` : ""}{analysisStatus.last_worker_error ? ` / エラー: ${analysisStatus.last_worker_error}` : ""}</p>}
      {message && <p style={{ flexBasis: "100%" }}>{message}</p>}
    </section>
    {linkReviewOpen && <LineLinkReviewPanel candidates={linkCandidates} students={students} loading={linkCandidatesLoading} onReload={loadLineLinkCandidates} onChanged={async () => { await Promise.all([loadLineLinkCandidates(), load()]); }} setMessage={setMessage} />}
    {manualOpen && <ManualEntryForm students={students} confirmedBy={confirmedBy} onSaved={async () => { setMessage("手入力の欠席・遅刻を登録しました。"); setManualRefreshKey((value) => value + 1); setManualOpen(false); }} />}
    <div style={{ marginTop: 16 }}>
      <button type="button" style={secondaryButtonStyle} onClick={() => setManualEventsOpen((value) => !value)}>{manualEventsOpen ? "手入力済み連絡を閉じる" : "手入力済み・Notion未反映を表示"}</button>
    </div>
    {manualEventsOpen && <ManualEventsPanel students={students} confirmedBy={confirmedBy} refreshKey={manualRefreshKey} onChanged={() => setManualRefreshKey((value) => value + 1)} />}
    <nav aria-label="連絡候補の表示切り替え" style={{ display: "flex", gap: 8, marginTop: 20, padding: 5, border: "1px solid var(--line)", borderRadius: 9, background: "#f7f7f4", width: "fit-content", maxWidth: "100%", flexWrap: "wrap" }}>
      {([
        { value: "action", label: `要対応 ${actionCandidates.length}件` },
        { value: "done", label: `対応済み ${doneCandidates.length}件` },
        { value: "all", label: `すべて ${candidates.length}件` },
      ] as Array<{ value: ReviewTab; label: string }>).map((tab) => <button key={tab.value} type="button" aria-pressed={reviewTab === tab.value} onClick={() => { setReviewTab(tab.value); setVisibleCandidateCount(20); }} style={{ ...ghostButtonStyle, border: reviewTab === tab.value ? "1px solid var(--accent)" : "1px solid transparent", background: reviewTab === tab.value ? "white" : "transparent", color: reviewTab === tab.value ? "var(--accent)" : "#555", boxShadow: reviewTab === tab.value ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>{tab.label}</button>)}
    </nav>
    {reviewTab === "action" && errorCount > 0 && <div role="alert" style={{ marginTop: 12, border: "1px solid #fecaca", background: "#fef2f2", color: "#b42318", borderRadius: 8, padding: "10px 12px", fontWeight: 800 }}>登録エラーが{errorCount}件あります。先頭に表示しています。</div>}
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      {visibleCandidates.length === 0 && <section className="panel" style={{ padding: 24 }}>{reviewTab === "action" ? includePastPending ? "要対応の連絡はありません。" : "今日以降の要対応連絡はありません。過去分は「過去pendingも表示」で確認できます。" : reviewTab === "done" ? `直近${historyDays}日間の対応済み連絡はありません。` : "表示する連絡候補はありません。"}</section>}
      {visibleCandidates.slice(0, visibleCandidateCount).map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} students={students} confirmedBy={confirmedBy} replyTemplates={replyTemplates} onReplyTemplatesChanged={updateReplyTemplates} onChanged={() => load(candidate.id, reviewTab)} setMessage={setMessage} />)}
      {visibleCandidateCount < visibleCandidates.length && <button type="button" style={secondaryButtonStyle} onClick={() => setVisibleCandidateCount((count) => count + 20)}>続きを表示（残り{visibleCandidates.length - visibleCandidateCount}件）</button>}
    </div>
  </main>;
}

function formatTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function todayJst() {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(new Date());
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

function studentMatches(student: Student, query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return true;
  return normalizeSearchText(`${student.grade}${student.student_name}${student.student_number}${student.campus ?? ""}${student.homeroom_teacher ?? ""}`).includes(normalized);
}

function orderedStudentOptions(students: Student[], selectedNumber: string, query: string, candidates: Student[] = []) {
  const candidateNumbers = new Set(candidates.map((student) => student.student_number));
  const selected = students.find((student) => student.student_number === selectedNumber);
  const primary = [selected, ...candidates].filter((student): student is Student => Boolean(student));
  const seen = new Set<string>();
  const ordered = [
    ...primary,
    ...students.filter((student) => !candidateNumbers.has(student.student_number)),
  ].filter((student) => {
    if (seen.has(student.student_number)) return false;
    seen.add(student.student_number);
    return studentMatches(student, query);
  });
  return ordered.slice(0, query.trim() ? 80 : 160);
}

function StudentPicker({ label, students, value, onChange, query, onQueryChange, candidates = [], disabled = false, changeLabel = "変更" }: {
  label: string;
  students: Student[];
  value: string;
  onChange: (value: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  candidates?: Student[];
  disabled?: boolean;
  changeLabel?: string;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const candidateNumbers = new Set(candidates.map((student) => student.student_number));
  const options = orderedStudentOptions(students, value, query, candidates);
  const candidateOptions = options.filter((student) => candidateNumbers.has(student.student_number));
  const otherOptions = options.filter((student) => !candidateNumbers.has(student.student_number));
  const visibleOptions = [...candidateOptions, ...otherOptions];
  const selectedStudent = students.find((student) => student.student_number === value) ?? null;

  function selectStudent(student: Student) {
    onChange(student.student_number);
    onQueryChange(student.student_name);
    setOpen(false);
    setActiveIndex(0);
  }

  function beginSearch() {
    if (disabled) return;
    onQueryChange("");
    setActiveIndex(0);
    setOpen(true);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(visibleOptions.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && visibleOptions[activeIndex]) {
      event.preventDefault();
      selectStudent(visibleOptions[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function resultButton(student: Student, index: number, isCandidate: boolean) {
    const meta = [student.grade, student.campus, student.homeroom_teacher ? `担任 ${student.homeroom_teacher}` : null].filter(Boolean).join("・");
    return <button
      key={student.student_number}
      type="button"
      role="option"
      aria-selected={student.student_number === value}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => selectStudent(student)}
      onMouseEnter={() => setActiveIndex(index)}
      style={{ width: "100%", border: 0, borderTop: "1px solid #eceeea", padding: "10px 12px", background: index === activeIndex ? "#eef7f1" : "white", color: "#222", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
    >
      <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
        <strong style={{ fontSize: 15 }}>{student.student_name}</strong>
        <span style={{ color: "#626b66", fontSize: 12 }}>{meta || `生徒番号 ${student.student_number}`}</span>
      </span>
      {isCandidate && <span style={{ flex: "0 0 auto", border: "1px solid #fed7aa", background: "#fff7ed", color: "#9a3412", borderRadius: 999, padding: "3px 7px", fontSize: 11, fontWeight: 800 }}>AI候補</span>}
    </button>;
  }

  const selectedMeta = selectedStudent ? [selectedStudent.grade, selectedStudent.campus, selectedStudent.homeroom_teacher ? `担任 ${selectedStudent.homeroom_teacher}` : null].filter(Boolean).join("・") : "";
  return <div style={{ ...fieldStyle, position: "relative", minWidth: 0 }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <label htmlFor={inputId} style={{ fontWeight: 700 }}>{label}</label>
    {selectedStudent && !open ? <button type="button" disabled={disabled} onClick={beginSearch} style={{ width: "100%", minHeight: 48, boxSizing: "border-box", border: "1px solid var(--line)", borderRadius: 6, padding: "7px 9px", background: disabled ? "#f7f7f4" : "white", color: "#222", cursor: disabled ? "default" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, textAlign: "left" }}>
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <strong>{selectedStudent.student_name}</strong>
        <span style={{ color: "#626b66", fontSize: 12 }}>{selectedMeta}</span>
      </span>
      {!disabled && <span style={{ flex: "0 0 auto", color: "var(--accent)", fontSize: 13, fontWeight: 800 }}>{changeLabel}</span>}
    </button> : <div style={{ position: "relative" }}>
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        style={{ ...inputStyle, paddingRight: query ? 68 : 9 }}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onChange={(event) => { onQueryChange(event.target.value); setActiveIndex(0); setOpen(true); }}
        placeholder="名前・学年・校舎・担任で検索"
      />
      {query && !disabled && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onQueryChange(""); setActiveIndex(0); setOpen(true); }} style={{ position: "absolute", top: 5, right: 5, height: 30, border: 0, borderRadius: 5, padding: "0 9px", background: "#eef0ed", color: "#555", cursor: "pointer", fontWeight: 700 }}>消去</button>}
    </div>}
    {open && !disabled && <div id={listboxId} role="listbox" style={{ position: "absolute", zIndex: 50, top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 330, overflowY: "auto", border: "1px solid #aeb8b2", borderRadius: 8, background: "white", boxShadow: "0 10px 28px rgba(0,0,0,0.16)" }}>
      {candidateOptions.length > 0 && <div style={{ padding: "8px 12px 6px", background: "#fff7ed", color: "#9a3412", fontSize: 12, fontWeight: 800 }}>AIが推定した候補</div>}
      {candidateOptions.map((student, index) => resultButton(student, index, true))}
      {otherOptions.length > 0 && <div style={{ padding: "8px 12px 6px", background: "#f7f7f4", color: "#59635e", fontSize: 12, fontWeight: 800 }}>{candidateOptions.length > 0 ? "その他の生徒" : "生徒候補"}</div>}
      {otherOptions.map((student, index) => resultButton(student, candidateOptions.length + index, false))}
      {visibleOptions.length === 0 && <div style={{ padding: 16, color: "#666", textAlign: "center" }}>該当する生徒が見つかりません。</div>}
    </div>}
  </div>;
}
function aliasForStudent(student: Student | LineLinkSuggestion | null, relation: string) {
  if (!student) return "";
  const base = `${student.campus?.includes("南") ? "南" : "本"}　${student.student_name.normalize("NFKC").replace(/[\s　]/g, "")}`;
  if (relation === "student") return base;
  if (relation === "mother") return `${base}　母`;
  if (relation === "father") return `${base}　父`;
  return `${base}　保護者`;
}

function LineLinkReviewPanel({ candidates, students, loading, onReload, onChanged, setMessage }: {
  candidates: LineLinkCandidate[];
  students: Student[];
  loading: boolean;
  onReload: () => Promise<void>;
  onChanged: () => Promise<void>;
  setMessage: (value: string) => void;
}) {
  type LinkDraft = { student_number: string; relation: string; query: string; display_name: string; extra_student_numbers: string[]; extra_query: string };
  const [drafts, setDrafts] = useState<Record<string, LinkDraft>>({});
  const [savingLineUserId, setSavingLineUserId] = useState<string | null>(null);

  function draftFor(candidate: LineLinkCandidate): LinkDraft {
    return drafts[candidate.line_user_id] ?? {
      student_number: candidate.default_student_number,
      relation: candidate.default_relation || "mother",
      query: candidate.suggestions[0]?.student_name ?? candidate.suggested_names[0] ?? candidate.display_name ?? "",
      display_name: candidate.display_name ?? "",
      extra_student_numbers: [],
      extra_query: "",
    };
  }

  function updateDraft(lineUserId: string, patch: Partial<LinkDraft>) {
    setDrafts((current) => {
      const currentDraft = current[lineUserId] ?? { student_number: "", relation: "mother", query: "", display_name: "", extra_student_numbers: [], extra_query: "" };
      return { ...current, [lineUserId]: { ...currentDraft, ...patch } };
    });
  }

  function selectedStudents(draft: LinkDraft) {
    const numbers = [draft.student_number, ...draft.extra_student_numbers].filter(Boolean);
    return [...new Set(numbers)].map((studentNumber) => students.find((student) => student.student_number === studentNumber)).filter((student): student is Student => Boolean(student));
  }

  function addSibling(candidate: LineLinkCandidate, studentNumber: string) {
    if (!studentNumber) return;
    const draft = draftFor(candidate);
    if (studentNumber === draft.student_number || draft.extra_student_numbers.includes(studentNumber)) return;
    updateDraft(candidate.line_user_id, { extra_student_numbers: [...draft.extra_student_numbers, studentNumber], extra_query: "" });
  }

  function removeSibling(candidate: LineLinkCandidate, studentNumber: string) {
    const draft = draftFor(candidate);
    updateDraft(candidate.line_user_id, { extra_student_numbers: draft.extra_student_numbers.filter((value) => value !== studentNumber) });
  }

  async function confirmLink(candidate: LineLinkCandidate) {
    const draft = draftFor(candidate);
    const targets = selectedStudents(draft);
    if (targets.length === 0) { setMessage("生徒を選択してください。"); return; }
    const displayName = draft.display_name.trim();
    const aliasNames = targets.map((student) => aliasForStudent(student, draft.relation));
    if (!window.confirm(`${displayName || "表示名なし"} を ${aliasNames.join(" / ")} として登録します。よろしいですか？`)) return;
    setSavingLineUserId(candidate.line_user_id);
    try {
      for (const [index, student] of targets.entries()) {
        const aliasName = aliasForStudent(student, draft.relation);
        const response = await fetch(`/api/students/${encodeURIComponent(student.student_number)}/link`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            line_user_id: candidate.line_user_id,
            relation: draft.relation,
            alias_name: aliasName,
            friend_display_name: displayName || null,
            is_primary: false,
            confirm_evidence: index === targets.length - 1,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "LINE紐づけに失敗しました");
      }
      setMessage(`${aliasNames.join(" / ")} として登録しました。`);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingLineUserId(null);
    }
  }

  async function rejectCandidate(candidate: LineLinkCandidate) {
    if (!window.confirm("この名乗りをLINE登録候補から外します。よろしいですか？")) return;
    setSavingLineUserId(candidate.line_user_id);
    try {
      const response = await fetch("/api/attendance/line-link-candidates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line_user_id: candidate.line_user_id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "候補を外せませんでした");
      setMessage("LINE登録候補から外しました。アカウントの登録は行っていません。");
      await onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingLineUserId(null);
    }
  }

  return <section className="panel" style={{ padding: 16, marginTop: 16, display: "grid", gap: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "grid", gap: 4 }}>
        <strong>LINE登録候補</strong>
        <span style={{ color: "#666", fontSize: 12 }}>毎朝6時ごろ、本人・父・母・保護者と明示したメッセージを候補にします。ここで確定するまで自動登録されません。</span>
      </div>
      <button type="button" style={ghostButtonStyle} disabled={loading} onClick={() => void onReload()}>{loading ? "更新中..." : "候補を更新"}</button>
    </div>
    {candidates.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 12, color: "#777" }}>確認待ちのLINE登録候補はありません。</div> : <div style={{ display: "grid", gap: 10 }}>
      {candidates.map((candidate) => {
        const draft = draftFor(candidate);
        const aliasNames = selectedStudents(draft).map((student) => aliasForStudent(student, draft.relation));
        const suggestionStudents = candidate.suggestions.map((suggestion) => ({
          student_number: suggestion.student_number,
          student_name: suggestion.student_name,
          grade: suggestion.grade,
          campus: suggestion.campus,
          homeroom_teacher: suggestion.homeroom_teacher,
        }));
        const siblingCandidates = students.filter((student) => student.student_number !== draft.student_number && !draft.extra_student_numbers.includes(student.student_number));
        const extraStudents = draft.extra_student_numbers.map((studentNumber) => students.find((student) => student.student_number === studentNumber)).filter((student): student is Student => Boolean(student));
        return <div key={candidate.line_user_id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 12, display: "grid", gap: 10, background: "white" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>相手のLINE表示名: {candidate.display_name ?? "表示名なし"} <span style={{ color: "#777", fontSize: 12 }}>ID末尾 {candidate.line_user_id_short}</span></strong>
            <span style={{ color: "#666", fontSize: 12 }}>判断材料: 出欠連絡候補 {candidate.candidate_count}件 / 最終受信 {formatReceivedAt(candidate.latest_received_at)} / AI候補 {candidate.suggested_names.join(" / ") || "なし"}</span>
          </div>
          <div style={{ padding: 10, background: "#f7f7f4", border: "1px solid var(--line)", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{candidate.latest_text ?? "（本文なし）"}</div>
          {candidate.identity_evidence && <div style={{ padding: 10, background: "#fff8df", border: "1px solid #d8b64c", borderRadius: 6, display: "grid", gap: 5 }}>
            <strong style={{ color: "#6f5400" }}>{candidate.identity_evidence.source === "auto_explicit_identity_candidate" ? "朝6時に自動検出した名乗り" : "紐づけ候補の根拠：本人確認メッセージ"}</strong>
            <span style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>「{candidate.identity_evidence.evidence_text}」</span>
            <span style={{ color: "#695f42", fontSize: 12 }}>
              {[candidate.identity_evidence.evidence_at ? formatReceivedAt(candidate.identity_evidence.evidence_at) : null,
                candidate.identity_evidence.parsed_student_name ? `名乗り: ${candidate.identity_evidence.parsed_student_name}` : null,
                candidate.identity_evidence.manager_alias_name ? `LINE管理名: ${candidate.identity_evidence.manager_alias_name}` : null]
                .filter(Boolean).join(" / ")}
            </span>
          </div>}
          {candidate.suggestions.length > 0 && <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>生徒候補</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{candidate.suggestions.map((suggestion) => <button key={suggestion.student_number} type="button" style={draft.student_number === suggestion.student_number ? buttonStyle : ghostButtonStyle} onClick={() => updateDraft(candidate.line_user_id, { student_number: suggestion.student_number, query: suggestion.student_name })}>{suggestion.grade} {suggestion.student_name} / {suggestion.reason}</button>)}</div>
          </div>}
          <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <strong>確定する内容</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "end" }}>
              <label style={fieldStyle}>1. 相手がLINEに表示している名前<input style={inputStyle} value={draft.display_name} onChange={(event) => updateDraft(candidate.line_user_id, { display_name: event.target.value })} placeholder="例: Shiho" /></label>
              <StudentPicker label="2. 紐づけたい生徒" students={students} value={draft.student_number} query={draft.query} onQueryChange={(query) => updateDraft(candidate.line_user_id, { query })} onChange={(student_number) => updateDraft(candidate.line_user_id, { student_number })} candidates={suggestionStudents} />
              <label style={fieldStyle}>関係<select style={inputStyle} value={draft.relation} onChange={(event) => updateDraft(candidate.line_user_id, { relation: event.target.value })}><option value="mother">母</option><option value="father">父</option><option value="student">本人</option><option value="guardian">保護者</option></select></label>
              <label style={fieldStyle}>3. この名前で登録<div style={{ ...readonlyStyle, fontWeight: 700 }}>{aliasNames.join(" / ") || "生徒未選択"}</div></label>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>兄弟も同じ保護者として登録する場合</span>
              {extraStudents.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{extraStudents.map((student) => <button key={student.student_number} type="button" style={secondaryButtonStyle} onClick={() => removeSibling(candidate, student.student_number)}>{student.grade} {student.student_name} を外す</button>)}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto auto", gap: 10, alignItems: "end" }}>
                <StudentPicker label="追加する兄弟" students={students} value="" query={draft.extra_query} onQueryChange={(query) => updateDraft(candidate.line_user_id, { extra_query: query })} onChange={(studentNumber) => addSibling(candidate, studentNumber)} candidates={siblingCandidates} />
                {candidate.identity_evidence?.review_status === "pending" && <button type="button" style={ghostButtonStyle} disabled={savingLineUserId === candidate.line_user_id} onClick={() => void rejectCandidate(candidate)}>候補から外す</button>}
                <button type="button" style={buttonStyle} disabled={savingLineUserId === candidate.line_user_id || selectedStudents(draft).length === 0} onClick={() => void confirmLink(candidate)}>{savingLineUserId === candidate.line_user_id ? "登録中..." : `選択した${selectedStudents(draft).length}名に確定`}</button>
              </div>
            </div>
          </div>
        </div>;
      })}
    </div>}
  </section>;
}
function ManualEntryForm({ students, confirmedBy, onSaved }: { students: Student[]; confirmedBy: string; onSaved: () => Promise<void> }) {
  const [contactMethod, setContactMethod] = useState("phone");
  const [receivedBy, setReceivedBy] = useState(confirmedBy);
  const [studentNumber, setStudentNumber] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [eventDate, setEventDate] = useState(todayJst());
  const [campus, setCampus] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [eventType, setEventType] = useState("absence");
  const [reason, setReason] = useState("体調不良");
  const [arrivalExpectedTime, setArrivalExpectedTime] = useState("");
  const [noteInternal, setNoteInternal] = useState("");
  const [noteForClassroom, setNoteForClassroom] = useState("");
  const [crossCampusOverride, setCrossCampusOverride] = useState(false);
  const [crossCampusReason, setCrossCampusReason] = useState("");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selectedStudent = students.find((student) => student.student_number === studentNumber) ?? null;

  useEffect(() => {
    if (!eventDate) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ date: eventDate });
    if (studentNumber) query.set("student_number", studentNumber);
    fetch(`/api/attendance/lessons?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "授業一覧を取得できませんでした");
        return body;
      })
      .then((body) => setLessons(body.lessons ?? []))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLessons([]);
        setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [eventDate, studentNumber]);
  const effectiveReceivedBy = receivedBy || confirmedBy;
  const effectiveCampus = campus || selectableCampus(selectedStudent?.campus);
  const candidateStudents = effectiveCampus ? students.filter((student) => studentMatchesCampus(student, effectiveCampus)) : [];
  const selectedLesson = lessons.find((lesson) => lesson.id === lessonId) ?? null;
  const isCrossCampus = lessonIsCrossCampus(selectedStudent, selectedLesson, effectiveCampus);

  async function saveManualEvent() {
    if (!effectiveReceivedBy.trim()) { setMessage("受付者名を入力してください。"); return; }
    if (!studentNumber) { setMessage("生徒を選択してください。"); return; }
    if (!eventDate) { setMessage("対象日を入力してください。"); return; }
    if (!lessonId) { setMessage("授業を選択してください。"); return; }
    if (isCrossCampus && (!crossCampusOverride || !crossCampusReason.trim())) { setMessage("別校舎受講として登録するチェックと理由が必要です。"); return; }
    setSaving(true);
    setMessage("保存しています...");
    try {
      const response = await fetch("/api/attendance/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_method: contactMethod,
          contact_received_at: new Date().toISOString(),
          received_by: effectiveReceivedBy,
          student_number: studentNumber,
          lesson_id: lessonId,
          event_date: eventDate,
          event_type: eventType,
          reason,
          arrival_expected_time: arrivalExpectedTime,
          note_internal: noteInternal,
          note_for_classroom: noteForClassroom,
          cross_campus_override: isCrossCampus && crossCampusOverride,
          cross_campus_reason: isCrossCampus ? crossCampusReason : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "保存に失敗しました");
      if (body.notion_failed) {
        const notionError = body.notion_results?.find((result: { notion_error?: string | null }) => result.notion_error)?.notion_error;
        setMessage(`データは保存しましたが、Notion反映に失敗しました。再度保存すると再試行できます。${notionError ? ` ${notionError}` : ""}`);
        return;
      }
      setMessage("保存しました。");
      setLessonId("");
      setArrivalExpectedTime("");
      setNoteInternal("");
      setNoteForClassroom("");
      setCrossCampusOverride(false);
      setCrossCampusReason("");
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const filteredLessons = effectiveCampus ? lessons.filter((lesson) => lesson.campus === effectiveCampus) : lessons;
  const lessonGroups = lessonsByTime(filteredLessons);

  return <section className="panel" style={{ padding: 16, marginTop: 16, display: "grid", gap: 12 }}>
    <strong>電話・口頭連絡を手入力</strong>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
      <label style={fieldStyle}>連絡経路<select style={inputStyle} value={contactMethod} onChange={(event) => setContactMethod(event.target.value)}><option value="phone">電話</option><option value="oral">口頭</option><option value="other">その他</option></select></label>
      <label style={fieldStyle}>受付者名<input style={inputStyle} value={effectiveReceivedBy} onChange={(event) => setReceivedBy(event.target.value)} placeholder="例: 吉川" /></label>
      <StudentPicker label="生徒" students={students} value={studentNumber} query={studentQuery} onQueryChange={setStudentQuery} candidates={candidateStudents} onChange={(value) => { setStudentNumber(value); setLessonId(""); }} />
      <label style={fieldStyle}>対象日<input style={inputStyle} type="date" value={eventDate} onChange={(event) => { setEventDate(event.target.value); setLessonId(""); }} /></label>
      <label style={fieldStyle}>種別<select style={inputStyle} value={eventType} onChange={(event) => setEventType(event.target.value)}>{eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label style={fieldStyle}>校舎<select style={inputStyle} value={effectiveCampus} onChange={(event) => { setCampus(event.target.value); setLessonId(""); }}><option value="">校舎すべて</option><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
      <label style={fieldStyle}>理由<div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 8 }}><select style={inputStyle} value={reasonOptions.includes(reason) ? reason : ""} onChange={(event) => { if (event.target.value) setReason(event.target.value); }}><option value="">直接入力</option>{reasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><input style={inputStyle} value={reason} onChange={(event) => setReason(event.target.value)} /></div></label>
      
    </div>
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ fontWeight: 700 }}>授業</span>
      {lessonGroups.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, color: "#777" }}>対象日の授業が見つかりません。</div> : lessonGroups.map((group) => <div key={group.time} style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: 8, alignItems: "start" }}>
        <div style={{ color: "#555", fontSize: 13, fontWeight: 700, paddingTop: 8 }}>{group.time}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{group.lessons.map((lesson) => <button key={lesson.id} type="button" onClick={() => { setLessonId(lesson.id); setCampus(lesson.campus ?? effectiveCampus); }} style={{ border: lesson.id === lessonId ? "2px solid var(--accent)" : lesson.enrolled ? "2px solid #16a34a" : "1px solid var(--line)", borderRadius: 6, padding: "7px 9px", background: lesson.id === lessonId ? "#ecfdf3" : lesson.enrolled ? "#f2fbf5" : "white", cursor: "pointer", textAlign: "left" }}><strong>{lesson.label}</strong>{lesson.classroom ? <span style={{ color: "#666", fontSize: 12 }}> / {lesson.classroom}教室</span> : null}{lesson.enrolled ? <span style={{ color: "#087a3d", fontSize: 12, fontWeight: 700 }}> / 受講中</span> : null}</button>)}</div>
      </div>)}
    </div>
    {isCrossCampus && <div style={{ border: "1px solid #fdba74", background: "#fff7ed", borderRadius: 6, padding: 10, display: "grid", gap: 8 }}>
      <label style={{ fontWeight: 800 }}><input type="checkbox" checked={crossCampusOverride} onChange={(event) => setCrossCampusOverride(event.target.checked)} /> 別校舎での振替・受講として登録する</label>
      <label style={fieldStyle}>別校舎受講の理由<input style={inputStyle} value={crossCampusReason} onChange={(event) => setCrossCampusReason(event.target.value)} placeholder="例：本日のみ南教室へ振替" /></label>
    </div>}
    {message && <p style={{ color: !message.includes("失敗") && message.includes("保存しました") ? "#087a3d" : "#b42318", fontWeight: 700 }}>{message}</p>}
    <div><button type="button" style={buttonStyle} disabled={saving} onClick={saveManualEvent}>{saving ? "保存中..." : "確定データとして保存"}</button></div>
  </section>;
}
function contactMethodLabel(value: string) {
  if (value === "phone") return "電話";
  if (value === "oral") return "口頭";
  return "その他";
}

function eventStudent(event: ManualEvent) {
  return event.student_roster ? `${event.student_roster.grade} ${event.student_roster.student_name}` : event.student_number;
}

function ManualEventsPanel({ students, confirmedBy, refreshKey, onChanged }: { students: Student[]; confirmedBy: string; refreshKey: number; onChanged: () => void }) {
  const [events, setEvents] = useState<ManualEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [draft, setDraft] = useState({
    contact_method: "phone",
    received_by: confirmedBy,
    student_number: "",
    event_date: todayJst(),
    campus: "",
    lesson_id: "",
    event_type: "absence",
    reason: "体調不良",
    arrival_expected_time: "",
    note_internal: "",
    note_for_classroom: "",
    cross_campus_override: false,
    cross_campus_reason: "",
  });

  const loadManualEvents = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/attendance/events");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "手入力済み一覧を取得できませんでした");
      setEvents(body.events ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadManualEvents();
  }, [loadManualEvents, refreshKey]);

  useEffect(() => {
    if (!editingId || !draft.event_date) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ date: draft.event_date });
    if (draft.student_number) query.set("student_number", draft.student_number);
    fetch(`/api/attendance/lessons?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "授業一覧を取得できませんでした");
        return body;
      })
      .then((body) => setLessons(body.lessons ?? []))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLessons([]);
        setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [editingId, draft.event_date, draft.student_number]);

  function startEdit(event: ManualEvent) {
    setEditingId(event.id);
    setStudentQuery(event.student_roster?.student_name ?? "");
    setMessage("");
    setDraft({
      contact_method: event.contact_method,
      received_by: event.received_by ?? confirmedBy,
      student_number: event.student_number,
      event_date: event.event_date,
      campus: event.lessons?.campus ?? event.student_roster?.campus ?? "",
      lesson_id: event.lesson_id,
      event_type: event.event_type,
      reason: event.reason ?? fallbackReason(event.event_type),
      arrival_expected_time: event.arrival_expected_time ?? "",
      note_internal: event.note_internal ?? "",
      note_for_classroom: event.note_for_classroom ?? "",
      cross_campus_override: event.cross_campus_override === true,
      cross_campus_reason: event.cross_campus_reason ?? "",
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!draft.received_by.trim()) { setMessage("受付者名を入力してください。"); return; }
    if (!draft.student_number) { setMessage("生徒を選択してください。"); return; }
    if (!draft.event_date) { setMessage("対象日を入力してください。"); return; }
    if (!draft.lesson_id) { setMessage("授業を選択してください。"); return; }
    if (isEditingCrossCampus && (!draft.cross_campus_override || !draft.cross_campus_reason.trim())) {
      setMessage("別校舎受講として登録するチェックと理由が必要です。");
      return;
    }
    const busyKey = `edit:${editingId}`;
    setActionBusy(busyKey);
    setMessage("保存しています...");
    try {
      const response = await fetch(`/api/attendance/events/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          cross_campus_override: isEditingCrossCampus && draft.cross_campus_override,
          cross_campus_reason: isEditingCrossCampus ? draft.cross_campus_reason : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "修正に失敗しました");
      setMessage(body.notion_failed ? `修正しました。Notion反映に失敗しました: ${body.notion_error}` : "修正してNotionへ反映しました。");
      setEditingId(null);
      await loadManualEvents();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(null);
    }
  }

  async function cancelEvent(event: ManualEvent) {
    if (!confirmedBy.trim()) { setMessage("画面上部の「確認者名」を入力してください。"); return; }
    if (!window.confirm(`${eventStudent(event)} / ${event.lessons?.label ?? "授業未取得"} を取り消しますか？`)) return;
    const busyKey = `cancel:${event.id}`;
    setActionBusy(busyKey);
    setMessage("取り消しています...");
    try {
      const response = await fetch(`/api/attendance/events/${event.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelled_by: confirmedBy }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "取消しに失敗しました");
      setMessage(body.notion_failed ? `取り消しました。Notion反映に失敗しました: ${body.notion_error}` : "取り消してNotionへ反映しました。");
      await loadManualEvents();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(null);
    }
  }

  const currentStudent = students.find((student) => student.student_number === draft.student_number) ?? null;
  const effectiveCampus = draft.campus || selectableCampus(currentStudent?.campus);
  const candidateStudents = effectiveCampus ? students.filter((student) => studentMatchesCampus(student, effectiveCampus)) : [];
  const filteredLessons = effectiveCampus ? lessons.filter((lesson) => lesson.campus === effectiveCampus) : lessons;
  const lessonGroups = lessonsByTime(filteredLessons);
  const currentLesson = lessons.find((lesson) => lesson.id === draft.lesson_id) ?? null;
  const isEditingCrossCampus = lessonIsCrossCampus(currentStudent, currentLesson, effectiveCampus);

  return <section className="panel" style={{ padding: 16, marginTop: 16, display: "grid", gap: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <strong>手入力済み連絡（本日以降＋Notion未反映）</strong>
      <button type="button" style={ghostButtonStyle} disabled={loading || Boolean(actionBusy)} onClick={() => void loadManualEvents()}>{loading ? "更新中..." : "更新"}</button>
    </div>
    {message && <p style={{ color: message.includes("失敗") ? "#b42318" : "#087a3d", fontWeight: 700 }}>{message}</p>}
    {events.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 12, color: "#777" }}>本日以降の手入力済み連絡とNotion未反映データはありません。</div> : <div style={{ display: "grid", gap: 8 }}>
      {events.map((event) => <div key={event.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, display: "grid", gap: 8, background: event.status === "cancelled" ? "#f7f7f4" : "white" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>{event.event_date} {event.lessons?.start_time ?? "時刻なし"} {event.lessons?.label ?? "授業未取得"}</strong>
            <span style={{ color: "#555", fontSize: 13, fontWeight: 700 }}>{eventStudent(event)} / {event.lessons?.campus ?? "校舎不明"}{event.lessons?.classroom ? ` ${event.lessons.classroom}教室` : ""} / {eventTypeLabel(event.event_type)} / {event.reason ?? fallbackReason(event.event_type)}</span>
            <span style={{ color: "#666", fontSize: 12 }}>{contactMethodLabel(event.contact_method)} / 受付: {event.received_by ?? "未入力"} / Notion: {event.notion_status}{event.notion_error ? ` / ${event.notion_error}` : ""}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
            {event.status === "cancelled" ? <span style={{ color: "#b42318", fontWeight: 800 }}>取消済み</span> : <>
              <button type="button" style={ghostButtonStyle} disabled={Boolean(actionBusy)} onClick={() => startEdit(event)}>修正</button>
              <button type="button" style={dangerButtonStyle} disabled={Boolean(actionBusy)} onClick={() => void cancelEvent(event)}>{actionBusy === `cancel:${event.id}` ? "取消中..." : "取消し"}</button>
            </>}
          </div>
        </div>
        {editingId === event.id && <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
            <label style={fieldStyle}>連絡経路<select style={inputStyle} value={draft.contact_method} onChange={(e) => setDraft((d) => ({ ...d, contact_method: e.target.value }))}><option value="phone">電話</option><option value="oral">口頭</option><option value="other">その他</option></select></label>
            <label style={fieldStyle}>受付者名<input style={inputStyle} value={draft.received_by} onChange={(e) => setDraft((d) => ({ ...d, received_by: e.target.value }))} /></label>
            <StudentPicker label="生徒" students={students} value={draft.student_number} query={studentQuery} onQueryChange={setStudentQuery} candidates={candidateStudents} onChange={(value) => setDraft((d) => ({ ...d, student_number: value, lesson_id: "" }))} />
            <label style={fieldStyle}>対象日<input style={inputStyle} type="date" value={draft.event_date} onChange={(e) => setDraft((d) => ({ ...d, event_date: e.target.value, lesson_id: "" }))} /></label>
            <label style={fieldStyle}>種別<select style={inputStyle} value={draft.event_type} onChange={(e) => setDraft((d) => ({ ...d, event_type: e.target.value }))}>{eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label style={fieldStyle}>校舎<select style={inputStyle} value={effectiveCampus} onChange={(e) => setDraft((d) => ({ ...d, campus: e.target.value, lesson_id: "" }))}><option value="">校舎すべて</option><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
            <label style={fieldStyle}>理由<input style={inputStyle} value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} /></label>
            
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700 }}>授業</span>
            {lessonGroups.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, color: "#777" }}>対象日の授業が見つかりません。</div> : lessonGroups.map((group) => <div key={group.time} style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: 8, alignItems: "start" }}>
              <div style={{ color: "#555", fontSize: 13, fontWeight: 700, paddingTop: 8 }}>{group.time}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{group.lessons.map((lesson) => <button key={lesson.id} type="button" onClick={() => setDraft((d) => ({ ...d, lesson_id: lesson.id, campus: lesson.campus ?? d.campus }))} style={{ border: lesson.id === draft.lesson_id ? "2px solid var(--accent)" : lesson.enrolled ? "2px solid #16a34a" : "1px solid var(--line)", borderRadius: 6, padding: "7px 9px", background: lesson.id === draft.lesson_id ? "#ecfdf3" : lesson.enrolled ? "#f2fbf5" : "white", cursor: "pointer", textAlign: "left" }}><strong>{lesson.label}</strong>{lesson.classroom ? <span style={{ color: "#666", fontSize: 12 }}> / {lesson.classroom}教室</span> : null}{lesson.enrolled ? <span style={{ color: "#087a3d", fontSize: 12, fontWeight: 700 }}> / 受講中</span> : null}</button>)}</div>
            </div>)}
          </div>
          {isEditingCrossCampus && <div style={{ border: "1px solid #fdba74", background: "#fff7ed", borderRadius: 6, padding: 10, display: "grid", gap: 8 }}>
            <label style={{ fontWeight: 800 }}><input type="checkbox" checked={draft.cross_campus_override} onChange={(event) => setDraft((value) => ({ ...value, cross_campus_override: event.target.checked }))} /> 別校舎での振替・受講として登録する</label>
            <label style={fieldStyle}>別校舎受講の理由<input style={inputStyle} value={draft.cross_campus_reason} onChange={(event) => setDraft((value) => ({ ...value, cross_campus_reason: event.target.value }))} placeholder="例：本日のみ南教室へ振替" /></label>
          </div>}
          <div style={{ display: "flex", gap: 8 }}><button type="button" style={buttonStyle} disabled={Boolean(actionBusy)} onClick={() => void saveEdit()}>{actionBusy === `edit:${event.id}` ? "保存中..." : "保存してNotion反映"}</button><button type="button" style={ghostButtonStyle} disabled={Boolean(actionBusy)} onClick={() => setEditingId(null)}>閉じる</button></div>
        </div>}
      </div>)}
    </div>}
  </section>;
}
function CandidateCard({ candidate, students, confirmedBy, replyTemplates, onReplyTemplatesChanged, onChanged, setMessage }: { candidate: Candidate; students: Student[]; confirmedBy: string; replyTemplates: string[]; onReplyTemplatesChanged: (templates: string[]) => Promise<void>; onChanged: () => Promise<void>; setMessage: (value: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const lineManagedNames = useMemo(() => (candidate.sender_profile?.alias_names ?? [])
    .filter((value, index, values) => values.indexOf(value) === index), [candidate.sender_profile?.alias_names]);
  const lineManagedName = lineManagedNames.length > 0 ? lineManagedNames.join(" / ") : "未登録";
  const lineTagNames = candidate.sender_profile?.tag_names ?? [];
  const senderDisplayName = candidate.sender_profile?.display_name ?? candidate.line_messages?.display_name ?? "不明";
  const titleName = `${lineManagedName}（${senderDisplayName}）`;
  const senderLineUserId = candidate.line_messages?.line_user_id ?? null;
  const receivedAtText = formatReceivedAt(candidate.line_messages?.received_at);
  const initialStudentNumber = candidate.student_number ?? (candidate.student_selection_required ? "" : candidate.student_suggestions?.[0]?.student_number ?? "");
  const initialCampus = campusFromLineManagedName(lineManagedNames[0]) || candidate.lessons?.campus || selectableCampus(candidate.student_roster?.campus);
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber);
  const [studentQuery, setStudentQuery] = useState("");
  const [items, setItems] = useState<EditableItem[]>(() => initialItems(candidate, initialCampus, initialStudentNumber));
  const [itemStudentQueries, setItemStudentQueries] = useState<Record<string, string>>({});
  const registered = candidate.status === "confirmed";
  const dismissed = candidate.status === "dismissed";
  const registering = candidate.status === "registering";
  const closed = registered || dismissed;
  const itemStatuses = candidate.attendance_candidate_items ?? [];
  const confirmedItems = itemStatuses.filter((item) => item.status === "confirmed").length;
  const failedItems = itemStatuses.filter((item) => item.status === "notion_failed").length;
  const notionKind = candidate.notion_error || failedItems > 0 ? "failed" : closed ? "done" : registering || confirmedItems > 0 ? "partial" : "pending";
  const notionDetail = notionKind === "failed" ? "エラー" : dismissed ? "対応不要" : registered ? "登録済み" : registering ? "登録処理中（15分超で再試行可）" : confirmedItems > 0 ? `${confirmedItems}/${Math.max(itemStatuses.length, items.length)}行` : "未登録";
  const replyStatus = candidate.reply_status;
  const hasSentReply = Boolean(replyStatus?.sent);
  const replyKind = replyStatus?.sent ? "done" : "pending";
  const replyDetail = replyStatus?.sent ? ["送信済み", replyStatus.last_sent_by, formatStatusTime(replyStatus.last_sent_at)].filter(Boolean).join(" / ") : "未送信";
  const [lessonLists, setLessonLists] = useState<Record<string, Lesson[]>>({});
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [cardMessage, setCardMessage] = useState("");
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState(0);
  const [replyText, setReplyText] = useState(replyTemplates[0] ?? defaultReplyTemplates[0]);
  const [additionalMessageMode, setAdditionalMessageMode] = useState(false);
  const [linkingSender, setLinkingSender] = useState(false);
  const suggestions = useMemo(() => candidate.student_suggestions ?? [], [candidate.student_suggestions]);
  const suggestionNumbers = useMemo(() => new Set(suggestions.map((student) => student.student_number)), [suggestions]);
  const studentOptions = useMemo(() => uniqueByNumber([
    ...suggestions,
    ...students.filter((student) => !suggestionNumbers.has(student.student_number)),
  ]), [students, suggestions, suggestionNumbers]);
  const selectedStudent = studentOptions.find((student) => student.student_number === studentNumber) ?? (
    candidate.student_number && candidate.student_roster ? {
      student_number: candidate.student_number,
      student_name: candidate.student_roster.student_name,
      grade: candidate.student_roster.grade,
      campus: candidate.student_roster.campus,
      homeroom_teacher: candidate.student_roster.homeroom_teacher,
    } : null
  );
  const datesKey = useMemo(() => [...new Set(items.map((item) => item.event_date).filter(Boolean))].sort().join("|"), [items]);
  const eventSummary = items.slice(0, 2).map((item) => [item.event_date || "日付未定", eventTypeLabel(item.event_type), item.ai_summary || fallbackReason(item.event_type)].join(" / ")).join("　｜　");
  const hasError = candidateHasError(candidate);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    const dates = datesKey ? datesKey.split("|") : [];
    for (const date of dates) {
      fetch(`/api/attendance/lessons?date=${encodeURIComponent(date)}&student_number=${encodeURIComponent(studentNumber)}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "授業一覧を取得できませんでした");
          return body;
        })
        .then((body) => {
          const found = (body.lessons ?? []) as Lesson[];
          setLessonLists((current) => ({ ...current, [date]: found }));
          setItems((currentItems) => currentItems.map((item) => {
            if (item.event_date !== date || item.lesson_id) return item;
            const itemStudent = studentOptions.find((student) => student.student_number === item.student_number);
            const targetCampus = selectableCampus(itemStudent?.campus ?? selectedStudent?.campus);
            const eligibleLessons = targetCampus ? found.filter((lesson) => lesson.campus === targetCampus) : found;
            const subject = normalizeLessonText(item.suggested_subject);
            const className = normalizeLessonText(item.suggested_class_name);
            const recommended = eligibleLessons.find((lesson) => {
              const label = normalizeLessonText(lesson.label);
              return lesson.enrolled && ((subject && label.includes(subject)) || (className && label.includes(className)));
            }) ?? eligibleLessons.find((lesson) => lesson.enrolled) ?? null;
            if (!recommended) return item;
            return { ...item, lesson_id: recommended.id, campus: recommended.campus || targetCampus, cross_campus_override: false, cross_campus_reason: "" };
          }));
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setLessonLists((current) => ({ ...current, [date]: [] }));
          setCardMessage(error instanceof Error ? error.message : String(error));
        });
    }
    return () => controller.abort();
  }, [datesKey, expanded, studentNumber, selectedStudent?.campus, studentOptions]);

  function updateItem(clientId: string, patch: Partial<EditableItem>) {
    setItems((current) => current.map((item) => item.client_id === clientId ? { ...item, ...patch } : item));
  }

  function selectStudent(value: string) {
    setStudentNumber(value);
    const student = studentOptions.find((option) => option.student_number === value);
    setItems((current) => current.map((item) => ({ ...item, student_number: value, campus: selectableCampus(student?.campus), lesson_id: "", cross_campus_override: false, cross_campus_reason: "" })));
  }

  async function linkSenderToSelectedStudent() {
    if (!senderLineUserId) { setCardMessage("このLINE連絡先のIDを取得できません。"); return; }
    if (!studentNumber) { setCardMessage("先に名前を選択してください。"); return; }
    const student = studentOptions.find((item) => item.student_number === studentNumber);
    if (!student) { setCardMessage("選択中の生徒を確認できません。"); return; }
    const aliasName = lineManagedName !== "未登録" ? lineManagedName : senderDisplayName;
    if (!window.confirm(`${student.grade} ${student.student_name} に ${titleName} を保護者LINEとして登録します。よろしいですか？`)) return;
    setLinkingSender(true);
    setCardMessage("LINE連絡先を登録しています...");
    try {
      const response = await fetch(`/api/students/${encodeURIComponent(studentNumber)}/link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: senderLineUserId,
          relation: "guardian",
          alias_name: aliasName,
          friend_display_name: senderDisplayName === "不明" ? null : senderDisplayName,
          is_primary: false,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "LINE連絡先の登録に失敗しました");
      setCardMessage("選択中の生徒へ保護者LINEとして登録しました。");
      setMessage("LINE連絡先を登録しました。");
      await onChanged();
    } catch (error) {
      setCardMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLinkingSender(false);
    }
  }
  function addItem() {
    if (items.length >= 80) { setCardMessage("登録行は80件までです。"); return; }
    const previous = items[items.length - 1];
    setItems((current) => [...current, {
      client_id: makeClientId(),
      student_number: previous?.student_number ?? studentNumber,
      event_type: previous?.event_type ?? candidate.event_type ?? "absence",
      event_date: previous?.event_date ?? candidate.event_date ?? "",
      campus: previous?.campus ?? initialCampus,
      lesson_id: "",
      suggested_subject: null,
      suggested_class_name: null,
      ai_summary: previous?.ai_summary ?? fallbackReason(candidate.event_type),
      arrival_expected_time: previous?.arrival_expected_time ?? "",
      note_internal: "",
      note_for_classroom: "",
      cross_campus_override: false,
      cross_campus_reason: "",
    }]);
  }

  function removeItem(clientId: string) {
    setItems((current) => current.length <= 1 ? current : current.filter((item) => item.client_id !== clientId));
    setItemStudentQueries((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
  }

  function selectTemplate(index: number) {
    setSelectedTemplateIndex(index);
    setReplyText(replyTemplates[index] ?? "");
  }

  async function saveCurrentTemplate() {
    if (!replyText.trim()) { setCardMessage("保存する文案を入力してください。"); return; }
    setSavingTemplate(true);
    setCardMessage("");
    try {
      const nextTemplates = [...replyTemplates];
      nextTemplates[selectedTemplateIndex] = replyText.trim();
      await onReplyTemplatesChanged(nextTemplates);
      setCardMessage(`文案${selectedTemplateIndex + 1}を更新しました。`);
    } catch (error) { setCardMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSavingTemplate(false); }
  }

  async function save() {
    const firstItem = items[0];
    const response = await fetch(`/api/attendance/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_number: firstItem?.student_number || studentNumber,
        event_date: firstItem?.event_date || null,
        event_type: firstItem?.event_type || candidate.event_type,
        lesson_id: firstItem?.lesson_id || null,
        ai_summary: firstItem?.ai_summary?.trim() || fallbackReason(firstItem?.event_type || candidate.event_type),
        items: items.map((item) => ({
          id: item.id ?? null,
          student_number: item.student_number,
          event_type: item.event_type,
          event_date: item.event_date || null,
          lesson_id: item.lesson_id || null,
          suggested_subject: item.suggested_subject,
          suggested_class_name: item.suggested_class_name,
          ai_summary: item.ai_summary.trim() || fallbackReason(item.event_type),
          arrival_expected_time: item.arrival_expected_time.trim() || null,
          note_internal: item.note_internal.trim() || null,
          note_for_classroom: item.note_for_classroom.trim() || null,
          cross_campus_override: item.cross_campus_override,
          cross_campus_reason: item.cross_campus_reason.trim() || null,
        })),
      }),
    });
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "保存に失敗しました");
  }

  async function confirmCandidate() {
    if (!confirmedBy.trim()) { setCardMessage("画面上部の「確認者名」を入力してください。"); return; }
    const invalidStudent = items.find((item) => !item.student_number);
    if (invalidStudent) { setCardMessage("すべての登録行で名前を選択してください。"); return; }
    const invalid = items.find((item) => !item.event_date || !item.campus || !item.lesson_id || !item.ai_summary.trim());
    if (invalid) { setCardMessage("すべての登録行で、日付・校舎・授業・理由を入力してください。"); return; }
    const invalidCampus = items.find((item) => {
      const student = studentOptions.find((entry) => entry.student_number === item.student_number);
      const lesson = (lessonLists[item.event_date] ?? []).find((entry) => entry.id === item.lesson_id) ?? candidateLesson(candidate, item);
      const crossCampus = lessonIsCrossCampus(student, lesson, item.campus);
      return crossCampus && (!item.cross_campus_override || !item.cross_campus_reason.trim());
    });
    if (invalidCampus) { setCardMessage("別校舎の授業を選ぶ場合は、別校舎受講のチェックと理由が必要です。"); return; }
    setBusy(true);
    setCardMessage("Notionへ登録しています...");
    try {
      await save();
      const response = await fetch(`/api/attendance/candidates/${candidate.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed_by: confirmedBy }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Notion登録に失敗しました");
      setCardMessage(`${body.notion_page_ids?.length ?? 1}行をNotionへ登録しました。`);
      setMessage("Notionへ登録しました。");
      await onChanged();
    } catch (error) { setCardMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function sendReply() {
    if (hasSentReply && !additionalMessageMode) { setCardMessage("この欠席連絡にはLINEで送信済みです。"); return; }
    if (!confirmedBy.trim()) { setCardMessage("画面上部の「確認者名」を入力してください。"); return; }
    if (!replyText.trim()) { setCardMessage("返信文を入力してください。"); return; }
    const sendLabel = hasSentReply ? "別のメッセージ" : "LINE返信";
    if (!window.confirm(`${titleName} に${sendLabel}を送信します。よろしいですか？`)) return;
    setSending(true);
    setCardMessage("LINEへ送信しています...");
    try {
      const response = await fetch(`/api/attendance/candidates/${candidate.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: replyText, sent_by: confirmedBy, allow_additional: hasSentReply && additionalMessageMode }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.already_sent) {
          setAdditionalMessageMode(false);
          await onChanged();
        }
        throw new Error(
          body.line_delivered
            ? "LINE送信済みですが履歴保存に失敗しました。再送しないでください。"
            : body.line_delivery_unknown
              ? body.message ?? "LINEの送信結果を確認できません。再送せず、LINE管理画面で確認してください。"
              : body.message ?? body.error ?? "LINE送信に失敗しました",
        );
      }
      setCardMessage("LINEへ送信しました。");
      setMessage("LINEへ送信しました。");
      setAdditionalMessageMode(false);
      setReplyText(replyTemplates[0] ?? defaultReplyTemplates[0]);
      await onChanged();
    } catch (error) { setCardMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSending(false); }
  }

  async function dismiss() {
    if (!confirmedBy.trim()) { setCardMessage("画面上部の「確認者名」を入力してください。"); return; }
    if (!window.confirm("この候補を対応不要にしますか？")) return;
    setDismissing(true);
    setCardMessage("対応不要として処理しています...");
    try {
      const response = await fetch(`/api/attendance/candidates/${candidate.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed_by: confirmedBy }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "対応不要の処理に失敗しました");
      setCardMessage("対応不要として処理しました。");
      setMessage("対応不要として処理しました。");
      await onChanged();
    } catch (error) {
      setCardMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDismissing(false);
    }
  }

  async function copyReply() {
    try {
      await navigator.clipboard.writeText(replyText);
      setCardMessage("返信文案をコピーしました。");
    } catch {
      setCardMessage("コピーできませんでした。返信文を選択してコピーしてください。");
    }
  }

  function startAdditionalMessage() {
    setAdditionalMessageMode(true);
    setReplyText("");
    setCardMessage("");
  }

  const replyLocked = hasSentReply && !additionalMessageMode;

  return <section id={`attendance-candidate-${candidate.id}`} className="panel" style={{ padding: 14, borderColor: hasError ? "#fca5a5" : undefined, background: hasError ? "#fffafa" : undefined }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <strong style={{ fontSize: 17 }}>{titleName}</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <StatusBadge label="LINE返信" detail={replyDetail} kind={replyKind} />
          <StatusBadge label="Notion" detail={notionDetail} kind={notionKind} />
          {candidate.student_selection_required && <StatusBadge label="生徒確認" detail="要選択" kind="partial" />}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span style={{ color: closed ? "#087a3d" : "#666", fontSize: 13, fontWeight: 700 }}>{dismissed ? "対応不要 / " : registered ? "登録済み / " : ""}{items.length}行 / AI信頼度 {Math.round((candidate.ai_confidence ?? 0) * 100)}%</span>
        <button type="button" style={hasError ? dangerButtonStyle : closed ? ghostButtonStyle : buttonStyle} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "閉じる" : hasError ? "エラーを確認" : closed ? "内容を見る" : "対応する"}</button>
      </div>
    </div>
    <div style={{ color: "#4b5563", fontSize: 13, fontWeight: 700, marginTop: 9 }}>{receivedAtText}　{eventSummary}{items.length > 2 ? `　ほか${items.length - 2}行` : ""}</div>
    {!expanded && <div style={{ marginTop: 6, color: "#555", fontSize: 14, lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{candidate.line_messages?.text ?? "（本文なし）"}</div>}

    {expanded && <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 24, marginTop: 10 }}>
        {lineTagNames.length > 0 ? lineTagNames.map((tag) => <span key={tag} style={tagStyle}>{tag}</span>) : <span style={{ color: "#777", fontSize: 13 }}>LINEタグ未登録</span>}
      </div>

    <div style={{ color: "#666", fontSize: 13, fontWeight: 700, marginTop: 12 }}>受信日時: {receivedAtText}</div>
    <div style={{ margin: "6px 0 14px", padding: 14, background: "#f7f7f4", border: "1px solid var(--line)", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{candidate.line_messages?.text ?? "（本文なし）"}</div>
    <ReplyHistory replies={candidate.reply_messages ?? []} />

    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,1fr) minmax(180px,260px)", gap: 12, alignItems: "start", marginBottom: 16 }}>
      <label style={{ display: "grid", gap: 6 }}><span>{additionalMessageMode ? "別のメッセージ" : "返信文"}</span><textarea disabled={replyLocked} style={{ ...inputStyle, minHeight: 96, resize: "vertical", lineHeight: 1.6, background: replyLocked ? "#f7f7f4" : "white" }} value={replyText} onChange={(event) => setReplyText(event.target.value)} /></label>
      <div style={{ display: "grid", gap: 8 }}>
        <span style={{ fontSize: 13, color: "#555" }}>文案</span>
        {replyTemplates.map((template, index) => <button key={`${index}:${template}`} type="button" disabled={replyLocked} style={selectedTemplateIndex === index ? buttonStyle : ghostButtonStyle} onClick={() => selectTemplate(index)}>文案{index + 1}</button>)}
        <button type="button" style={ghostButtonStyle} disabled={savingTemplate || replyLocked} onClick={saveCurrentTemplate}>{savingTemplate ? "保存中..." : `文案${selectedTemplateIndex + 1}を更新`}</button>
        <button type="button" style={secondaryButtonStyle} disabled={replyLocked} onClick={copyReply}>コピー</button>
        {replyLocked ? <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <button type="button" style={{ ...buttonStyle, flex: 1, background: "#e8f5ec", borderColor: "#86c99a", color: "#087a3d", cursor: "default" }} disabled>LINEで送信済み</button>
          <button type="button" style={{ ...ghostButtonStyle, flex: 1 }} onClick={startAdditionalMessage}>別のメッセージを送る</button>
        </div> : <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <button type="button" style={{ ...dangerButtonStyle, flex: 1 }} disabled={sending} onClick={sendReply}>{sending ? "送信中..." : additionalMessageMode ? "別メッセージをLINEへ送信" : "LINEへ送信"}</button>
          {additionalMessageMode && <button type="button" style={ghostButtonStyle} disabled={sending} onClick={() => { setAdditionalMessageMode(false); setReplyText(replyTemplates[0] ?? defaultReplyTemplates[0]); setCardMessage(""); }}>やめる</button>}
        </div>}
      </div>
    </div>

    {candidate.student_selection_required && <div style={{ border: "1px solid #fed7aa", background: "#fff7ed", color: "#9a3412", borderRadius: 6, padding: 10, marginBottom: 12, fontWeight: 700 }}>{candidate.student_selection_reason ?? "兄弟姉妹の可能性があるため、名前を選択してください。"}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,280px) minmax(0,1fr) auto", gap: 12, marginBottom: 12, alignItems: "end" }}>
      <StudentPicker label="連絡した生徒" students={studentOptions} value={studentNumber} query={studentQuery} onQueryChange={setStudentQuery} onChange={selectStudent} candidates={suggestions} disabled={closed} />
      <label style={fieldStyle}>担任<div style={readonlyStyle}>{selectedStudent?.homeroom_teacher ?? "未設定"}</div></label>
      {!closed && <button type="button" style={ghostButtonStyle} disabled={linkingSender || !senderLineUserId || !studentNumber} onClick={linkSenderToSelectedStudent}>{linkingSender ? "登録中..." : "このLINEを保護者として登録"}</button>}
    </div>

    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong>Notion登録行</strong>
        {!closed && <button type="button" style={ghostButtonStyle} disabled={items.length >= 80} onClick={addItem}>行を追加</button>}
      </div>
      {items.map((item, index) => {
        const lessons = item.event_date ? lessonLists[item.event_date] ?? [] : [];
        const currentLesson = lessons.find((lesson) => lesson.id === item.lesson_id) ?? candidateLesson(candidate, item);
        const rowStudent = studentOptions.find((student) => student.student_number === item.student_number) ?? null;
        const crossCampus = lessonIsCrossCampus(rowStudent, currentLesson, item.campus);
        const filteredLessons = item.campus ? lessons.filter((lesson) => lesson.campus === item.campus) : lessons;
        const lessonGroups = lessonsByTime(filteredLessons);
        const rowClosed = closed || item.status === "confirmed";
        return <div key={item.client_id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, display: "grid", gap: 10, background: item.status === "confirmed" ? "#f2fbf5" : "white" }}>
          {item.status === "confirmed" && <div style={{ color: "#087a3d", fontWeight: 800 }}>この行はNotion登録済みです。未完了の行だけ再試行されます。</div>}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1.2fr) 110px 120px 130px minmax(220px,1fr) 42px", gap: 8, alignItems: "end" }}>
            <StudentPicker
              label="登録する生徒"
              students={studentOptions}
              value={item.student_number}
              query={itemStudentQueries[item.client_id] ?? ""}
              onQueryChange={(value) => setItemStudentQueries((current) => ({ ...current, [item.client_id]: value }))}
              onChange={(value) => {
                const student = studentOptions.find((entry) => entry.student_number === value);
                updateItem(item.client_id, { student_number: value, campus: selectableCampus(student?.campus), lesson_id: "", cross_campus_override: false, cross_campus_reason: "" });
              }}
              candidates={suggestions}
              disabled={rowClosed}
              changeLabel="別の生徒に変更"
            />
            <label style={fieldStyle}>日付<input style={inputStyle} type="date" value={item.event_date} disabled={rowClosed} onChange={(event) => updateItem(item.client_id, { event_date: event.target.value, lesson_id: "" })} /></label>
            <label style={fieldStyle}>種別<select style={inputStyle} value={item.event_type} disabled={rowClosed} onChange={(event) => updateItem(item.client_id, { event_type: event.target.value, ai_summary: !item.ai_summary.trim() || item.ai_summary === fallbackReason(item.event_type) ? fallbackReason(event.target.value) : item.ai_summary })}>{eventTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label style={fieldStyle}>校舎<select style={inputStyle} value={item.campus} disabled={rowClosed} onChange={(event) => updateItem(item.client_id, { campus: event.target.value, lesson_id: currentLesson?.campus === event.target.value ? item.lesson_id : "", cross_campus_override: false, cross_campus_reason: "" })}><option value="">要選択</option><option value="本校">本校</option><option value="南教室">南教室</option></select></label>
            <label style={fieldStyle}>理由<div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 8 }}><select style={inputStyle} value={reasonOptions.includes(item.ai_summary) ? item.ai_summary : ""} disabled={rowClosed} onChange={(event) => { if (event.target.value) updateItem(item.client_id, { ai_summary: event.target.value }); }}><option value="">直接入力</option>{reasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><input style={inputStyle} value={item.ai_summary} disabled={rowClosed} onChange={(event) => updateItem(item.client_id, { ai_summary: event.target.value })} placeholder="例：体調不良" /></div></label>
            <button type="button" style={{ ...ghostButtonStyle, height: 40, padding: 0 }} disabled={rowClosed || items.length <= 1} onClick={() => removeItem(item.client_id)}>削除</button>
          </div>
          {crossCampus && <div style={{ border: "1px solid #fdba74", background: "#fff7ed", borderRadius: 6, padding: 10, display: "grid", gap: 8 }}>
            <div style={{ color: "#9a3412", fontWeight: 800 }}>所属校舎は{rowStudent?.campus}、選択中の授業は{item.campus}です。</div>
            <label style={{ fontWeight: 800 }}><input type="checkbox" checked={item.cross_campus_override} disabled={rowClosed} onChange={(event) => updateItem(item.client_id, { cross_campus_override: event.target.checked })} /> 別校舎での振替・受講として登録する</label>
            <label style={fieldStyle}>別校舎受講の理由<input style={inputStyle} value={item.cross_campus_reason} disabled={rowClosed} onChange={(event) => updateItem(item.client_id, { cross_campus_reason: event.target.value })} placeholder="例：本日のみ南教室へ振替" /></label>
          </div>}
          
          <div style={{ color: "#666", fontSize: 13 }}>{index + 1}行目: {item.event_date || "日付未選択"} / {eventTypeLabel(item.event_type)} / {currentLesson?.label ?? "授業未選択"}</div>
          <div style={{ display: "grid", gap: 6 }}>
            {!item.event_date ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, color: "#777" }}>日付を指定すると、その日の授業がここに表示されます。</div> : lessonGroups.length === 0 ? <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, color: "#777" }}>{item.campus ? `${item.campus}の授業は見つかりませんでした。` : "この日の授業は見つかりませんでした。"}</div> : lessonGroups.map((group) => <div key={group.time} style={{ display: "grid", gridTemplateColumns: "72px minmax(0,1fr)", gap: 8, alignItems: "start" }}>
              <div style={{ color: "#555", fontSize: 13, fontWeight: 700, paddingTop: 8 }}>{group.time}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                {group.lessons.map((lesson) => {
                  const selected = lesson.id === item.lesson_id;
                  const enrolled = Boolean(lesson.enrolled);
                  return <button key={lesson.id} type="button" disabled={rowClosed} onClick={() => updateItem(item.client_id, { lesson_id: lesson.id, campus: lesson.campus ?? item.campus })} title={[lesson.campus, lesson.classroom && `${lesson.classroom}教室`, enrolled && "受講中"].filter(Boolean).join(" / ")} style={{ border: selected ? "2px solid var(--accent)" : enrolled ? "2px solid #16a34a" : "1px solid var(--line)", borderRadius: 6, padding: "7px 9px", background: selected ? "#ecfdf3" : enrolled ? "#f2fbf5" : "white", cursor: rowClosed ? "default" : "pointer", textAlign: "left", whiteSpace: "nowrap", maxWidth: "100%" }}>
                    <strong>{lesson.label}</strong>{lesson.classroom ? <span style={{ color: "#666", fontSize: 12 }}> / {lesson.classroom}教室</span> : null}{enrolled ? <span style={{ color: "#087a3d", fontSize: 12, fontWeight: 700 }}> / 受講中</span> : null}
                  </button>;
                })}
              </div>
            </div>)}
          </div>
        </div>;
      })}
    </div>

    {cardMessage && <p role="status" style={{ color: !cardMessage.includes("失敗") && (cardMessage.includes("登録しました") || cardMessage.includes("コピー") || cardMessage.includes("送信しました") || cardMessage.includes("更新しました") || cardMessage.includes("処理しました")) ? "#087a3d" : "#b42318", marginTop: 10, fontWeight: 700 }}>{cardMessage}</p>}
    {dismissed ? <div style={{ marginTop: 16, color: "#087a3d", fontWeight: 800 }}>対応不要として処理済みです。</div> : <div style={{ display: "flex", gap: 10, marginTop: 16 }}><button style={buttonStyle} disabled={busy || dismissing || registered} onClick={confirmCandidate}>{registered ? "Notion登録済み" : busy ? "登録中..." : registering ? "登録状態を確認・再試行" : "確認してNotionへ登録"}</button>{!registered && !registering && <button style={secondaryButtonStyle} disabled={busy || dismissing} onClick={dismiss}>{dismissing ? "処理中..." : "対応不要"}</button>}</div>}
    </>}
  </section>;
}
function ReplyHistory({ replies }: { replies: ReplyMessage[] }) {
  if (replies.length === 0) return null;
  return <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
    <strong>送信済み返信</strong>
    {replies.map((reply) => <div key={reply.id} style={{ border: "1px solid #b7d7c2", background: "#f2fbf5", borderRadius: 6, padding: 12 }}>
      <div style={{ color: "#087a3d", fontSize: 12, fontWeight: 800, marginBottom: 4 }}>{[reply.sent_by, formatStatusTime(reply.received_at)].filter(Boolean).join(" / ") || "送信履歴"}</div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{reply.text ?? "（本文なし）"}</div>
    </div>)}
  </div>;
}

