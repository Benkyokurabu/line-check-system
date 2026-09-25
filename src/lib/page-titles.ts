import type {Metadata} from 'next';

export const pageTitles:Record<string,string>={
 '/':'勉たん',
 '/attendance':'遅刻・欠席確認',
 '/classroom':'遅刻・欠席確認',
 '/classroom-office':'教室への連絡',
 '/dashboard':'未対応メッセージ',
 '/students':'生徒一覧',
 '/karte':'生徒カルテ',
 '/contacts':'連絡先管理',
 '/schedule-import':'授業スケジュール取込',
 '/line-alias-import':'LINE登録名の取り込み',
 '/feedback':'ご意見・ご要望',
 '/private-feedback':'ご意見の確認',
 '/unhandled-sample':'未対応案件サンプル',
 '/admin/notion-roster':'Notion・クラス一覧 照合',
 '/admin/self-study-room':'自習室管理',
 '/self-study-room':'自習室予約',
 '/self-study-room/trial':'自習室予約',
 '/self-study-room/menu-preview':'自習室予約',
 '/staff/self-study-room':'自習室の申請管理',
 '/staff/self-study-room/trial':'自習室の申請管理',
 '/staff/interviews':'面談の予定・入力',
 '/staff/interview-materials':'面談資料を作る',
 '/staff/interview-availability':'予約可能枠を作る',
 '/staff/interviews/trial':'面談予約の確認・承認',
 '/reservations/trial':'予約メニュー',
};

export function pageMetadata(title:string):Metadata{
 return {title:{absolute:title},applicationName:title,
  appleWebApp:{capable:true,statusBarStyle:'default',title},
  openGraph:{title},twitter:{title}};
}
