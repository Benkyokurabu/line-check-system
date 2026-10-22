'use client';

import { useRef, useState, type CSSProperties, type FormEvent } from 'react';

type Entry = { sourceId: string; title: string; body: string; sourceHash: string; updatedAt: string; sourceRef?: string };
type Payload = { title: string; body: string; sourceId?: string; expectedHash?: string };
type Status = 'pending' | 'writing' | 'unknown' | 'synced' | 'conflict' | 'blocked';
type Operation = { id: string; kind: 'create' | 'edit'; status: Status; sourceId?: string; sourceRef?: string; errorCode?: string; createdAt: string; updatedAt: string; payload?: Payload; result?: { sourceRef?: string } };
type Result = { operation: Operation; item?: Entry; notice?: string; result?: { sourceRef?: string } };
type Listing = { entries: Entry[]; operations: Operation[]; limits: { maxCharacters: number; maxBytes: number } };
type SavedSnapshot = { title: string; body: string; sourceId?: string; sourceRef?: string; label: string };
const pendingKey = 'bentan:benkei-authoring-operation';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const row: CSSProperties = { padding: 14, margin: '12px 0', border: '1px solid var(--line)', borderRadius: 9, overflowWrap: 'anywhere' };
const action: CSSProperties = { minHeight: 44, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 8, background: 'white', color: 'var(--foreground)', cursor: 'pointer', font: 'inherit' };
const field: CSSProperties = { display: 'block', boxSizing: 'border-box', width: '100%', margin: '6px 0 12px', padding: 10, border: '1px solid var(--line)', borderRadius: 7, background: 'white', color: 'var(--foreground)', font: 'inherit' };
const statuses: Record<Status, string> = { pending: '保存結果を確認中', writing: 'Notionへ保存中', unknown: 'Notionへの反映結果が未確認', synced: 'Notionと勉たんに保存済み', conflict: '原文が変更されています', blocked: '保存できませんでした' };
function originalUrl(sourceId?: string, value?: string) {
  if (value) { try { const url = new URL(value); if (url.protocol === 'https:' && ['www.notion.so', 'notion.so', 'app.notion.com'].includes(url.hostname)) return url.href; } catch { /* use the block ID below */ } }
  return sourceId && uuidPattern.test(sourceId) ? `https://www.notion.so/${sourceId.replaceAll('-', '')}` : null;
}
function Original({ sourceId, sourceRef }: { sourceId?: string; sourceRef?: string }) {
  const href = originalUrl(sourceId, sourceRef);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">Notionの原文を開く ↗</a> : <span>原文リンクは保存結果の確認後に表示します。</span>;
}
class AuthoringError extends Error {
  constructor(message: string, public status: number, public operation?: Operation) { super(message); }
}
async function request<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new AuthoringError(response.status === 403 ? 'この記入機能は工藤確認用です。' : response.status === 401 ? 'ログインし直してから保存結果を確認してください。' : data.error ?? '処理結果を確認できませんでした。', response.status, data.operation);
  return data as T;
}
function rememberOperation(id: string) { try { sessionStorage.setItem(pendingKey, id); } catch { /* Current draft retains its operation ID without browser storage. */ } }

