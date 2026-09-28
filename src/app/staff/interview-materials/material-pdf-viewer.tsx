'use client';

import { useEffect, useState } from 'react';
import styles from './workspace.module.css';

type Item = { label: string; previewUrl?: string };
type Props = { items: Item[]; pdfUrl: string; open: boolean; onClose: () => void };
const dockLabel = (label: string) => /アンケート/.test(label) ? 'アンケート' : /指導簿/.test(label) ? '指導簿' : /北辰/.test(label) ? '北辰' : /成績通知/.test(label) ? '塾内成績' : /高校案内|基準|志望校/.test(label) ? '志望校' : /Vもぎ/.test(label) ? 'Vもぎ' : '資料';
const viewerUrl = (url: string) => `${url.split('#')[0]}#zoom=100&navpanes=0`;

export default function MaterialPdfViewer({ items, pdfUrl, open, onClose }: Props) {
  const separate = items.length > 0 && items.every(item => Boolean(item.previewUrl));
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [cached, setCached] = useState<number[]>(() => items.slice(0, 8).map((_, index) => index));
  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener('keydown', keydown); };
  }, [open, onClose]);
  function select(index: number) {
    setActive(index);
    setCached(previous => previous.includes(index) ? previous : [...previous, index].slice(-12));
  }
  const selected = separate ? items[active] : null;
  const selectedUrl = selected?.previewUrl || pdfUrl;
  return <div className={styles.viewerOverlay} role="dialog" aria-modal={open ? 'true' : undefined} aria-label="面談資料のPDFプレビュー" aria-hidden={!open} style={{ display: open ? undefined : 'none' }}>
    <header className={styles.viewerHeader}>
      <strong>{selected?.label || '一式PDF'}</strong>
      <div><a href={viewerUrl(selectedUrl)} target="_blank" rel="noreferrer">このPDFを別画面で開く</a><button type="button" onClick={onClose} aria-label="プレビューを閉じる">閉じる ×</button></div>
    </header>
    <div className={styles.viewerBody}>
      {separate ? items.map((item, index) => cached.includes(index) && <iframe key={index} className={styles.viewerFrame} data-active={active === index ? 'true' : 'false'} src={viewerUrl(item.previewUrl!)} title={`${item.label}のPDFプレビュー`} tabIndex={active === index && open ? 0 : -1} aria-hidden={active !== index || !open} />) : <iframe className={styles.viewerFrame} data-active="true" src={viewerUrl(pdfUrl)} title="一式PDFプレビュー" tabIndex={open ? 0 : -1} />}
      {separate && items.length > 1 && <nav className={styles.viewerDock} aria-label="資料を切り替える">
        {items.map((item, index) => <button key={index} type="button" className={styles.viewerDockButton} data-label={item.label} data-near={hovered !== null && Math.abs(index - hovered) === 1 ? 'true' : undefined} title={item.label} aria-label={`${item.label}を表示`} aria-pressed={active === index} onMouseEnter={() => { setHovered(index); select(index); }} onMouseLeave={() => setHovered(null)} onFocus={() => select(index)} onClick={() => select(index)} onKeyDown={event => {
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          const next = (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
          select(next);
          event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
        }}><strong aria-hidden="true">{dockLabel(item.label)}</strong></button>)}
      </nav>}
    </div>
    {!separate && items.length > 1 && <p className={styles.viewerLegacyNote}>このPDFは旧形式のため資料別の表示に対応していません。資料を作成し直すと、資料ごとに表示できます。</p>}
  </div>;
}
