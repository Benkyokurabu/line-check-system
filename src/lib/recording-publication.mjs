import {createHash} from 'node:crypto';

export function currentRecordingMonth() { return new Date(Date.now()+9*3600000).toISOString().slice(0,7); }
export function recordingAdmin(staff) { return !!staff?.staffId && staff.role === 'admin'; }
export function validRecordingKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}\|[^|]{1,30}\|(hon|minami)\|[a-zA-Z0-9_]+\|[1-9]\d?$/.test(key);
}
export function releaseTime(value, now = Date.now()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('日本時間の公開日時を入力してください。');
  const stamp = Date.parse(value + ':00+09:00');
  if (!Number.isFinite(stamp) || new Date(stamp + 9 * 3600000).toISOString().slice(0, 16) !== value || stamp <= now) throw new Error('未来の公開日時を入力してください。');
  return new Date(stamp).toISOString();
}
export function publicationStatus(rule, now = Date.now()) {
  if (rule.mode === 'notion') return rule.notion_ready === true ? 'public' : 'hidden';
  return rule.mode === 'private' || (rule.mode === 'scheduled' && now < Date.parse(rule.release_at)) ? 'hidden' : 'public';
}
export function publicRecordingRules(rules, now = Date.now()) {
  return rules.map(rule => {
    const status = publicationStatus(rule, now);
    return {key: rule.event_key, eventKeys: rule.event_keys, mode: rule.mode, status,
      releaseAt: rule.release_at, version: rule.version,
      url: status === 'public' ? rule.source_url : '',
      urlHashes: (rule.source_urls || [rule.source_url]).filter(Boolean).map(url => createHash('sha256').update(url).digest('hex'))};
  });
}
