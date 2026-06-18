export default function Home() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">MVP foundation</p>
        <h1>LINE Check System</h1>
        <p>
          学習塾のLINE公式アカウントに届くメッセージをWebhookで受け取り、
          Supabaseへ保存するためのNext.js App Routerプロジェクトです。
        </p>
        <ul>
          <li>Next.js + TypeScript</li>
          <li>Supabase client ready</li>
          <li>Future route: POST /api/line/webhook</li>
          <li>Vercel deployment ready</li>
        </ul>
      </section>
    </main>
  );
}
