export default function Home() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">LINE operations MVP</p>
        <h1>LINE Check System</h1>
        <p>
          学習塾のLINE公式アカウントに届いたメッセージを保存し、
          AIで担当候補の先生を判定してTeamsへ通知するNext.js App Routerプロジェクトです。
        </p>
        <ul>
          <li>SupabaseへLINE受信メッセージを保存</li>
          <li>AIで先生候補・信頼度・理由を記録</li>
          <li>Teams通知キューと送信API</li>
          <li>Webhook route: POST /api/line/webhook</li>
          <li>Vercel Cron ready</li>
        </ul>
      </section>
    </main>
  );
}
