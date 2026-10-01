'use client';

import { useEffect, useState } from 'react';
import styles from './workspace.module.css';
import { materialDockLabel } from './material-dock-label';
import type { MaterialContext } from './material-context';

type Item = { label: string; source?: string; previewUrl?: string };
type Active = number | 'records' | 'info';
type Props = { items: Item[]; pdfUrl: string; open: boolean; onClose: () => void;
  context: MaterialContext | null; contextLoading: boolean; contextError: string; showPastSchools: boolean; onNeedInfoSummary: () => void };
const viewerUrl = (url: string) => `${url.split('#')[0]}#zoom=100&navpanes=0`;

export default function MaterialPdfViewer({ items, pdfUrl, open, onClose, context, contextLoading, contextError, showPastSchools, onNeedInfoSummary }: Props) {
  const separate = items.length > 0 && items.every(item => Boolean(item.previewUrl));
  const [active, setActive] = useState<Active>(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [cached, setCached] = useState<number[]>(() => items.slice(0, 8).map((_, index) => index));
  const tabs: Active[] = [...items.map((_, index) => index), 'records', 'info'];
  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener('keydown', keydown); };
  }, [open, onClose]);
  useEffect(() => {
    if (open && (active === 'info' || active === 'records') && context?.summary.status === 'prepared') onNeedInfoSummary();
  }, [open, active, context, onNeedInfoSummary]);
  function select(tab: Active) {
    setActive(tab);
    if (typeof tab === 'number') setCached(previous => previous.includes(tab) ? previous : [...previous, tab].slice(-12));
  }
  const selected = separate && typeof active === 'number' ? items[active] : null;
  const selectedUrl = selected?.previewUrl || pdfUrl;
  const title = active === 'records' ? '面談記録' : active === 'info' ? '情報' : selected?.label || '一式PDF';
  const sourceUrl = active === 'records' ? context?.records[0]?.url : active === 'info' ? context?.studentUrl : viewerUrl(selectedUrl);
  return <div className={styles.viewerOverlay} role="dialog" aria-modal={open ? 'true' : undefined} aria-label="面談資料のプレビュー" aria-hidden={!open} style={{ display: open ? undefined : 'none' }}>
    <header className={styles.viewerHeader}>
      <button className={styles.viewerBack} type="button" onClick={onClose}>← 完成した資料に戻る</button>
      <strong>{title}</strong>
      <div>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">{typeof active === 'number' ? 'このPDFを別画面で開く' : 'Notionの原本を開く'}</a>}</div>
    </header>
    <div className={styles.viewerBody}>
      {separate ? items.map((item, index) => cached.includes(index) && <iframe key={index} className={styles.viewerFrame} data-active={active === index ? 'true' : 'false'} src={viewerUrl(item.previewUrl!)} title={`${item.label}のPDFプレビュー`} tabIndex={active === index && open ? 0 : -1} aria-hidden={active !== index || !open} />) : <iframe className={styles.viewerFrame} data-active={typeof active === 'number' ? 'true' : 'false'} src={viewerUrl(pdfUrl)} title="一式PDFのプレビュー" tabIndex={typeof active === 'number' && open ? 0 : -1} />}
      {active === 'records' && <section className={styles.viewerTextPanel} aria-label="面談記録">
        <h2>面談記録</h2><p>Notionの面談DBから取得した直近3回の記録を全文で表示します。</p>
        {!contextLoading && !contextError && context?.summary.status === 'completed' && <div className={styles.viewerSummary}>
          <h3>面談前に確認したい点（AI）</h3>
          {context.summary.items.length ? <ul>{context.summary.items.map((item, index) => <li key={`${item.source}-${index}`}><strong>{item.note}</strong><small>出典：{item.source}</small></li>)}</ul>
            : <p>特記する項目はありませんでした。</p>}
        </div>}
        {!contextLoading && !contextError && context && ['prepared', 'queued', 'running'].includes(context.summary.status) && <p role="status">AIが過去の記録と生徒情報を確認中です。記録本文は下に表示しています。</p>}
        {!contextLoading && !contextError && context?.summary.status === 'failed' && <p>AIによる注意点の抽出は完了していません。記録本文を確認してください。</p>}
        {contextLoading ? <p role="status">読み込み中…</p> : contextError ? <p role="alert">{contextError}</p>
          : !context?.records.length ? <p>面談記録は見つかりませんでした。</p>
            : context.records.map(record => <article key={record.id} className={styles.viewerRecord}>
              <h3>{record.title}</h3><p className={styles.viewerDate}>{record.date || '日付なし'} <a href={record.url} target="_blank" rel="noreferrer">原本</a></p>
              {(record.method || record.purpose) && <p>方法：{record.method || '記載なし'} ／ 目的：{record.purpose || '記載なし'}</p>}
              <div className={styles.viewerRecordBody}>{record.body || '本文はありません。'}</div>
              {!!record.attachments?.length && <p>添付ファイル：{record.attachments.join('、')}（原本から確認）</p>}
            </article>)}
      </section>}
      {active === 'info' && <section className={styles.viewerTextPanel} aria-label="生徒情報">
        <h2>情報</h2><p>生徒情報DBの原文と、過去の面談記録も踏まえた注意点を表示します。</p>
        {showPastSchools && !contextLoading && !contextError && <div className={styles.viewerSummary}><h3>過去の面談で話題に出た高校</h3>
          <p>アンケートに志望校の記載がありません。以下は志望校として確定した情報ではありません。</p>
          {context?.schoolMentions?.length ? <ul>{context.schoolMentions.map((mention, index) => <li key={`${mention.url}-${index}`}>{mention.text} <small>（{mention.date || '日付なし'}・<a href={mention.url} target="_blank" rel="noreferrer">Notion原本</a>）</small></li>)}</ul>
            : <p>高校名への言及は見つかりませんでした。</p>}
        </div>}
        {contextLoading ? <p role="status">読み込み中…</p> : contextError ? <p role="alert">{contextError}</p>
          : !context?.info.length ? <p>該当する記載はありません。</p>
            : <>
              {context.summary.status === 'completed' && (context.summary.items.length
                ? <div className={styles.viewerSummary}><h3>AIが選んだ特記事項</h3><ul>{context.summary.items.map((item, index) => <li key={`${item.source}-${index}`}><strong>{item.note}</strong><small>出典：{item.source}</small></li>)}</ul></div>
                : <p>AIが特記する項目はありませんでした。</p>)}
              {['prepared', 'queued', 'running'].includes(context.summary.status) && <p role="status">AIが特記事項を確認中です。元の記載は下に表示しています。</p>}
              {context.summary.status === 'failed' && <p>AIの要約を作成できませんでした。元の記載を確認してください。</p>}
              <h3>生徒情報DBの元の記載</h3><dl className={styles.viewerInfo}>{context.info.map(item => <div key={item.source}><dt>{item.source}</dt><dd>{item.value}</dd></div>)}</dl>
            </>}
      </section>}
      <nav className={styles.viewerDock} aria-label="資料を切り替える">
        {tabs.map((tab, index) => {
          const label = typeof tab === 'number' ? materialDockLabel(items[tab]) : tab === 'records' ? '面談記録' : '情報';
          const fullLabel = typeof tab === 'number' ? items[tab].label : label;
          return <button key={String(tab)} type="button" className={styles.viewerDockButton} data-label={fullLabel}
            data-near={hovered !== null && Math.abs(index - hovered) === 1 ? 'true' : undefined} title={fullLabel}
            aria-label={`${fullLabel}を表示`} aria-pressed={active === tab}
            onMouseMove={() => { setHovered(index); select(tab); }} onMouseLeave={() => setHovered(null)}
            onFocus={() => select(tab)} onClick={() => select(tab)} onKeyDown={event => {
              if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              const next = (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              select(tabs[next]);
              event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
            }}><strong aria-hidden="true">{label}</strong></button>;
        })}
      </nav>
    </div>
    {!separate && items.length > 1 && <p className={styles.viewerLegacyNote}>このPDFは旧形式のため資料別の表示に対応していません。資料を作成し直すと、資料ごとに表示できます。</p>}
  </div>;
}
