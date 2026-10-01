const candidateNames = [
  '特記事項', '配慮事項', '注意事項', '相談事項', '連絡先　備考',
  '他の習い事', '通塾経験のある塾名', '紹介者', '授業形態',
  'OBの有無', '第何子',
];

export function notionPropertyText(property) {
  if (!property) return '';
  if (property.type === 'title') return (property.title ?? []).map(item => item.plain_text ?? item.text?.content ?? '').join('').trim();
  if (property.type === 'rich_text') return (property.rich_text ?? []).map(item => item.plain_text ?? item.text?.content ?? '').join('').trim();
  if (property.type === 'select') return property.select?.name?.trim() ?? '';
  if (property.type === 'multi_select') return (property.multi_select ?? []).map(item => item.name?.trim()).filter(Boolean).join('、');
  if (property.type === 'number') return property.number == null ? '' : String(property.number);
  if (property.type === 'formula') return property.formula?.string?.trim() ?? '';
  return '';
}

function currentGrade(grade, offset) {
  const match = String(grade).normalize('NFKC').match(/^([小中高])([1-6])$/u);
  if (!match) return '';
  const year = { 小: 0, 中: 6, 高: 9 }[match[1]] + Number(match[2]) + offset;
  if (year < 1) return `就学前・${Math.max(0, 5 + year)}〜${Math.max(0, 6 + year)}歳程度`;
  if (year <= 6) return `小学${year}年生`;
  if (year <= 9) return `中学${year - 6}年生`;
  if (year <= 12) return `高校${year - 9}年生`;
  return `${year + 5}〜${year + 6}歳程度`;
}

const normalizedName = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').trim();

export function siblingSchoolLookups(properties, fallbackGrade = '', academicYear = 0) {
  const studentName = notionPropertyText(properties?.['生徒氏名']);
  const grade = notionPropertyText(properties?.['学年']) || fallbackGrade;
  const nameParts = studentName.normalize('NFKC').trim().split(/\s+/u);
  const surname = nameParts.length > 1 ? nameParts[0] : '';
  return ['１', '２', '３'].flatMap((numeral, index) => {
    const siblingName = notionPropertyText(properties?.[`兄弟姉妹${numeral}名前`])
      || notionPropertyText(properties?.[`兄弟姉妹${numeral} 名前`]);
    if (!siblingName) return [];
    const difference = notionPropertyText(properties?.[`兄弟姉妹${numeral}学年差`]);
    const gap = difference.normalize('NFKC').match(/^(\d+)学年(上|下)$/u);
    const stage = gap ? currentGrade(grade, Number(gap[1]) * (gap[2] === '上' ? 1 : -1)) : '';
    const highYear = Number(stage.match(/^高校([1-3])年生$/u)?.[1] ?? 0);
    if (!highYear || !academicYear) return [];
    const explicitFullName = /\s/u.test(siblingName.trim());
    if (!surname && !explicitFullName) return [];
    const fullName = explicitFullName || normalizedName(siblingName).startsWith(normalizedName(surname))
      ? siblingName : `${surname}${siblingName}`;
    return [{ index, search: siblingName.trim().split(/\s+/u).at(-1), fullName: normalizedName(fullName),
      graduationYear: academicYear - highYear + 1 }];
  });
}

export function schoolForSiblingResults(pages, fullName) {
  const matches = pages.filter(page => normalizedName(notionPropertyText(page.properties?.['名前'])) === fullName);
  if (matches.length !== 1) return '';
  return notionPropertyText(matches[0].properties?.['進学先']);
}

export function schoolForSelectedDestinationResults(pages, fullName, graduationYear) {
  const matches = pages.filter(page => normalizedName(notionPropertyText(page.properties?.['生徒氏名'])) === fullName
    && notionPropertyText(page.properties?.['入試年度']) === `${graduationYear}年度`);
  if (matches.length !== 1) return '';
  const selection = notionPropertyText(matches[0].properties?.['進学先']);
  const choice = selection.match(/^第([①②③④])志望／進学$/u)?.[1];
  return choice ? notionPropertyText(matches[0].properties?.[`第${choice}志望　高校名`]) : '';
}

