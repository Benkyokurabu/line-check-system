import Link from "next/link";

export default function SelfStudyRoomAdminPage() {
  return <main className="shell"><section className="panel">
    <p className="eyebrow">SELF STUDY ROOM ADMIN</p>
    <h1>自習室管理</h1>
    <p role="status">この管理画面は利用を終了しました。</p>
    <p>職員の方は、職員専用画面へ進んでください。</p>
    <Link href="/staff/self-study-room">職員専用画面へ</Link>
  </section></main>;
}
