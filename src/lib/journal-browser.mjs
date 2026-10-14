export const JOURNAL_SUBJECTS = [
  {id:'math', label:'算数・数学'}, {id:'japanese', label:'国語'},
  {id:'english', label:'英語'}, {id:'science', label:'理科'}, {id:'social', label:'社会'},
];
const subjects = {算数:'math', 数学:'math', 国語:'japanese', 英語:'english', 理科:'science', 社会:'social'};
const normalize = value => String(value ?? '').normalize('NFKC');
export function journalAcademicYear(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600000);
  return jst.getUTCFullYear() - (jst.getUTCMonth() < 2 ? 1 : 0);
}
export function journalBrowserUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (['onedrive.live.com','1drv.ms'].includes(url.hostname) || /(^|\.)sharepoint\.com$/.test(url.hostname))
      ? url.href : null;
  } catch { return null; }
}
export function journalFile(name, campus, year, grade = null) {
  const match = normalize(name).match(/^(本校|南教室)(?:(小[456]|中[123])(X)?(算数|数学|国語|英語|理科|社会)|(数学|英語)補講)_(20\d{2})\.xlsx$/);
  if (!match || match[1] !== campus || Number(match[6]) !== year) return null;
  if (grade ? match[2] !== grade : !!match[2]) return null;
  const subject = match[4] ?? match[5], kind = match[5] ? '補講' : match[3] ? 'X' : '通常';
  return {campus, grade:match[2] ?? '補講', subject, subjectId:subjects[subject], kind};
}
export function selectJournalFiles(files, subject, campus) {
  if (!JOURNAL_SUBJECTS.some(item => item.id === subject) || !['全部','本校','南教室'].includes(campus)) return [];
  const seen = new Set();
  return files.filter(file => file.subjectId === subject && (campus === '全部' || file.campus === campus)
    && journalBrowserUrl(file.url) && !seen.has(file.id) && seen.add(file.id));
}
// Keep these calls synchronous: awaiting before window.open loses user activation.
// Return only blocked items so retrying cannot reopen successful tabs.
export function openJournalTabs(files, opener = (url, name) => window.open(url, name)) {
  const blocked = [], seen = new Set(); let requested = 0;
  for (const file of files) {
    const url = journalBrowserUrl(file.url);
    if (!url || seen.has(file.id)) continue;
    seen.add(file.id);
    try {
      const tab = opener(url, '_blank');
      if (!tab) { blocked.push(file); continue; }
      try { tab.opener = null; } catch { /* Cross-origin handle can already be isolated. */ }
      requested++;
    } catch { blocked.push(file); }
  }
  return {requested, blocked};
}
