import HomeDashboard from "./home-dashboard";

const menuItems = [
  { href: "/attendance", group: "daily" as const, icon: "message", title: "欠席連絡の確認", description: "LINEから抽出した欠席候補を確認し、Notionへ登録します。" },
  { href: "/classroom-office", group: "daily" as const, icon: "message", title: "教室への連絡", description: "教室ごとの欠席・遅刻情報を確認し、事務部から教室へメッセージを出します。" },
  { href: "/staff/surveys", group: "interview" as const, icon: "file", title: "アンケートを確認する", description: "アンケートを選び、担当生徒の回答・対応状況を確認します。" },
  { href: "/staff/interview-materials", group: "interview" as const, icon: "calendar", title: "面談資料を作る", description: "面談日または生徒名から対象を選び、資料の確認・PDF作成・保存へ進みます。" },
  { href: "/staff/survey-workflow/post-interview", group: "interview" as const, icon: "file", trial: true, title: "面談後の一括入力", description: "本番運用前・工藤先生の確認用です。面談内容の入力から、記録・アンケートの対応・LINE連絡へ進みます。" },
  { href: "/staff/interview-availability", group: "interview" as const, icon: "calendar", title: "予約可能枠を作る", description: "毎月のスケジュール表から、自分の勤務校舎と空き時間を確認してNotionへ予約可を作成します。" },
  { href: "/staff/interview-availability/manual", group: "interview" as const, icon: "calendar", title: "予約可能枠をコピー", description: "先生と期間を選び、Notionの予約可を番号付きの日程一覧にしてコピーします。" },
  { href: "/staff/journals", group: "management" as const, icon: "file", title: "授業日誌の確認", description: "科目と校舎を選び、OneDriveの授業日誌をブラウザでまとめて開きます。" },
  { href: "/staff/recordings", group: "management" as const, icon: "calendar", title: "録画の公開設定", description: "単元テスト解説などの録画を、非公開・日時指定・今すぐ公開に設定します。" },
  { href: "/schedule-import", group: "management" as const, icon: "calendar", title: "授業スケジュール取込", description: "スケジュール原本と登録済み授業を照合し、追加・変更・休講候補を確認します。" },
  { href: "/contacts", group: "management" as const, icon: "users", title: "連絡先管理", description: "LINE名、登録名、グループを管理し、一斉送信の対象を整えます。" },
  { href: "/contacts#roster-import", group: "management" as const, icon: "file", title: "クラス一覧表の取り込み", description: "更新済みのクラス一覧Excelを確認し、変更分だけを取り込みます。" },
  { href: "/admin/notion-roster", group: "management" as const, icon: "sync", title: "Notion・クラス一覧 照合", description: "Notion生徒情報、クラス一覧Excel、アプリ側名簿の差分を確認して反映します。" },
  { href: "/line-alias-import", group: "management" as const, icon: "sync", title: "LINE登録名の取り込み", description: "LINE管理画面で入力した登録名を一覧確認し、編集してから一括反映します。" },
  { href: "/feedback", group: "management" as const, icon: "message", title: "改善してほしいことなど、何でも", description: "勉たんへのご意見・ご要望を送れます。送信内容は工藤だけが確認します。" },
  { href: "/staff/visit-followup", group: "prelaunch" as const, icon: "file", trial: true, title: "見学打合せ後の一括入力", description: "面談記録・生徒情報・受付・終業MTGへまとめて反映します。工藤先生の確認用です。" },
  { href: "/staff/parent-contact", group: "prelaunch" as const, icon: "file", trial: true, title: "面談記録記入", description: "見学打ち合わせ・面談・電話の実績を、OneDriveの業務記録簿へ入力します。工藤先生の確認用です。" },
  { href: "/staff/enrollment", group: "prelaunch" as const, icon: "file", trial: true, title: "入塾手続きの一括入力", description: "正式運用前の確認用です。一つの入力から各所へ反映し、判断できない項目を保留します。" },
  { href: "/staff/benkei", group: "prelaunch" as const, icon: "message", trial: true, title: "ベンケイ・共有連絡の確認", description: "共有連絡を読み、先生ごとの確認状況を確認します。工藤先生の確認用です。" },
  { href: "/staff/school-context", group: "prelaunch" as const, icon: "search", trial: true, title: "塾全体の情報・確認候補", description: "Notion・LINEの取得範囲と原文を確認し、根拠のある確認候補を判断します。工藤先生の確認用です。" },
  { href: "/staff/login-people", group: "prelaunch" as const, icon: "users", title: "ログインする人の管理", description: "先生ログインに表示する名前を確認し、新しく利用する人を追加します。" },
  { href: "/dashboard", group: "prelaunch" as const, icon: "message", title: "未対応メッセージ", description: "LINEで届いた未対応の連絡を先生別に確認し、返信・完了処理をします。" },
  { href: "/students", group: "prelaunch" as const, icon: "users", title: "担任・クラス別 生徒一覧", description: "担任生徒やクラス在籍生徒を一覧で確認し、選択した生徒へLINE送信します。" },
  { href: "/karte", group: "prelaunch" as const, icon: "file", title: "生徒カルテ", description: "Notion、LINE、クラス一覧Excelを生徒ごとにまとめ、経緯を確認します。" },
  { href: "/staff/self-study-room/trial", group: "prelaunch" as const, icon: "room", trial: true, title: "自習室管理", description: "職員による操作確認用。確認用の申請を承認・取消し、来室・退室を記録します。" },
  { href: "/self-study-room/trial", group: "prelaunch" as const, icon: "calendar", trial: true, title: "自習室予約", description: "生徒役の操作確認用。座席・時間帯を選んで申請し、承認結果を確認します。" },
];

export default function Home() {
  return <HomeDashboard items={menuItems} />;
}
