'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import StaffLogin, { type LoginStaff } from '@/components/staff-login';
import styles from '@/app/interviews/interviews.module.css';

type View = 'summary' | 'list' | 'search' | 'proposals' | 'coverage';
type Decision = 'accepted' | 'held' | 'dismissed';
type CoverageDetail = { complete?: boolean; scope?: string; limitations?: string[]; reason?: string };
type ContextRecord = {
  id: string; title: string; content: string; source_ref: string; source_type: 'notion' | 'line';
  occurred_at: string | null; fetched_at: string | null; direction: string | null;
  source_status?: string; coverage: CoverageDetail;
};
type Proposal = {
  id: string; title: string; description: string; status: 'pending' | Decision;
  evidence_stale: boolean; coverage: CoverageDetail;
  evidence: { sourceKey: string; version: string; sourceRef: string; excerpt: string }[];
  decisions?: { decision: Decision; reason: string; created_at: string }[];
};
type Coverage = { channel: string; scope: string; status: string; detail: CoverageDetail; created_at: string };
type ContextData = {
  records: ContextRecord[]; proposals: Proposal[]; coverage: Coverage[];
  summary: { recordCount: number; proposalCount: number; pendingSources?: number };
};
type SyncReport = {
  busy?: boolean; notion?: { discovered: number; completed: number; partial: number; failed: number };
  line?: { imported: number; hasMore: boolean }; errors?: string[];
};

const decisionLabels = { pending: '未確認', accepted: '採用', held: '保留', dismissed: '不要' };
const coverageLabels: Record<string, string> = {
  complete_for_connection: '接続から取得できるページ一覧を確認',
  complete_for_page: '対象ページの取得済み', complete_for_stored_rows: '保存済み記録の取得済み',
  partial: '一部の範囲・続きの取得が必要', failed: '取得に失敗',
  unavailable: '接続または原文を利用できません', changed_during_fetch: '取得中に原文が更新されました',
};
const allowedStaff = (staff: LoginStaff | null) => staff?.staffCode === 'KUDO' && ['admin', 'office', 'employee'].includes(staff.role);
const date = (value?: string | null) => {
  if (!value) return '日時未確認';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '日時未確認' : parsed.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
};
function sourceUrl(value: string) {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  try { const url = new URL(value); if (url.protocol === 'https:' || url.protocol === 'http:') return url.href; }
  catch { /* An unavailable source is shown as text, never as an unsafe link. */ }
  return null;
}
function SourceLink({ value }: { value: string }) {
  const href = sourceUrl(value);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">原文を開く ↗</a> : <span>原文リンク未確認</span>;
}
function Limits({ detail }: { detail?: CoverageDetail }) {
  return <div><small>{detail?.complete ? 'この取得対象の本文を取得済み' : '取得範囲に未確認・未取得の部分があります'}</small>
    {!!detail?.limitations?.length && <ul>{detail.limitations.map((item, index) => <li key={index}><small>{item}</small></li>)}</ul>}
  </div>;
}
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, response.status === 403 ? 'この機能は工藤確認用です。現在のログインでは閲覧・操作できません。' : body.error ?? '情報を取得できませんでした。');
  return body as T;
}

