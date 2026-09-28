import { createHash } from 'node:crypto';

export function infoSourceHash(fields) {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export function checkedSummary(summary, fields) {
  if (!summary || !Array.isArray(summary.notes)) throw new Error('AI要約の形式を確認できません。');
  const allowed = new Map(fields.map(item => [item.source, item.value]));
  if (summary.notes.length > 5) throw new Error('AI要約の件数を確認できません。');
  return summary.notes.map(item => {
    const source = String(item?.source ?? '');
    const note = String(item?.note ?? '').trim();
    if (!allowed.has(source) || !note || note.length > 240) throw new Error('AI要約の出典を確認できません。');
    return { source, note, original: allowed.get(source) };
  });
}
