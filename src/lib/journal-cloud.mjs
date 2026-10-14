// Server-only adapter. Never return tokens, sharing capabilities or Graph bodies.
import {scheduleCloudSession, ScheduleCloudError} from './schedule-cloud.mjs';
import {journalAcademicYear, journalFile, journalBrowserUrl} from './journal-browser.mjs';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SELECT = 'id,name,folder,file,webUrl,parentReference,remoteItem';
const normalized = value => String(value ?? '').normalize('NFKC');
export async function listJournalCloudFiles(db, key, fetcher = fetch, now = new Date()) {
  const session = await scheduleCloudSession(db, key, fetcher);
  const allowed = new Set([session.config.driveId]);
  const base = drive => `${GRAPH}/drives/${encodeURIComponent(drive)}`;
  async function get(url) {
    if (![...allowed].some(drive => url.startsWith(`${base(drive)}/`))) throw new ScheduleCloudError('授業日誌の参照先を確認できません。');
    const response = await fetcher(url, {headers:{Authorization:`Bearer ${session.config.token.access_token}`},
      cache:'no-store', redirect:'error', signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new ScheduleCloudError('OneDriveの授業日誌を取得できませんでした。時間をおいて再読み込みしてください。');
    return response.json();
  }
  function folder(item, drive) {
    const target = item.remoteItem ?? item;
    const owner = target.parentReference?.driveId ?? drive;
    if (!target.id || !target.folder || !owner) throw new ScheduleCloudError('授業日誌のフォルダを確認できません。');
    // Only trusted Graph metadata can introduce a shared-folder drive.
    allowed.add(owner);
    return {id:target.id, drive:owner};
  }
  async function children(ref) {
    const prefix = `${base(ref.drive)}/items/${encodeURIComponent(ref.id)}/children`;
    let url = `${prefix}?$select=${SELECT}&$top=200`;
    const found = [];
    for (let page=0; url && page<20; page++) {
      if (!url.startsWith(`${prefix}?`)) throw new ScheduleCloudError('授業日誌の一覧の参照先を確認できません。');
      const data = await get(url);
      if (!Array.isArray(data.value)) throw new ScheduleCloudError('授業日誌の一覧を取得できません。');
      found.push(...data.value); url = data['@odata.nextLink'];
    }
    if (url) throw new ScheduleCloudError('授業日誌の件数が上限を超えました。');
    return found;
  }
  const shared = folder(await get(`${base(session.config.driveId)}/root:/${encodeURIComponent('●勉強クラブ共有')}?$select=${SELECT}`), session.config.driveId);
  const root = folder(await get(`${base(shared.drive)}/items/${encodeURIComponent(shared.id)}:/${encodeURIComponent('09　授業日誌')}?$select=${SELECT}`), shared.drive);
  const roots = await children(root), year = journalAcademicYear(now), files = [], seen = new Set(), identities = new Set();
  const campuses = ['本校','南教室'];
  for (const campus of campuses) {
    const candidates = roots.filter(item => normalized(item.name) === `${year}年3月~${campus}` && (item.folder || item.remoteItem?.folder));
    if (candidates.length !== 1) throw new ScheduleCloudError(`${campus}の${year}年度の授業日誌フォルダを一意に確認できません。`);
    const ref = folder(candidates[0], root.drive), items = await children(ref);
    const groups = [{items,grade:null}];
    const grades = items.filter(item => new RegExp(`^${campus}:(小[456]|中[123])$`).test(normalized(item.name)) && (item.folder || item.remoteItem?.folder));
    // Scan only known grade folders; never descend into backups or historical copies.
    for (let start=0; start<grades.length; start+=4) {
      groups.push(...await Promise.all(grades.slice(start,start+4).map(async item => ({
        grade:normalized(item.name).split(':')[1], items:await children(folder(item,ref.drive)),
      }))));
    }
    for (const group of groups) for (const item of group.items) {
      const parsed = journalFile(item.name,campus,year,group.grade);
      if (!item.file || !parsed) continue;
      const url = journalBrowserUrl(item.webUrl);
      if (!item.id || !url) throw new ScheduleCloudError('授業日誌のブラウザ用リンクを取得できません。');
      const id = `${item.parentReference?.driveId ?? ref.drive}:${item.id}`;
      if (seen.has(id)) continue;
      const identity = `${campus}:${parsed.grade}:${parsed.subject}:${parsed.kind}`;
      if (identities.has(identity)) throw new ScheduleCloudError('同じ授業日誌が複数あります。原本フォルダを確認してください。');
      seen.add(id); identities.add(identity); files.push({id,name:item.name,...parsed,url});
    }
  }
  if (!files.length) throw new ScheduleCloudError('今年度の授業日誌が見つかりません。');
  const gradeOrder = ['小4','小5','小6','中1','中2','中3','補講'];
  files.sort((a,b) => campuses.indexOf(a.campus)-campuses.indexOf(b.campus)
    || gradeOrder.indexOf(a.grade)-gradeOrder.indexOf(b.grade) || a.name.localeCompare(b.name,'ja'));
  return {year,files};
}