export default function SchoolContextWorkspace() {
  const [staff, setStaff] = useState<LoginStaff | null>(null);
  const [ready, setReady] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [data, setData] = useState<ContextData | null>(null);
  const [view, setView] = useState<View>('summary');
  const [query, setQuery] = useState('');
  const [studentId, setStudentId] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeStudent, setActiveStudent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [decisionResults, setDecisionResults] = useState<Record<string, { proposal: Proposal; message: string }>>({});
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await api<{ staff: LoginStaff }>('/api/staff/session', { signal: controller.signal });
        if (!active) return;
        setStaff(result.staff);
        if (!allowedStaff(result.staff)) { setForbidden(true); return; }
        const initial = await api<ContextData>('/api/staff/school-context?view=summary&limit=20', { signal: controller.signal });
        if (active) setData(initial);
      } catch (caught) {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 401) setStaff(null);
        else if (caught instanceof ApiError && caught.status === 403) { setForbidden(true); setError(caught.message); }
        else setError('情報を取得できませんでした。「一覧を更新」から再試行できます。');
      } finally { if (active) setReady(true); }
    })();
    return () => { active = false; controller.abort(); };
  }, []);

  async function work(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await task(); }
    catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) { setStaff(null); setData(null); setDecisionResults({}); setForbidden(false); }
      if (caught instanceof ApiError && caught.status === 403) { setForbidden(true); setData(null); setDecisionResults({}); }
      setError(caught instanceof Error ? caught.message : '処理に失敗しました。再度お試しください。');
    } finally { lock.current = false; setBusy(false); }
  }
  async function load(nextView: View, nextQuery = activeQuery, nextStudent = activeStudent) {
    const params = new URLSearchParams({ view: nextView, q: nextQuery, studentId: nextStudent.trim(), limit: '100' });
    const next = await api<ContextData>(`/api/staff/school-context?${params}`);
    setData(next); setView(nextView); setActiveQuery(nextQuery); setActiveStudent(nextStudent.trim());
  }
  function login(nextStaff: LoginStaff) {
    setStaff(nextStaff); setData(null); setDecisionResults({}); setForbidden(!allowedStaff(nextStaff));
    if (allowedStaff(nextStaff)) void work(async () => { await load('summary', '', ''); });
  }
  async function search(event: FormEvent) {
    event.preventDefault(); await work(() => load('search', query.trim(), studentId));
  }
  async function sync() {
    await work(async () => {
      const result = await api<SyncReport>('/api/staff/school-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) });
      await load(view);
      if (result.busy) setMessage('ほかの取得処理が実行中です。しばらくして一覧を更新してください。');
      else setMessage(`取得しました。Notion ${result.notion?.completed ?? 0}件、LINE ${result.line?.imported ?? 0}件。${result.errors?.length ? '一部の取得に失敗しました。取得範囲を確認してください。' : '取得済みの範囲を一覧へ反映しました。'}${result.line?.hasMore || result.notion?.partial ? ' 続きの取得が残っています。' : ''}`);
    });
  }
  async function decide(proposal: Proposal, decision: Decision, trigger: HTMLButtonElement) {
    if (proposal.status === decision) { setMessage(`「${proposal.title}」は${decisionLabels[decision]}として記録済みです。判断を変更するときは別の判断を選んでください。`); return; }
    const position = { x: window.scrollX, y: window.scrollY };
    await work(async () => {
      const saved = await api<{ id: string; status: Decision }>('/api/staff/school-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'decision', proposalId: proposal.id, decision, reason: reasons[proposal.id] ?? '' }) });
      const updated = { ...proposal, status: saved.status, decisions: [...(proposal.decisions ?? []),
        ...(proposal.status === saved.status ? [] : [{ decision: saved.status, reason: reasons[proposal.id] ?? '', created_at: new Date().toISOString() }])] };
      const resultMessage = `${decisionLabels[saved.status]}として記録しました。この行と根拠は引き続き確認できます。`;
      setDecisionResults(current => ({ ...current, [proposal.id]: { proposal: updated, message: resultMessage } }));
      setData(current => current ? { ...current, proposals: current.proposals.map(item => item.id === proposal.id ? updated : item),
        summary: { ...current.summary, proposalCount: Math.max(0, current.summary.proposalCount - (proposal.status === 'pending' ? 1 : 0)) } } : current);
      setMessage(`「${proposal.title}」を${decisionLabels[saved.status]}として記録しました。`);
    });
    requestAnimationFrame(() => {
      // Keep the operation position without pulling someone back after they intentionally scroll or focus elsewhere.
      if (trigger.isConnected && Math.abs(window.scrollY - position.y) < 2 &&
        (document.activeElement === document.body || document.activeElement === trigger)) {
        trigger.focus({ preventScroll: true }); window.scrollTo(position.x, position.y);
      }
    });
  }

  const showRecords = view === 'summary' || view === 'list' || view === 'search';
  const showProposals = view === 'summary' || view === 'proposals';
  const displayedProposals = data ? [...data.proposals, ...Object.values(decisionResults)
    .filter(result => !data.proposals.some(proposal => proposal.id === result.proposal.id)).map(result => result.proposal)] : [];
  return <main className={styles.screen}>
    <header className={styles.header}><div><h1>塾内の情報と確認候補</h1><p>Notion・LINEの記録を根拠と一緒に確認します。</p><span className={styles.status}>工藤確認用</span></div></header>
    {error && <p role="alert" className={styles.notice}>{error}</p>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    {!ready ? <p role="status">ログイン状態を確認しています…</p> : !staff || forbidden ? <>
      {forbidden && <section className={styles.panel}><h2>工藤確認用の画面です</h2><p>現在のログインでは閲覧・操作できません。工藤の職員アカウントを使用してください。</p></section>}
      <StaffLogin onLogin={login} />
    </> : <>
      <section className={styles.panel} aria-label="取得と更新"><p>{staff.displayName}さんで確認中</p>
        <p>塾内のすべての書き込みや返信を把握した状態ではありません。取得できた範囲と原文を確認して判断してください。</p>
        <div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => void sync()}>{busy ? '処理中…' : 'Notion・LINEの記録を取得'}</button>
          <button disabled={busy} onClick={() => void work(() => load(view))}>一覧を更新</button></div>
        <small>取得は読み取りです。提案の採用は確認結果の記録で、LINE送信やNotionの変更は行いません。</small>
        {data && <div className={styles.actions}><span className={styles.status}>保存された記録 {data.summary.recordCount}件</span><span className={styles.status}>確認候補 {data.summary.proposalCount}件</span>
          {!!data.summary.pendingSources && <span className={styles.status}>取得待ち {data.summary.pendingSources}件</span>}</div>}
      </section>
      <nav className={styles.tabs} aria-label="情報の表示">{([['summary', '概要'], ['list', '記録一覧'], ['proposals', '確認候補'], ['coverage', '取得範囲']] as const).map(([key, label]) => <button key={key} disabled={busy} aria-pressed={view === key} onClick={() => void work(() => load(key, '', ''))}>{label}</button>)}</nav>
      <form className={styles.panel} onSubmit={search} aria-label="記録の検索"><h2>記録を検索</h2>
        <label>検索する言葉<input value={query} maxLength={200} disabled={busy} onChange={event => setQuery(event.target.value)} placeholder="例：面談、相談、確認" /></label>
        <label>生徒番号で絞る（任意）<input value={studentId} maxLength={100} disabled={busy} onChange={event => setStudentId(event.target.value)} /></label>
        <small>生徒との対応が確認できた記録だけを番号で絞ります。対応が未確認の記録は検索語で探してください。</small>
        <div className={styles.actions}><button disabled={busy} className={styles.primary}>検索</button></div>
      </form>
      {data && showRecords && <section aria-label="取得した記録"><h2>{view === 'search' ? '検索結果' : '取得した記録'}（表示 {data.records.length}件）</h2>
        {view === 'search' && <p>{activeQuery ? `「${activeQuery}」の検索結果` : '検索語の指定なし'}{activeStudent ? ` ／ 生徒番号：${activeStudent}` : ''}</p>}
        {!data.records.length && <p className={styles.empty}>該当する記録はありません。未取得・未確認の情報が存在しないことは意味しません。</p>}
        {data.records.map(record => <article key={record.id} className={styles.panel} style={{ overflowWrap: 'anywhere', padding: '12px 16px' }}><details>
          <summary><strong>{record.title}</strong> <span className={styles.status}>{record.source_type === 'notion' ? 'Notion' : 'LINE'}</span>
            <small>原文の日時：{date(record.occurred_at)} ／ 詳細を開く</small></summary>
          <div className={styles.actions}>{record.source_type === 'line' && <span className={styles.status}>{record.direction === 'outbound' ? '送信記録' : record.direction === 'inbound' ? '受信記録' : '送受信未確認'}</span>}
            <span className={styles.status}>原文の記録・内容は要確認</span></div><small>取得：{date(record.fetched_at)}</small>
          {record.source_status && record.source_status !== 'available' && <p className={styles.notice}>保存時点の情報です。{record.source_status === 'unavailable' ? '原文の再取得ができていません。' : '原文の更新・取得範囲を再確認しています。'}最新の原文を確認してください。</p>}
          <Limits detail={record.coverage} /><p><SourceLink value={record.source_ref ?? ''} /></p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{record.content}</p></details>
        </article>)}
        {view !== 'summary' && data.records.length >= 100 && <p>表示は100件までです。検索語や生徒番号で絞ってください。</p>}
      </section>}
      {data && showProposals && <section aria-label="根拠付きの確認候補"><h2>確認候補（表示 {displayedProposals.length}件）</h2><p>記録にある確認・相談等の表現を手がかりにした候補です。未対応・未返信とは判定していません。</p>
        {!displayedProposals.length && <p className={styles.empty}>現在表示できる確認候補はありません。</p>}
        {displayedProposals.map(proposal => <article key={proposal.id} className={styles.panel} style={{ overflowWrap: 'anywhere', padding: '12px 16px' }}>
          {decisionResults[proposal.id] && <p role="status" className={styles.notice}>{decisionResults[proposal.id].message}</p>}
          <details><summary><span className={styles.status}>{decisionLabels[proposal.status] ?? '要確認'}</span> <strong>{proposal.title}</strong><small>根拠・判断・履歴を開く{proposal.evidence_stale ? ' ／ 原文の再確認が必要' : ''}</small></summary>
          <p>{proposal.description}</p>
          {proposal.evidence_stale && <p className={styles.notice}>根拠の版が更新されています。最新の原文を確認してから判断してください。</p>}
          <Limits detail={proposal.coverage} />
          {proposal.evidence.map((evidence, index) => <div className={styles.selected} key={`${evidence.sourceKey}-${index}`}><strong>根拠 {index + 1}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{evidence.excerpt}</p><SourceLink value={evidence.sourceRef ?? ''} /></div>)}
          <label>判断の理由（任意）<textarea maxLength={2000} disabled={busy} value={reasons[proposal.id] ?? ''} onChange={event => setReasons(current => ({ ...current, [proposal.id]: event.target.value }))} /></label>
          <div className={styles.actions}>{(['accepted', 'held', 'dismissed'] as const).map(decision => <button key={decision} className={decision === 'accepted' ? styles.primary : undefined} aria-pressed={proposal.status === decision} disabled={busy || proposal.evidence_stale} onClick={event => void decide(proposal, decision, event.currentTarget)}>{decisionLabels[decision]}{proposal.status === decision ? '（現在）' : ''}</button>)}</div>
          {proposal.status !== 'pending' && <small>判断を変更するときは、理由を入力して別の判断を選んでください。これまでの判断は履歴に残ります。</small>}
          {!!proposal.decisions?.length && <details><summary>判断の履歴（{proposal.decisions.length}件）</summary><ul>{proposal.decisions.map((item, index) => <li key={index}>{date(item.created_at)}：{decisionLabels[item.decision]}{item.reason && <p style={{ whiteSpace: 'pre-wrap' }}>{item.reason}</p>}</li>)}</ul></details>}
          </details>
        </article>)}
      </section>}
      {data && (view === 'summary' || view === 'coverage') && <section className={styles.panel} aria-label="情報の取得範囲"><h2>取得範囲</h2><p>接続で閲覧できるNotionページ、保存済みのLINE記録を対象にします。コメント・添付の内容や、LINE管理画面から直接送った返信などには未取得の経路があります。</p>
        {!data.coverage.length ? <p className={styles.empty}>取得範囲の確認記録がありません。取得操作後に再確認してください。</p> : <ul>{data.coverage.map((item, index) => <li key={`${item.channel}-${item.scope}-${index}`} style={{ marginBottom: 18, overflowWrap: 'anywhere' }}><strong>{item.channel === 'notion' ? 'Notion' : item.channel === 'line' ? 'LINE' : '保存記録'}</strong> — {date(item.created_at)}
          <p>{coverageLabels[item.status] ?? '取得範囲の確認記録'}</p>
          <Limits detail={item.detail} /><details><summary>対象の識別情報</summary><small>{item.scope}</small></details></li>)}</ul>}
      </section>}
    </>}
  </main>;
}
