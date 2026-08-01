import Link from "next/link";

const menuItems = [
  {
    href: "/classroom-office",
    title: "教室への連絡",
    description: "教室ごとの欠席・遅刻情報を確認し、事務部から教室へメッセージを出します。",
  },
  {
    href: "/attendance",
    title: "欠席連絡の確認",
    description: "LINEから抽出した欠席候補を確認し、Notionへ登録します。",
  },
  {
    href: "/dashboard",
    title: "未対応メッセージ",
    description: "LINEで届いた未対応の連絡を先生別に確認し、返信・完了処理をします。",
  },
  {
    href: "/students",
    title: "担任・クラス別 生徒一覧",
    description: "担任生徒やクラス在籍生徒を一覧で確認し、選択した生徒へLINE送信します。",
  },
  {
    href: "/karte",
    title: "生徒カルテ",
    description: "Notion、LINE、クラス一覧Excelを生徒ごとにまとめ、経緯を確認します。",
  },
  {
    href: "/contacts",
    title: "連絡先管理",
    description: "LINE名、登録名、グループを管理し、一斉送信の対象を整えます。",
  },
  {
    href: "/admin/notion-roster",
    title: "Notion・クラス一覧 照合",
    description: "Notion生徒情報、クラス一覧Excel、アプリ側名簿の差分を確認して反映します。",
  },
  {
    href: "/line-alias-import",
    title: "LINE登録名の取り込み",
    description: "LINE管理画面で入力した登録名を一覧確認し、編集してから一括反映します。",
  },
];

export default function Home() {
  return (
    <main className="shell">
      <section>
        <p className="eyebrow">BENKYO KURABU Integrated Assistant System</p>
        <h1><span>勉たん（仮）</span> <span style={{ fontSize: "60%" }}>-勉強クラブ総合アシスたんトさん-</span></h1>
        <div className="home-menu">
          {menuItems.map((item) => (
            <Link key={item.href} href={item.href} className="home-menu-item">
              <span className="home-menu-title">{item.title}</span>
              <span className="home-menu-description">{item.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
