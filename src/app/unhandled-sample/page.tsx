const sampleThreads = [
  {
    id: "thread-1",
    displayName: "本 深井優希 母",
    lineName: "深井優里",
    receivedAt: "今日 15:15",
    latestText: "今日は欠席します。あと数学の宿題について田中先生に確認お願いします。",
    items: [
      { id: "a1", category: "欠席連絡", assignee: "受付", status: "未対応", handledBy: "-", priority: "高", summary: "本日の授業を欠席", action: "欠席登録へ", tone: "absence" },
      { id: "a2", category: "先生確認", assignee: "田中", status: "未対応", handledBy: "-", priority: "中", summary: "数学の宿題について確認", action: "返信する", tone: "teacher" },
    ],
  },
  {
    id: "thread-2",
    displayName: "南 山田竜大 母",
    lineName: "Ryudai",
    receivedAt: "今日 14:42",
    latestText: "数学は鈴木先生に、英語は金城先生に確認お願いします。オンラインで受けたいです。",
    items: [
      { id: "b1", category: "先生確認", assignee: "鈴木", status: "対応中", handledBy: "鈴木 14:50", priority: "中", summary: "数学について確認", action: "詳細", tone: "teacher" },
      { id: "b2", category: "先生確認", assignee: "金城", status: "未対応", handledBy: "-", priority: "中", summary: "英語について確認", action: "返信する", tone: "teacher" },
      { id: "b3", category: "受講方法", assignee: "事務", status: "未対応", handledBy: "-", priority: "低", summary: "オンライン受講希望", action: "確認", tone: "office" },
    ],
  },
  {
    id: "thread-3",
    displayName: "本 伊原さくら 母",
    lineName: "いはらるみ",
    receivedAt: "昨日 19:08",
    latestText: "熱があるため明日と明後日の英語をお休みします。振替も相談したいです。",
    items: [
      { id: "c1", category: "欠席連絡", assignee: "受付", status: "未対応", handledBy: "-", priority: "高", summary: "明日・明後日の英語を欠席", action: "欠席登録へ", tone: "absence" },
      { id: "c2", category: "振替相談", assignee: "事務", status: "未対応", handledBy: "-", priority: "中", summary: "振替日程の相談", action: "候補確認", tone: "office" },
    ],
  },
];

const tabs = ["全体", "受付", "事務", "田中", "鈴木", "金城", "欠席連絡"];

function toneStyle(tone: string) {
  if (tone === "absence") return { border: "#16a34a", bg: "#f2fbf5", text: "#087a3d" };
  if (tone === "office") return { border: "#2563eb", bg: "#eff6ff", text: "#1d4ed8" };
  return { border: "#f59e0b", bg: "#fffbeb", text: "#b45309" };
}

function statusStyle(status: string) {
  if (status === "対応中") return { background: "#fff7ed", color: "#c2410c", border: "#fed7aa" };
  return { background: "#fef2f2", color: "#b42318", border: "#fecaca" };
}

const buttonStyle = {
  border: 0,
  borderRadius: 6,
  padding: "9px 12px",
  background: "var(--accent)",
  color: "white",
  fontWeight: 700,
  cursor: "default",
} as const;

const ghostButton = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "8px 11px",
  background: "white",
  color: "#222",
  fontWeight: 700,
  cursor: "default",
} as const;

export default function UnhandledSamplePage() {
  const itemCount = sampleThreads.reduce((sum, thread) => sum + thread.items.length, 0);
  return <main className="shell" style={{ maxWidth: 1180 }}>
    <p className="eyebrow">Prototype / No data changes</p>
    <h1 style={{ fontSize: "2rem" }}>未対応案件 サンプル</h1>
    <p>これは検証用の画面です。最初に先生を選ばず、全員が全体の状態を見られる想定です。完了操作の時だけ、誰が対応したかを記録します。</p>

    <section className="panel" style={{ padding: 16, marginTop: 18, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabs.map((tab, index) => <button key={tab} style={index === 0 ? buttonStyle : ghostButton}>{tab}<span style={{ marginLeft: 6, opacity: 0.75 }}>{index === 0 ? itemCount : index === 1 ? 2 : index === 2 ? 2 : 1}</span></button>)}
        </div>
        <div style={{ color: "#59635e", fontSize: 13, fontWeight: 700 }}>未対応案件 {itemCount}件 / メッセージ {sampleThreads.length}件</div>
      </div>
    </section>

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 14, marginTop: 16, alignItems: "start" }}>
      <section style={{ display: "grid", gap: 12 }}>
        {sampleThreads.map((thread) => <article key={thread.id} className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <header style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
              <strong style={{ fontSize: 18 }}>{thread.displayName}（{thread.lineName}）</strong>
              <span style={{ color: "#59635e", fontSize: 13, fontWeight: 700 }}>{thread.receivedAt}</span>
            </div>
            <div style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 6, background: "#f7f7f4", lineHeight: 1.65 }}>{thread.latestText}</div>
          </header>

          <div style={{ display: "grid", gap: 8, padding: 12 }}>
            {thread.items.map((item) => {
              const tone = toneStyle(item.tone);
              const status = statusStyle(item.status);
              return <div key={item.id} style={{ border: `1px solid ${tone.border}`, borderLeft: `5px solid ${tone.border}`, borderRadius: 6, padding: 12, background: tone.bg, display: "grid", gridTemplateColumns: "120px 90px minmax(0,1fr) 120px 90px 120px", gap: 10, alignItems: "center" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <span style={{ color: tone.text, fontWeight: 800 }}>{item.category}</span>
                  <span style={{ color: "#59635e", fontSize: 12 }}>優先度: {item.priority}</span>
                </div>
                <div style={{ fontWeight: 800 }}>{item.assignee}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, wordBreak: "break-word" }}>{item.summary}</div>
                  <div style={{ color: "#59635e", fontSize: 12, marginTop: 3 }}>この行だけ完了しても、同じメッセージ内の他案件は残ります。</div>
                </div>
                <div style={{ color: "#59635e", fontSize: 12, fontWeight: 700 }}>対応: {item.handledBy}</div><span style={{ justifySelf: "start", border: `1px solid ${status.border}`, background: status.background, color: status.color, borderRadius: 999, padding: "4px 9px", fontSize: 12, fontWeight: 800 }}>{item.status}</span>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button style={ghostButton}>{item.action}</button>
                  <button style={{ ...buttonStyle, padding: "8px 10px" }}>完了</button>
                </div>
              </div>;
            })}
          </div>
        </article>)}
      </section>

      <aside className="panel" style={{ padding: 16, position: "sticky", top: 16, display: "grid", gap: 14 }}>
        <strong>このUIで防ぐこと</strong>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10 }}>
            <strong>1通に複数用件</strong>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>欠席と先生確認を別々の案件として残します。</p>
          </div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10 }}>
            <strong>先生が複数</strong>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>鈴木先生分を完了しても金城先生分は残ります。</p>
          </div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10 }}>
            <strong>全体完了</strong>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>全案件が完了した時だけ、元メッセージ全体を完了扱いにします。</p>
          </div>
        </div>
      </aside>
    </div>
  </main>;
}

