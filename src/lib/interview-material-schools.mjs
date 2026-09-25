const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\s　]/g, '').replace(/高等学校|高校/g, '').toLowerCase();
const schoolField = /^(?:現状の)?(?:第?[一二三1-3])?志望校(?:[（(].*[）)])?$|^(?:希望する高校|受験したい高校)(?:[（(].*[）)])?$/;

export function schoolsFromAnswer(fields) {
  const names = [];
  for (const field of fields ?? []) {
    if (!schoolField.test(String(field.label ?? '').trim())) continue;
    for (const raw of String(field.value ?? '').split(/[、,，\/／;；\n・]/)) {
      const name = raw.replace(/^(?:第?[一二三四五六1-6]志望[:：]?|志望校[:：]?|\d+[.．、])\s*/, '').trim();
      if (!name || /^(なし|未定|特になし|決まっていない|わからない)$/u.test(name)) continue;
      if (!names.some(existing => normalize(existing) === normalize(name))) names.push(name);
    }
  }
  return names;
}
