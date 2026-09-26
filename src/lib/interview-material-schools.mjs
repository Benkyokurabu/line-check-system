const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\s　]/g, '').replace(/高等学校|高校/g, '').toLowerCase();
const schoolField = /^(?:現状の)?(?:第?[一二三1-3])?志望校(?:[（(].*[）)])?$|^(?:希望する高校|受験したい高校)(?:[（(].*[）)])?$/;

export function canonicalSchoolName(value) {
  const name = String(value ?? '').normalize('NFKC').trim();
  return normalize(name) === 'えいめい' ? '叡明' : name;
}

function rankFromLabel(label) {
  if (/(?:第一|第1)志望/u.test(label)) return 1;
  if (/(?:第二|第2)志望/u.test(label)) return 2;
  if (/(?:第三|第3)志望/u.test(label)) return 3;
  return 4;
}

export function schoolsFromAnswer(fields) {
  const candidates = [];
  for (const [fieldIndex, field] of (fields ?? []).entries()) {
    const label = String(field.label ?? '').trim().normalize('NFKC');
    if (!schoolField.test(label)) continue;
    for (const [partIndex, raw] of String(field.value ?? '').split(/[、,，／/;；\n・]/).entries()) {
      const name = canonicalSchoolName(raw.replace(/^(?:第?[一二三1-6]志望[:：]?|志望校[:：]?|\d+[.．、)）])\s*/, '').trim());
      if (!name || /^(なし|未定|特になし|決まっていない|わからない)$/u.test(name)) continue;
      candidates.push({ name, rank: rankFromLabel(label), fieldIndex, partIndex });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.fieldIndex - b.fieldIndex || a.partIndex - b.partIndex);
  const names = [];
  for (const { name } of candidates) {
    if (!names.some(existing => normalize(existing) === normalize(name))) names.push(name);
  }
  return names;
}
