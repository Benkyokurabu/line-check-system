"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const CURRENT_TEACHER_KEY = "line-check:current-teacher";

type StudentSummary = {
  student_number: string;
  grade: string;
  student_name: string;
  homeroom_teacher: string;
  campus: string | null;
  gender: string | null;
  line_user_id: string | null;
  line_message_count: number;
  interaction_count: number;
  survey_count: number;
};

type Message = {
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
  subject: string;
  class_name: string;
  classroom: string | null;
  source_file: string | null;
};

type Interaction = {
  id: string;
  title: string;
  interaction_date: string | null;
  method: string | null;
  purposes: string[];
  staff_name: string | null;
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
};

type TimelineItem = {
  id: string;
  kind: "line" | "interaction" | "survey";
  occurred_at: string | null;
  title: string;
  summary: string;
  meta: string | null;
};

type KarteDetail = {
  student: StudentSummary & { source_file: string | null; updated_at: string };
  line_user_id: string | null;
  classes: ClassEnrollment[];
  messages: Message[];
  interactions: Interaction[];
  surveys: Survey[];
  timeline: TimelineItem[];
};

export default function KartePage() {
  const [query, setQuery] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [selectedCampus, setSelectedCampus] = useState("");
  const [selectedGrade, setSelectedGrade] = useState("");
  const [teacherOptions, setTeacherOptions] = useState<string[]>([]);
  const [campusOptions, setCampusOptions] = useState<string[]>([]);
  const [gradeOptions, setGradeOptions] = useState<string[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [detail, setDetail] = useState<KarteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "line" | "interactions" | "surveys">("timeline");
  const [actor, setActor] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActor(window.localStorage.getItem(CURRENT_TEACHER_KEY) ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadStudents = useCallback(async (search: string, teacher: string, campus: string, grade: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: search, limit: "200" });
      if (teacher) params.set("teacher", teacher);
      if (campus) params.set("campus", campus);
      if (grade) params.set("grade", grade);
      const res = await fetch(`/api/karte/students?${params.toString()}`);
      const data = await res.json();
      setStudents(data.students ?? []);
      setTeacherOptions(data.teachers ?? []);
      setCampusOptions(data.campuses ?? []);
      setGradeOptions(data.grades ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStudents(query, selectedTeacher, selectedCampus, selectedGrade);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadStudents, query, selectedTeacher, selectedCampus, selectedGrade]);

  async function openStudent(studentNumber: string) {
    setSelectedNumber(studentNumber);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/karte/students/${encodeURIComponent(studentNumber)}?actor=${encodeURIComponent(actor)}`);
      const data = await res.json();
      setDetail(data);
      setActiveTab("timeline");
    } finally {
      setDetailLoading(false);
    }
  }

  const selected = detail?.student ?? students.find((student) => student.student_number === selectedNumber);

  return (
    <main className="shell" style={{ maxWidth: 1240 }}>
      <div style={pageHeader}>
        <div>
          <p className="eyebrow">Student Karte</p>
          <h1 style={{ fontSize: "1.75rem", marginBottom: 6 }}>生徒カルテ</h1>
          <p style={{ fontSize: "0.9rem" }}>
            Notion、LINE、クラス一覧Excelを生徒ごとに集約します。初版は使いながら直せるよう、表示ブロックと同期元を分離しています。
          </p>
        </div>
        <Link href="/students" style={ghostLink}>担任・クラス別一覧</Link>
      </div>

      <section className="panel" style={policyPanel}>
        <Policy title="初版の範囲" text="生徒基本情報、クラス一覧Excel由来の受講情報、LINE履歴、Notion同期後の面談・アンケートを表示。" />
        <Policy title="後回し" text="HDD全体検索、添付全文検索、AI要約、Notion逆同期、LINE自動返信。" />
        <Policy title="本番で必須" text="権限、同期ログ、閲覧監査ログ、手動名寄せキュー。スキーマは拡張済み。" />
      </section>

      <div style={layoutGrid}>
        <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <div style={listHeader}>
            <h2 style={sectionTitle}>生徒検索</h2>
            <div style={filterSelectGrid}>
              <select value={selectedCampus} onChange={(event) => setSelectedCampus(event.target.value)} style={inputStyle} aria-label="校舎で絞り込み">
                <option value="">校舎すべて</option>
                {campusOptions.map((campus) => <option key={campus} value={campus}>{campus}</option>)}
              </select>
              <select value={selectedGrade} onChange={(event) => setSelectedGrade(event.target.value)} style={inputStyle} aria-label="学年で絞り込み">
                <option value="">学年すべて</option>
                {gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
              </select>
            </div>
            <div style={filterGrid}>
              <select value={selectedTeacher} onChange={(event) => setSelectedTeacher(event.target.value)} style={inputStyle} aria-label="担任で絞り込み">
                <option value="">担任すべて</option>
                {teacherOptions.map((teacher) => <option key={teacher} value={teacher}>{teacher}</option>)}
              </select>
              {actor ? <button type="button" onClick={() => setSelectedTeacher(actor)} style={filterButton}>自分の担任</button> : null}
            </div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="氏名・学籍番号で検索" style={inputStyle} />
            <p style={mutedLine}>{filterSummary(selectedCampus, selectedGrade, selectedTeacher)} / 表示 {students.length}件</p>
          </div>
          <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
            {loading ? <p style={{ padding: 18 }}>読み込み中...</p> : students.length === 0 ? <p style={{ padding: 18 }}>該当する生徒がいません。</p> : students.map((student) => (
              <button key={student.student_number} onClick={() => openStudent(student.student_number)} style={{ ...studentButton, background: selectedNumber === student.student_number ? "#ecfdf3" : "var(--surface)" }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <strong>{student.student_name}</strong>
                  <span style={mutedMono}>{student.student_number}</span>
                </span>
                <span style={mutedLine}>{student.grade} / {student.campus ?? "校舎未設定"} / 担任 {student.homeroom_teacher}</span>
                <span style={badgeRow}>
                  <Badge label={`LINE ${student.line_message_count}`} tone={student.line_user_id ? "green" : "gray"} />
                  <Badge label={`面談 ${student.interaction_count}`} tone="blue" />
                  <Badge label={`アンケート ${student.survey_count}`} tone="orange" />
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
          {!selectedNumber ? <EmptyState /> : detailLoading ? <p style={{ padding: 24 }}>カルテを読み込み中...</p> : !selected ? <p style={{ padding: 24 }}>生徒情報を取得できませんでした。</p> : (
            <>
              <div style={karteHeader}>
                <div>
                  <h2 style={{ fontSize: "1.3rem", marginBottom: 4 }}>{selected.student_name}</h2>
                  <p style={{ fontSize: "0.86rem" }}>{selected.student_number} / {selected.grade} / {selected.campus ?? "校舎未設定"} / 担任 {selected.homeroom_teacher}</p>
                </div>
                <div style={headerBadges}>
                  <Badge label={detail?.line_user_id ? "LINE紐づけ済み" : "LINE未紐づけ"} tone={detail?.line_user_id ? "green" : "gray"} />
                  <Badge label="Notion正本" tone="blue" />
                  <Badge label="Excelクラス参照" tone="orange" />
                </div>
              </div>

              <div style={summaryGrid}>
                <InfoBlock title="基本情報" rows={[["状態", "Notion同期後に表示"], ["性別", selected.gender ?? "未設定"], ["更新元", detail?.student.source_file ?? "クラス一覧Excel/Notion"]]} />
                <InfoBlock title="受講・クラス" rows={(detail?.classes ?? []).length > 0 ? detail!.classes.slice(0, 4).map((item) => [item.subject, `${item.class_name}${item.classroom ? ` / ${item.classroom}` : ""}`]) : [["クラス", "未同期または未登録"]]} />
                <InfoBlock title="運用メモ" rows={[["設計", "表示ブロック分離"], ["名寄せ", "学籍番号優先・手動修正前提"], ["監査", "カルテ閲覧を記録"]]} />
              </div>

              <div style={tabBar}>
                <Tab active={activeTab === "timeline"} onClick={() => setActiveTab("timeline")} label="経緯" />
                <Tab active={activeTab === "line"} onClick={() => setActiveTab("line")} label="LINE" />
                <Tab active={activeTab === "interactions"} onClick={() => setActiveTab("interactions")} label="面談" />
                <Tab active={activeTab === "surveys"} onClick={() => setActiveTab("surveys")} label="アンケート" />
              </div>

              <div style={{ padding: 16 }}>
                {activeTab === "timeline" && <Timeline items={detail?.timeline ?? []} />}
                {activeTab === "line" && <LinePanel messages={detail?.messages ?? []} linked={Boolean(detail?.line_user_id)} />}
                {activeTab === "interactions" && <InteractionPanel interactions={detail?.interactions ?? []} />}
                {activeTab === "surveys" && <SurveyPanel surveys={detail?.surveys ?? []} />}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Policy({ title, text }: { title: string; text: string }) {
  return <div><strong>{title}</strong><p style={smallText}>{text}</p></div>;
}

function EmptyState() {
  return <div style={{ padding: 28 }}><h2 style={{ fontSize: "1.15rem", marginBottom: 8 }}>左から生徒を選択してください</h2><p style={{ fontSize: "0.9rem" }}>現在のクラス一覧・LINE履歴に加えて、Notion同期テーブルに入った面談・アンケートを同じ画面で確認できます。</p></div>;
}

function InfoBlock({ title, rows }: { title: string; rows: string[][] }) {
  return <div style={infoBlock}><h3 style={{ fontSize: "0.9rem", marginBottom: 10 }}>{title}</h3><div style={{ display: "grid", gap: 7 }}>{rows.map(([label, value]) => <div key={label} style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: 8, fontSize: "0.82rem" }}><span style={{ color: "var(--muted)" }}>{label}</span><span>{value}</span></div>)}</div></div>;
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return <p>LINE・面談・アンケートの履歴はまだありません。</p>;
  return <div style={{ display: "grid", gap: 10 }}>{items.map((item) => <div key={item.id} style={timelineItem}><Badge label={kindLabel(item.kind)} tone={kindTone(item.kind)} /><div style={{ minWidth: 0 }}><div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}><strong>{item.title}</strong><span style={mutedLine}>{item.occurred_at ? formatDate(item.occurred_at) : "日時未設定"}</span></div>{item.summary && <p style={{ ...smallText, marginTop: 2 }}>{item.summary}</p>}</div></div>)}</div>;
}

function LinePanel({ messages, linked }: { messages: Message[]; linked: boolean }) {
  if (!linked) return <p>LINEユーザーがまだ紐づいていません。手動紐づけ画面で確認してください。</p>;
  if (messages.length === 0) return <p>LINE履歴はありません。</p>;
  return <div style={{ display: "grid", gap: 10 }}>{messages.map((message) => <div key={message.id} style={{ ...recordCard, marginLeft: message.direction === "outbound" ? 34 : 0 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5 }}><strong>{message.direction === "inbound" ? "受信" : "送信"}</strong><span style={mutedLine}>{formatDate(message.received_at ?? message.created_at)}</span></div><p style={smallText}>{message.text ?? `(${message.message_type})`}</p>{message.sent_by && <span style={mutedLine}>送信者: {message.sent_by}</span>}</div>)}</div>;
}

function InteractionPanel({ interactions }: { interactions: Interaction[] }) {
  if (interactions.length === 0) return <p>面談・対応履歴は未同期または未登録です。</p>;
  return <div style={{ display: "grid", gap: 10 }}>{interactions.map((item) => <div key={item.id} style={recordCard}><div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5 }}><strong>{item.title}</strong><span style={mutedLine}>{item.interaction_date ? formatDate(item.interaction_date) : "日時未設定"}</span></div><p style={smallText}>{[item.method, ...item.purposes].filter(Boolean).join(" / ") || "種別未設定"}</p><span style={mutedLine}>{item.staff_name ? `記入者: ${item.staff_name}` : "記入者未設定"}{item.attachment_count > 0 ? ` / 添付 ${item.attachment_count}件` : ""}</span></div>)}</div>;
}

function SurveyPanel({ surveys }: { surveys: Survey[] }) {
  if (surveys.length === 0) return <p>アンケートは未同期または未紐づけです。未紐づけキューで確認してください。</p>;
  return <div style={{ display: "grid", gap: 10 }}>{surveys.map((survey) => <div key={survey.id} style={recordCard}><div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5 }}><strong>{survey.source_name}</strong><span style={mutedLine}>{survey.answered_at ? formatDate(survey.answered_at) : "回答日時未設定"}</span></div><p style={smallText}>{[survey.subject, survey.school_year, survey.round_label, survey.grade, survey.campus].filter(Boolean).join(" / ") || "分類未設定"}</p><span style={mutedLine}>紐づけ: {survey.link_status ?? "未設定"} / 対応: {survey.follow_status ?? "未設定"}</span></div>)}</div>;
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button onClick={onClick} style={active ? activeTabButton : tabButton}>{label}</button>;
}

function Badge({ label, tone }: { label: string; tone: "green" | "blue" | "orange" | "gray" }) {
  const style = { green: { background: "#dcfce7", color: "#166534" }, blue: { background: "#e0f2fe", color: "#075985" }, orange: { background: "#ffedd5", color: "#9a3412" }, gray: { background: "#f1f5f9", color: "#475569" } }[tone];
  return <span style={{ ...style, borderRadius: 999, padding: "3px 8px", fontSize: "0.73rem", fontWeight: 700 }}>{label}</span>;
}

function kindLabel(kind: TimelineItem["kind"]) { return { line: "LINE", interaction: "面談", survey: "アンケート" }[kind]; }
function kindTone(kind: TimelineItem["kind"]) { return ({ line: "green", interaction: "blue", survey: "orange" } as const)[kind]; }
function formatDate(iso: string) { return new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function filterSummary(campus: string, grade: string, teacher: string) {
  const parts = [campus && "校舎 " + campus, grade && "学年 " + grade, teacher && "担任 " + teacher].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") + " で絞り込み中" : "校舎・学年・担任を選ぶと対象生徒だけに絞れます";
}

const pageHeader: React.CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, marginBottom: 18 };
const ghostLink: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", fontSize: "0.85rem", fontWeight: 700, flexShrink: 0 };
const policyPanel: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, padding: 16, marginBottom: 16 };
const layoutGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "360px minmax(0, 1fr)", gap: 16, alignItems: "start" };
const listHeader: React.CSSProperties = { padding: 14, borderBottom: "1px solid var(--line)", display: "grid", gap: 10, background: "var(--background)" };
const sectionTitle: React.CSSProperties = { fontSize: "1rem", fontWeight: 700 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--foreground)", fontSize: "0.88rem" };
const filterSelectGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, alignItems: "center" };
const filterGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" };
const filterButton: React.CSSProperties = { padding: "9px 10px", borderRadius: 6, border: "1px solid var(--accent)", background: "#ecfdf3", color: "var(--accent)", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const studentButton: React.CSSProperties = { width: "100%", display: "grid", gap: 5, padding: 13, border: "none", borderBottom: "1px solid var(--line)", color: "var(--foreground)", textAlign: "left", cursor: "pointer" };
const mutedLine: React.CSSProperties = { color: "var(--muted)", fontSize: "0.78rem" };
const mutedMono: React.CSSProperties = { ...mutedLine, fontFamily: "Consolas, monospace" };
const badgeRow: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 5 };
const karteHeader: React.CSSProperties = { padding: 18, borderBottom: "1px solid var(--line)", background: "var(--background)", display: "flex", justifyContent: "space-between", gap: 16 };
const headerBadges: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignContent: "flex-start", justifyContent: "flex-end", gap: 6 };
const summaryGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, padding: 16, borderBottom: "1px solid var(--line)" };
const infoBlock: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, padding: 12, background: "var(--surface)" };
const tabBar: React.CSSProperties = { display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" };
const tabButton: React.CSSProperties = { padding: "7px 12px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--foreground)", cursor: "pointer", fontSize: "0.85rem" };
const activeTabButton: React.CSSProperties = { ...tabButton, background: "var(--accent)", border: "1px solid var(--accent)", color: "#fff", fontWeight: 700 };
const timelineItem: React.CSSProperties = { display: "grid", gridTemplateColumns: "88px minmax(0, 1fr)", gap: 12, alignItems: "start", border: "1px solid var(--line)", borderRadius: 8, padding: 12 };
const recordCard: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, padding: 12, background: "var(--surface)" };
const smallText: React.CSSProperties = { color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.65 };