function Editor({ entry, restored, maxCharacters }: { entry?: Entry; restored?: Operation; maxCharacters: number }) {
  const [title, setTitle] = useState(restored?.payload?.title ?? entry?.title ?? '');
  const [body, setBody] = useState(restored?.payload?.body ?? entry?.body ?? '');
  const [operationId, setOperationId] = useState(restored?.id ?? '');
  const [kind, setKind] = useState<'create' | 'edit'>(restored?.kind ?? (entry ? 'edit' : 'create'));
  const [sourceId, setSourceId] = useState(restored?.payload?.sourceId ?? restored?.sourceId ?? entry?.sourceId);
  const [expectedHash, setExpectedHash] = useState(restored?.payload?.expectedHash ?? entry?.sourceHash);
  const [operation, setOperation] = useState<Operation | null>(restored ?? null);
  const [savedItem, setSavedItem] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [snapshots, setSnapshots] = useState<SavedSnapshot[]>([]);
  const lock = useRef(false);
  const locked = busy || operation !== null;
  const uncertain = operation && ['pending', 'writing', 'unknown'].includes(operation.status);
  const sourceChanged = entry && expectedHash && entry.sourceHash !== expectedHash && !operation;

  async function apply(result: Result) {
    setOperation(result.operation); if (result.item) setSavedItem(result.item);
    if (result.operation.sourceId) setSourceId(result.operation.sourceId);
    setMessage(result.notice ?? statuses[result.operation.status]);
    if (result.operation.status === 'synced' && !result.item && result.operation.sourceId) {
      try { const listing = await request<Listing>('/api/staff/benkei-authoring'); const saved = listing.entries.find(item => item.sourceId === result.operation.sourceId); if (saved) setSavedItem(saved); }
      catch { setMessage('Notionと勉たんに保存済みです。編集用の情報を取得できなかったため、必要なときに記入一覧を更新してください。'); }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current || operation || sourceChanged) return;
    lock.current = true; setBusy(true); setError('');
    const id = operationId || crypto.randomUUID(); setOperationId(id); rememberOperation(id);
    try { await apply(await request<Result>('/api/staff/benkei-authoring', { action: 'save', operationId: id, kind, title, body, ...(kind === 'edit' ? { sourceId, expectedHash } : {}) })); }
    catch (caught) {
      if (caught instanceof AuthoringError && caught.operation) { setOperation(caught.operation); setError(caught.message); }
      else if (caught instanceof AuthoringError && [400, 401, 403, 413].includes(caught.status)) { setError(caught.message); }
      else { setOperation({ id, kind, status: 'unknown', sourceId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); setError('保存の反映結果が未確認です。再送せず「原本の反映結果を確認」を押してください。入力は残っています。'); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function recover() {
    if (lock.current || !operationId) return;
    lock.current = true; setBusy(true); setError('');
    try { await apply(await request<Result>('/api/staff/benkei-authoring', { action: 'recover', operationId })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '原本の反映結果を確認できませんでした。再送せず、時間をおいて確認してください。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function resumePending() {
    if (lock.current || operation?.status !== 'pending' || !operationId) return;
    lock.current = true; setBusy(true); setError('');
    try { await apply(await request<Result>('/api/staff/benkei-authoring', { action: 'save', operationId, kind, title, body, ...(kind === 'edit' ? { sourceId, expectedHash } : {}) })); }
    catch (caught) {
      if (caught instanceof AuthoringError && caught.operation) { setOperation(caught.operation); setError(caught.message); }
      else { setOperation(current => current ? { ...current, status: 'unknown' } : current); setError('反映結果が未確認です。再送せず、原本の反映結果を確認してください。'); }
    } finally { lock.current = false; setBusy(false); }
  }
  function restartFromLatest() {
    if (busy || !entry || entry.sourceHash === expectedHash) return;
    setSnapshots(current => [...current, { title, body, sourceId, sourceRef: entry.sourceRef, label: '原文更新前の未保存入力' }]);
    setTitle(entry.title); setBody(entry.body); setExpectedHash(entry.sourceHash); setSourceId(entry.sourceId);
    setKind('edit'); setOperation(null); setOperationId(crypto.randomUUID()); setSavedItem(null); setError('');
    setMessage('最新の原文を入力欄へ読み込みました。元の入力は下の履歴に残っています。');
  }
  function restartBlocked() {
    if (busy || operation?.status !== 'blocked') return;
    setSnapshots(current => [...current, { title, body, sourceId, sourceRef: operation.sourceRef, label: '保存できなかった入力' }]);
    setOperation(null); setOperationId(crypto.randomUUID()); setError('');
    setMessage('入力を残して、新しい保存処理を準備しました。内容を確認して保存してください。');
  }
  function nextDraft(editSaved: boolean) {
    if (busy || operation?.status !== 'synced') return;
    setSnapshots(current => [...current, { title: savedItem?.title ?? title, body: savedItem?.body ?? body, sourceId, sourceRef: savedItem?.sourceRef ?? operation.sourceRef ?? operation.result?.sourceRef, label: '保存済みの内容' }]);
    setOperation(null); setOperationId(crypto.randomUUID()); setError(''); setMessage('');
    if (editSaved && savedItem) { setKind('edit'); setTitle(savedItem.title); setBody(savedItem.body); setSourceId(savedItem.sourceId); setExpectedHash(savedItem.sourceHash); }
    else { setKind('create'); setTitle(''); setBody(''); setSourceId(undefined); setExpectedHash(undefined); }
    setSavedItem(null);
  }
  return <div style={row}>
    <form onSubmit={submit} aria-label={entry ? `ベンケイを編集：${entry.title}` : '新しいベンケイの記入'}>
      <p><strong>{kind === 'edit' ? '勉たんから作成した記入を編集' : '新しいベンケイの記入'}</strong></p>
      <label>見出し<input required maxLength={160} style={field} value={title} readOnly={locked} onChange={event => setTitle(event.target.value)} /></label>
      <label>本文<textarea required maxLength={maxCharacters} style={{ ...field, minHeight: 150 }} value={body} readOnly={locked} onChange={event => setBody(event.target.value)} /></label>
      <small>{body.length.toLocaleString()} / {maxCharacters.toLocaleString()}字。保存前にこの本文を確認してください。</small>
      {sourceChanged && <p role="alert">原本の新しい版を検出しました。現在の入力は保持しています。原文と比較してから編集を開始し直してください。</p>}
      {message && <p role="status" style={{ ...row, background: '#eef7f2' }}>{message}</p>}
      {error && <p role="alert" style={{ ...row, background: '#fff5e1' }}>{error}</p>}
      {operation && <p><strong>{statuses[operation.status]}</strong>{operation.status !== 'synced' && '。この入力は消していません。'}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        {!operation && <button style={action} disabled={busy || !!sourceChanged || !title.trim() || !body.trim()}>{busy ? '保存結果を確認中…' : kind === 'edit' ? 'Notionと勉たんへ修正を保存' : 'Notionと勉たんへ保存'}</button>}
        {operation?.status === 'pending' && <button type="button" style={action} disabled={busy} onClick={() => void resumePending()}>送信未開始の保存を再開</button>}
        {(uncertain || operation?.status === 'blocked') && <button type="button" style={action} disabled={busy} onClick={() => void recover()}>{busy ? '照合中…' : '原本の反映結果を確認'}</button>}
        {operation?.status === 'blocked' && <button type="button" style={action} disabled={busy} onClick={restartBlocked}>保存できなかった入力を新しい処理でやり直す</button>}
        {(sourceChanged || operation?.status === 'conflict') && entry && entry.sourceHash !== expectedHash && <button type="button" style={action} disabled={busy} onClick={restartFromLatest}>現在の入力を残して最新の原文で編集し直す</button>}
        {operation?.status === 'synced' && <button type="button" style={action} disabled={busy} onClick={() => nextDraft(false)}>次の新しい記入を始める</button>}
        {operation?.status === 'synced' && savedItem && <button type="button" style={action} disabled={busy} onClick={() => nextDraft(true)}>保存した記入を修正する</button>}
      </div>
      {(sourceId || savedItem?.sourceRef) && <p><Original sourceId={sourceId} sourceRef={savedItem?.sourceRef ?? operation?.sourceRef ?? operation?.result?.sourceRef ?? entry?.sourceRef} /></p>}
      {operation?.status === 'conflict' && <p>Notion上の内容が変わっているため上書きしていません。入力を残したまま原文を確認し、下の記入一覧を更新してください。</p>}
      {busy && <p role="status">処理中です。入力と結果はこの場所に残ります。</p>}
    </form>
    {!!snapshots.length && <details style={{ marginTop: 12 }}><summary>このフォームの保存結果・入力履歴（{snapshots.length}件）</summary>{snapshots.map((snapshot, index) => <article key={index} style={row}><strong>{snapshot.label}：{snapshot.title}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{snapshot.body}</p><Original sourceId={snapshot.sourceId} sourceRef={snapshot.sourceRef} /></article>)}</details>}
  </div>;
}

export default function BenkeiAuthoring() {
  const [data, setData] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState<Operation | null>(null);
  const [previousOperation, setPreviousOperation] = useState('');
  const lock = useRef(false);
  async function load() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      setData(await request<Listing>('/api/staff/benkei-authoring'));
      try { const id = sessionStorage.getItem(pendingKey) ?? ''; if (uuidPattern.test(id)) setPreviousOperation(id); } catch { /* Optional recovery hint only. */ }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '記入一覧を取得できませんでした。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function restore(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = await request<Result>(`/api/staff/benkei-authoring?operation=${encodeURIComponent(id)}`); if (!result.operation?.payload) throw new Error('前回の本文を取得できませんでした。保存処理の履歴から対象を確認してください。'); setRestored(result.operation); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '前回の保存結果を取得できませんでした。'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <details style={row} onToggle={event => { if (event.currentTarget.open && !data && !lock.current) void load(); }}>
    <summary><strong>ベンケイに書く</strong><small style={{ display: 'block', marginTop: 4 }}>Notionのベンケイへ保存し、同じ記入を勉たんにも反映します。二重入力は不要です。</small></summary>
    <p>現在は工藤確認用です。Notionでの従来の記入は引き続き利用できます。ここから作成した記入だけ、この画面から修正できます。</p>
    {error && <p role="alert" style={{ ...row, background: '#fff5e1' }}>{error}</p>}
    <button type="button" style={action} disabled={busy} onClick={() => void load()}>{busy ? '読み込み中…' : 'この画面から作成した記入を更新'}</button>
    {previousOperation && !restored && <p><button type="button" style={action} disabled={busy} onClick={() => void restore(previousOperation)}>前回の保存結果と本文を確認</button></p>}
    {restored && <section aria-label="前回の保存結果"><h3>前回の保存結果と本文</h3><Editor key={restored.id} restored={restored} maxCharacters={data?.limits.maxCharacters ?? 190000} /></section>}
    {data && <>
      <Editor maxCharacters={data.limits.maxCharacters} />
      <details style={row}><summary>この画面から作成した記入（{data.entries.length}件）</summary>
        {!data.entries.length && <p>この画面から作成した記入はまだありません。</p>}
        {data.entries.map(entry => <details key={entry.sourceId} style={row}><summary><strong>{entry.title}</strong> — 本文・修正を開く</summary><Original sourceId={entry.sourceId} sourceRef={entry.sourceRef} /><Editor entry={entry} maxCharacters={data.limits.maxCharacters} /></details>)}
      </details>
      {!!data.operations.length && <details style={row}><summary>保存処理の履歴（{data.operations.length}件）</summary><ul>{data.operations.map(operation => <li key={operation.id} style={{ margin: '10px 0' }}>{operation.kind === 'edit' ? '修正' : '新規記入'}：{statuses[operation.status]} <button type="button" style={action} disabled={busy} onClick={() => void restore(operation.id)}>本文と保存結果を確認</button></li>)}</ul></details>}
    </>}
  </details>;
}
