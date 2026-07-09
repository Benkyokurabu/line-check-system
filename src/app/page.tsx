import Link from "next/link";

export default function Home() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">LINE operations</p>
        <h1>LINE Check System</h1>
        <p>
          LINE公式アカウントの受信確認、先生別の対応管理、生徒一覧、クラス別送信を行う管理画面です。
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
          <Link href="/dashboard" style={linkButton}>未対応メッセージ</Link>
          <Link href="/students" style={linkButton}>担任・クラス別 生徒一覧</Link>
          <Link href="/contacts" style={linkButton}>連絡先管理</Link>
        </div>
      </section>
    </main>
  );
}

const linkButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "10px 14px",
  borderRadius: 6,
  background: "var(--accent)",
  color: "#fff",
  fontWeight: 700,
  fontSize: "0.9rem",
};
