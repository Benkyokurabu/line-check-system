import { normalizeCampus } from "./attendance-campus-consistency.mjs";

export function isXClassLesson(lesson) {
  const className = lesson?.source_payload?.class ?? lesson?.class_name;
  return String(className ?? "").normalize("NFKC").trim().toUpperCase() === "X";
}

export function notionPropertyText(property) {
  if (!property || typeof property !== "object") return null;
  if (property.type === "select") return property.select?.name ?? null;
  const items = property[property.type];
  if (!Array.isArray(items)) return null;
  return items.map((item) => item?.plain_text ?? item?.text?.content ?? "").join("").trim() || null;
}

export function chooseXClassNotionPage(pages, { campusPropertyName, lessonPropertyName, campus, lessonName }) {
  const targetCampus = normalizeCampus(campus);
  if (!targetCampus || !campusPropertyName || !lessonPropertyName) {
    throw new Error("XクラスのNotion登録には配信元校舎と授業・校舎列が必要です");
  }
  const sameLesson = pages.filter((page) =>
    notionPropertyText(page.properties?.[lessonPropertyName])?.normalize("NFKC") === lessonName.normalize("NFKC"));
  const exact = sameLesson.filter((page) =>
    normalizeCampus(notionPropertyText(page.properties?.[campusPropertyName])) === targetCampus);
  if (exact.length > 1) throw new Error("同じ校舎のXクラス欠席がNotionに複数あります。職員が確認してください");
  if (exact.length === 1) return exact[0].id;
  if (sameLesson.some((page) => !normalizeCampus(notionPropertyText(page.properties?.[campusPropertyName])))) {
    throw new Error("校舎未設定のXクラス欠席がNotionにあります。校舎を確認してから登録してください");
  }
  return null;
}

export function assertXClassPageCampus(page, campusPropertyName, campus) {
  const actual = normalizeCampus(notionPropertyText(page.properties?.[campusPropertyName]));
  const expected = normalizeCampus(campus);
  if (!actual || actual !== expected) {
    throw new Error("既存のXクラス欠席と配信元校舎が一致しません。Notionの登録先を確認してください");
  }
}
