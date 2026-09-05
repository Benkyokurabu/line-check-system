import StaffStudyRoom from "./staff-study-room";

export const dynamic = "force-dynamic";

export default function StaffStudyRoomPage() {
  if (process.env.STAFF_AUTH_ENABLED !== "true" || !process.env.STAFF_AUTH_ORIGIN) {
    return <main className="shell"><section className="panel"><p className="eyebrow">職員用</p>
      <h1>自習室の申請管理</h1><p>この機能は準備中です。予約の受付・承認運用はまだ開始していません。</p>
      <p>LINEでの現在の受付方法は変わりません。</p></section></main>;
  }
  return <StaffStudyRoom />;
}
