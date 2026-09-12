export type InterviewSurveyStudent = { grade: string; name: string; notionUrl: string; submittedAt: string };
export type InterviewSurveyTeacherGroup = { teacher: string; students: InterviewSurveyStudent[] };

const rawGroups = [
  { teacher: "工藤", students: [
    ["小4", "澤田青弥", "3d9f012080a781c3b498d916ca4a3ea0", "2026-09-12T01:14:00.000Z"],
    ["小6", "柴田 茉侑", "3d9f012080a781549fdfe38bc29de130", "2026-09-12T01:28:00.000Z"],
    ["小6", "山本美緒", "3d9f012080a7817e8235c19d9e5d6082", "2026-09-12T04:26:00.000Z"],
    ["中1", "髙橋由乃", "3d9f012080a78191aa38fca047be9763", "2026-09-12T06:00:00.000Z"],
    ["中3", "木村美海", "3d9f012080a78113941fec70cdfd492e", "2026-09-12T06:05:00.000Z"],
    ["中1", "星歩花", "3d9f012080a7814c96aefa9776e00b30", "2026-09-12T07:28:00.000Z"],
    ["中1", "池田章吾", "3d9f012080a781979453fb101fd6f146", "2026-09-12T08:35:00.000Z"],
    ["中1", "佐々木優", "3d9f012080a781728ecff3e0fed8fd5a", "2026-09-12T08:35:00.000Z"],
  ] },
  { teacher: "金子", students: [
    ["小5", "関根心獅", "3d9f012080a781928dc5c8d6c0b3c108", "2026-09-12T01:16:00.000Z"],
    ["中3", "小野 梨香", "3d9f012080a781e7bea7cfd7f9a250a5", "2026-09-12T01:48:00.000Z"],
    ["小6", "細野醍", "3d9f012080a781339a1cdc4dd91777a0", "2026-09-12T02:53:00.000Z"],
    ["中2", "細野華", "3d9f012080a781f287a1ffd86bf4fa2e", "2026-09-12T03:00:00.000Z"],
    ["小6", "井上莉乃", "3d9f012080a781cd8b16da6178696963", "2026-09-12T04:01:00.000Z"],
    ["小6", "篠田紗羽", "3d9f012080a781f5ac01ec221fdafbfe", "2026-09-12T04:13:00.000Z"],
    ["中2", "加藤 隼弥", "3d9f012080a781558dcbeb2428a1fce7", "2026-09-12T07:27:00.000Z"],
    ["中1", "大竹 萌唯紗", "3d9f012080a7815798b1c2bf2b825c38", "2026-09-12T07:59:00.000Z"],
    ["中2", "大竹 愛実夏", "3d9f012080a7819d8b53f4c836849b42", "2026-09-12T08:10:00.000Z"],
  ] },
  { teacher: "鈴木", students: [
    ["中1", "大門 由莉香", "3d9f012080a781bb9289ef99565f8946", "2026-09-12T01:40:00.000Z"],
    ["中1", "小原夏歩", "3d9f012080a7815f9c18d7d88001e599", "2026-09-12T02:08:00.000Z"],
    ["中2", "村佐風雅", "3d9f012080a781fe9dc2eaf0d0f1f873", "2026-09-12T09:12:00.000Z"],
    ["中1", "江藤 直生", "3d9f012080a781a0a2bee074ce308ea5", "2026-09-12T09:20:00.000Z"],
  ] },
  { teacher: "金城", students: [
    ["中3", "矢口幸典", "3d9f012080a78107b9a1e0d44db8c851", "2026-09-12T06:25:00.000Z"],
    ["中3", "米倉遼汰朗", "3d9f012080a781e9b78ed920f0880c8a", "2026-09-12T07:15:00.000Z"],
    ["中3", "大久保伊織", "3d9f012080a781378d88c7be8eefc55d", "2026-09-12T07:54:00.000Z"],
    ["中2", "疋田莉結", "3d9f012080a78180a8c2c580d1e83165", "2026-09-12T08:12:00.000Z"],
  ] },
  { teacher: "髙山", students: [
    ["中2", "阿部桃香", "3d9f012080a781aa91fff6a473cf2ab6", "2026-09-12T01:42:00.000Z"],
    ["中2", "山口結月", "3d9f012080a781f8b2def8260d67e94f", "2026-09-12T01:46:00.000Z"],
    ["中3", "秋吉愛香", "3d9f012080a781f99025d475249a3cc1", "2026-09-12T02:04:00.000Z"],
    ["中3", "熊谷悠希", "3d9f012080a781fa9cc4eea37dd2ad2e", "2026-09-12T03:18:00.000Z"],
    ["中3", "江川莉子", "3d9f012080a78178b2a3e2cc466c8188", "2026-09-12T08:00:00.000Z"],
  ] },
  { teacher: "担任未特定", students: [
    ["中2", "松本稜大", "3d9f012080a7818da35fe494f4be61a9", "2026-09-12T09:28:00.000Z"],
  ] },
] satisfies Array<{ teacher: string; students: string[][] }>;

// Latest known snapshot used before the user explicitly refreshes from Notion.
export const interviewSurveyGroups: InterviewSurveyTeacherGroup[] = rawGroups.map((group) => ({
  teacher: group.teacher,
  students: group.students.map(([grade, name, pageId, submittedAt]) => ({
    grade,
    name,
    notionUrl: `https://app.notion.com/p/${pageId}`,
    submittedAt,
  })),
}));
