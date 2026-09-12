export type InterviewSurveyStudent = { grade: string; name: string; notionUrl: string };
export type InterviewSurveyTeacherGroup = { teacher: string; students: InterviewSurveyStudent[] };

const rawGroups = [
  { teacher: "工藤", students: [
    ["小4", "澤田青弥", "3d9f012080a781c3b498d916ca4a3ea0"], ["小6", "山本美緒", "3d9f012080a7817e8235c19d9e5d6082"],
    ["小6", "柴田 茉侑", "3d9f012080a781549fdfe38bc29de130"], ["中1", "池田章吾", "3d9f012080a781979453fb101fd6f146"],
    ["中1", "佐々木優", "3d9f012080a781728ecff3e0fed8fd5a"], ["中1", "星歩花", "3d9f012080a7814c96aefa9776e00b30"],
    ["中1", "髙橋由乃", "3d9f012080a78191aa38fca047be9763"], ["中3", "木村美海", "3d9f012080a78113941fec70cdfd492e"],
  ] },
  { teacher: "金子", students: [
    ["小5", "関根心獅", "3d9f012080a781928dc5c8d6c0b3c108"], ["小6", "篠田紗羽", "3d9f012080a781f5ac01ec221fdafbfe"],
    ["小6", "井上莉乃", "3d9f012080a781cd8b16da6178696963"], ["小6", "細野醍", "3d9f012080a781339a1cdc4dd91777a0"],
    ["中1", "大竹 萌唯紗", "3d9f012080a7815798b1c2bf2b825c38"], ["中2", "大竹 愛実夏", "3d9f012080a7819d8b53f4c836849b42"],
    ["中2", "加藤 隼弥", "3d9f012080a781558dcbeb2428a1fce7"], ["中2", "細野華", "3d9f012080a781f287a1ffd86bf4fa2e"],
    ["中3", "小野 梨香", "3d9f012080a781e7bea7cfd7f9a250a5"],
  ] },
  { teacher: "鈴木", students: [
    ["中1", "小原夏歩", "3d9f012080a7815f9c18d7d88001e599"], ["中1", "大門 由莉香", "3d9f012080a781bb9289ef99565f8946"],
    ["中2", "村佐風雅", "3d9f012080a781fe9dc2eaf0d0f1f873"],
  ] },
  { teacher: "金城", students: [
    ["中2", "疋田莉結", "3d9f012080a78180a8c2c580d1e83165"], ["中3", "大久保伊織", "3d9f012080a781378d88c7be8eefc55d"],
    ["中3", "米倉遼汰朗", "3d9f012080a781e9b78ed920f0880c8a"], ["中3", "矢口幸典", "3d9f012080a78107b9a1e0d44db8c851"],
  ] },
  { teacher: "髙山", students: [
    ["中2", "山口結月", "3d9f012080a781f8b2def8260d67e94f"], ["中2", "阿部桃香", "3d9f012080a781aa91fff6a473cf2ab6"],
    ["中3", "江川莉子", "3d9f012080a78178b2a3e2cc466c8188"], ["中3", "熊谷悠希", "3d9f012080a781fa9cc4eea37dd2ad2e"],
    ["中3", "秋吉愛香", "3d9f012080a781f99025d475249a3cc1"],
  ] },
] satisfies Array<{ teacher: string; students: string[][] }>;

// 2026-09-12 evening snapshot. The confirmation button is intentionally display-only.
export const interviewSurveyGroups: InterviewSurveyTeacherGroup[] = rawGroups.map((group) => ({
  teacher: group.teacher,
  students: group.students.map(([grade, name, pageId]) => ({
    grade,
    name,
    notionUrl: `https://app.notion.com/p/${pageId}`,
  })),
}));
