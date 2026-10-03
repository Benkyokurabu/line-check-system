export const HOKUSHIN_CATALOG_PATH = 'hokushin-library/catalog.json';

// Only the prepared school library may be signed; never trust arbitrary storage paths.
export function validateHokushinCatalog(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.items) || !value.items.length || value.items.length > 1500)
    throw Error('北辰基礎資料の学校一覧を確認できませんでした。');
  const ids = new Set();
  for (const item of value.items) {
    if (!item || !/^[a-f0-9]{64}$/.test(item.id) || ids.has(item.id)
      || item.storagePath !== `hokushin-library/pdf/${item.id}.pdf`
      || typeof item.school !== 'string' || !item.school.trim() || item.school.length > 160
      || typeof item.reading !== 'string' || item.reading.length > 160
      || !['公立', '私立', 'その他'].includes(item.category)
      || !Number.isInteger(item.year) || item.year < 2000 || item.year > 2100
      || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > 52_428_800)
      throw Error('北辰基礎資料の学校一覧を確認できませんでした。');
    ids.add(item.id);
  }
  return value;
}

export function schoolSearchKey(value) {
  return String(value).normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,
    char => String.fromCharCode(char.charCodeAt(0) - 0x60)).replace(/[\s　]/g, '');
}

export function filterHokushinSchools(items, query, category = '全て') {
  const tokens = schoolSearchKey(query).split(/[、,]/).filter(Boolean);
  return items.filter(item => (category === '全て' || item.category === category)
    && tokens.every(token => schoolSearchKey(`${item.school}${item.reading}`).includes(token)));
}
