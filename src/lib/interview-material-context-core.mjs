const candidateNames = [
  '特記事項', '配慮事項', '注意事項', '相談事項', '連絡先　備考',
  '他の習い事', '通塾経験のある塾名', '紹介者', '授業形態',
  'OBの有無', 'OB詳細（続柄：名前）', '第何子',
  '兄弟姉妹１学年差', '兄弟姉妹２学年差', '兄弟姉妹３学年差',
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

export function studentInfoCandidates(properties) {
  return candidateNames.map(name => ({ source: name, value: notionPropertyText(properties?.[name]) }))
    .filter(item => item.value && item.value !== 'なし' && item.value !== '特になし')
    .map(item => ({ ...item, value: item.value.slice(0, 1200) }));
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
    body: body.trim().slice(0, 16000),
    url: page.url ?? `https://www.notion.so/${page.id.replaceAll('-', '')}`,
  };
}
