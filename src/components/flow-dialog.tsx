'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import styles from './flow-dialog.module.css';

/** One visible step, with a reachable back action and focus kept inside it. */
export default function FlowDialog({label,onBack,blocked=false,children,notice}:{label:string;onBack:()=>void;blocked?:boolean;children:ReactNode;notice?:ReactNode}){
 const root=useRef<HTMLDivElement>(null);
 const latest=useRef({onBack,blocked});
 useEffect(()=>{latest.current={onBack,blocked};});
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';root.current?.focus();
  function keydown(event:KeyboardEvent){
   if(event.key==='Escape'){event.preventDefault();if(!latest.current.blocked)latest.current.onBack();}
   if(event.key!=='Tab'||!root.current)return;
   const elements=Array.from(root.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(el=>el.getClientRects().length);
   const first=elements[0],last=elements.at(-1);
   if(!first){event.preventDefault();root.current.focus();}
   else if(event.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===root.current)){event.preventDefault();first.focus();}
  }
  document.addEventListener('keydown',keydown);
  return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 return <section className={styles.overlay} role="dialog" aria-modal="true" aria-label={label}>
  <div className={styles.dialog} ref={root} tabIndex={-1}>
   <div className={styles.header}><button type="button" onClick={onBack} disabled={blocked}>← 戻る</button><span>{label}</span></div>
   {notice&&<div className={styles.notice}>{notice}</div>}
   <div className={styles.body}>{children}</div>
  </div>
 </section>;
}