export function siblingInfoCandidates(properties, fallbackGrade = '', siblingSchools = []) {
  const grade = notionPropertyText(properties?.['学年']) || fallbackGrade;
  const rows = [];
  for (const [index, numeral] of ['１', '２', '３'].entries()) {
    const difference = notionPropertyText(properties?.[`兄弟姉妹${numeral}学年差`]);
    const name = notionPropertyText(properties?.[`兄弟姉妹${numeral}名前`])
      || notionPropertyText(properties?.[`兄弟姉妹${numeral} 名前`]);
    if (!difference && !name) continue;
    const match = difference.normalize('NFKC').match(/^(\d+)学年(上|下)$/u);
    const stage = match ? currentGrade(grade, Number(match[1]) * (match[2] === '上' ? 1 : -1)) : '';
    const person = name.replace(/さん$/u, '');
    const school = name ? String(siblingSchools[index] ?? '').trim() : '';
    const details = [stage ? `現在${stage}` : '', school ? `進学先：${school}` : ''].filter(Boolean).join('・');
    rows.push({ source: `兄弟姉妹（${index + 1}人目）`, value: name
      ? `${difference ? `${difference}に` : '兄弟姉妹に'}${person}さんがいます${details ? `（${details}）` : difference ? '' : '（学年差の記載なし）'}`
      : `${difference}に兄弟姉妹がいます${stage ? `（現在${stage}）` : ''}` });
  }
  const ob = notionPropertyText(properties?.['OB詳細（続柄：名前）']);
  if (ob) rows.push({ source: '卒塾した兄弟姉妹（続柄・名前）', value: ob });
  return rows;
}

export function studentInfoCandidates(properties, grade = '', siblingSchools = []) {
  return [...candidateNames.map(name => ({ source: name, value: notionPropertyText(properties?.[name]) })),
    ...siblingInfoCandidates(properties, grade, siblingSchools)]
    .filter(item => item.value && item.value !== 'なし' && item.value !== '特になし')
    .map(item => ({ ...item, value: item.value.slice(0, 1200) }));
}

export function schoolMentionsFromRecords(records) {
  const seen = new Set();
  return records.flatMap(record => [String(record.title ?? ''), ...String(record.body ?? '').split(/\n+/u)].flatMap(line => {
    const text = line.trim();
    // School names can appear without 高校, for example 大宮（普通科）の基準偏差値.
    const schoolCourseScore = /[一-龠々ァ-ヶー]{2,20}[（(][^）)]{1,20}(?:科|コース)[）)]の(?:基準)?偏差値/u.test(text);
    if (!/(?:高校|高等学校)/u.test(text)
      && !schoolCourseScore
      && (!/志望校/u.test(text) || /(?:未定|なし|決まっていない)/u.test(text))) return [];
    const excerpt = text.slice(0, 240);
    const key = `${record.id}:${excerpt}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ date: record.date, text: excerpt, url: record.url }];
  }));
}

export function notionBlockText(block) {
  const content = block?.[block.type];
  const text = (content?.rich_text ?? []).map(item => item.plain_text ?? item.text?.content ?? '').join('').trim();
  if (!text) return '';
  if (block.type === 'bulleted_list_item') return `・${text}`;
  if (block.type === 'numbered_list_item') return `・${text}`;
  if (block.type === 'to_do') return `${content.checked ? '☑' : '□'} ${text}`;
  return text;
}

export function materialRecord(page, body) {
  const properties = page.properties ?? {};
  const title = notionPropertyText(properties['面談内容'])
    || notionPropertyText(Object.values(properties).find(property => property.type === 'title')) || '面談記録';
  return {
    id: page.id,
    date: properties['面談日']?.date?.start ?? page.created_time?.slice(0, 10) ?? '',
    title,
    method: notionPropertyText(properties['方法']),
    purpose: notionPropertyText(properties['面談目的']),
    attachments: (properties['添付ファイル']?.files ?? []).map(file => file.name).filter(Boolean),
    body: body.trim(),
    url: page.url ?? `https://www.notion.so/${page.id.replaceAll('-', '')}`,
  };
}

export function recentRecordCandidates(records) {
  return records.filter(record => record.body).map((record, index) => ({
    source: `過去の面談記録${index + 1}（${record.date || '日付なし'}・${record.title}）`,
    value: record.body,
  }));
}
