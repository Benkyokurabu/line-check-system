"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState,type CSSProperties} from "react";
import StaffLogin from "@/components/staff-login";
import BenkeiAuthoring from "@/components/benkei-authoring";
type Reader={readerId:string;name:string;confirmedAt:string|null;version?:number};
type Item={id:string;title:string;body:string;source_url:string;source_hash:string;source_edited_at:string|null;version:number;confirmed:boolean;dismissed?:boolean;readers:Reader[];history:Reader[]};
type Payload={staff:{staffId:string;displayName:string;staffCode:string;readerId:string;role:string;trialOnly:boolean};items:Item[];unreadCount:number;hasMore:boolean;sync?:{last_sync_at:string|null;sync_status:string}};
type Notice={message:string;undoIds?:string[]};
const panel:CSSProperties={border:'1px solid var(--line)',borderRadius:14,background:'var(--surface)',padding:'clamp(16px, 3vw, 24px)',marginBottom:20,overflowWrap:'anywhere'};
const actions:CSSProperties={display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'};
const button:CSSProperties={display:'inline-flex',justifyContent:'center',alignItems:'center',minHeight:44,padding:'10px 16px',borderWidth:1,borderStyle:'solid',borderColor:'var(--line)',borderRadius:8,background:'white',color:'var(--foreground)',fontSize:14,fontWeight:700,textAlign:'center',cursor:'pointer'};
const primary:CSSProperties={...button,background:'var(--accent)',color:'white',borderColor:'var(--accent)'};
function when(value:string|null|undefined){if(!value)return '日時不明';const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(date):'日時不明'}
function notionUrl(value:string){try{const url=new URL(value);return url.protocol==='https:'&&['www.notion.so','notion.so','app.notion.com'].includes(url.hostname)?url.href:null}catch{return null}}
function LinkedBody({text}:{text:string}){
 return <>{text.split(/(https:\/\/[^\s<>"'（）]+)/gu).map((part,index)=>{
  if(!part.startsWith('https://'))return part;
  const candidate=part.replace(/[)）\]｝}。、，．：；！？!?,.;:」』】〉》]+$/gu,''),suffix=part.slice(candidate.length);
  try{const url=new URL(candidate);if(url.protocol==='https:'&&url.hostname)return <span key={index}><a href={url.href} target="_blank" rel="noopener noreferrer" style={{color:'var(--accent)',textDecoration:'underline',textUnderlineOffset:3}}>{candidate}</a>{suffix}</span>}catch{/* Preserve invalid addresses as text. */}
  return part;
 })}</>;
}
export default function BenkeiHome({fullPage=false}:{fullPage?:boolean}){
 const [data,setData]=useState<Payload|null>(null),[access,setAccess]=useState<'loading'|'ready'|'login'|'denied'|'error'>('loading');
 const [all,setAll]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState<Notice|null>(null),[selected,setSelected]=useState<string[]>([]),[expanded,setExpanded]=useState<string[]>([]);
 const [removedRows,setRemovedRows]=useState<{item:Item;position:number}[]>([]);
 const generation=useRef(0),mutationLock=useRef(false);
 const refresh=useCallback(async(append=false,offset=0)=>{
  const request=++generation.current;setLoading(true);
  try{
   const response=await fetch(`/api/staff/benkei?all=${all?1:0}&offset=${offset}`,{cache:'no-store'});if(request!==generation.current)return;
   if(response.status===401||response.status===403){setData(null);setSelected([]);setAccess(response.status===401?'login':'denied');return}
   if(!response.ok)throw Error('ベンケイを読み込めませんでした。再読み込みしてください。');
   const body=await response.json() as Payload;if(request!==generation.current)return;
   if(!Array.isArray(body.items)||!body.staff||typeof body.unreadCount!=='number')throw Error('ベンケイを読み込めませんでした。');
   setData(previous=>append&&previous?{...body,items:[...new Map([...previous.items,...body.items].map(item=>[item.id,item])).values()]}:body);setAccess('ready');setError('');
  }catch(caught){if(request===generation.current){setError((caught as Error).message);setAccess(current=>current==='ready'?'ready':'error')}}finally{if(request===generation.current)setLoading(false)}
 },[all]);
 useEffect(()=>{
  const initial=setTimeout(()=>void refresh(),0);const focus=()=>{if(document.visibilityState==='visible'&&!mutationLock.current)void refresh()};const timer=setInterval(focus,60000);
  window.addEventListener('focus',focus);window.addEventListener('bentan:staff-session-active',focus);
  return()=>{generation.current += 1;clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('bentan:staff-session-active',focus)};
 },[refresh]);
 async function mutate(action:'confirm'|'sync'|'dismiss'|'restore',item?:Item,itemIds?:string[]){
  if(mutationLock.current)return;mutationLock.current=true;setBusy(item?.id??action);setError('');generation.current++;
  try{
   const body=action==='confirm'&&item?{action,itemId:item.id,version:item.version,sourceHash:item.source_hash}:action==='dismiss'||action==='restore'?{action,itemIds}:{action};
   const response=await fetch('/api/staff/benkei',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(response.status===401||response.status===403){setData(null);setSelected([]);setAccess(response.status===401?'login':'denied');return}
   if(response.status===409){await refresh();setSelected([]);setError('内容が更新されたか、未確認の項目が含まれています。最新の本文と確認状態を確認してください。');return}
   if(!response.ok)throw Error(action==='sync'?'Notionとの同期に失敗しました。時間をおいて再度お試しください。':'操作を保存できませんでした。確認状態を再読み込みしてからお試しください。');
   if(action==='dismiss')setRemovedRows(current=>[...current,...(data?.items??[]).flatMap((value,position)=>itemIds?.includes(value.id)&&!current.some(row=>row.item.id===value.id)?[{item:value,position}]:[])]);
   await refresh();
   if(action==='confirm')setNotice({message:'確認済みにしました。行は一覧に残っています。外す場合は左のチェックで選択して、一覧から外すボタンを押してください。'});
   if(action==='sync')setNotice({message:'Notionの最新内容を取得しました。'});
   if(action==='dismiss'){setSelected([]);setNotice({message:`${itemIds?.length??0}件を自分の確認一覧から外しました。同じ場所に結果を残しています。全件の本文・確認履歴は残っています。`,undoIds:itemIds})}
   if(action==='restore'){setRemovedRows(current=>current.filter(row=>!itemIds?.includes(row.item.id)));setSelected([]);setNotice({message:'一覧から外す操作を取り消しました。自分の確認一覧に戻しました。'})}
  }catch(caught){setError((caught as Error).message)}finally{mutationLock.current=false;setBusy(null)}
 }
 const selectedConfirmed=data?.items.filter(item=>item.confirmed&&!item.dismissed&&selected.includes(item.id)).map(item=>item.id)??[];
 const displayItems=[...(data?.items??[])];
 if(!all)for(const removed of [...removedRows].sort((a,b)=>a.position-b.position))if(!displayItems.some(item=>item.id===removed.item.id))displayItems.splice(Math.min(removed.position,displayItems.length),0,removed.item);
 if(!fullPage&&['loading','login','denied'].includes(access))return null;
 if(access==='login')return <StaffLogin onLogin={()=>void refresh()}/>;
 if(access==='denied')return <section style={panel}><h2>ベンケイ</h2><p>このアカウントではベンケイを利用できません。</p><Link href="/" style={{...button,marginTop:12}}>ホームへ戻る</Link></section>;
 if(access==='loading')return <p role="status">ベンケイを読み込み中…</p>;
 return <section style={panel} aria-label="ベンケイの確認">
  <div style={{...actions,justifyContent:'space-between',marginBottom:12}}><div><h2 style={{fontSize:20,marginBottom:6}}>ベンケイ</h2><p>{data?`${data.staff.displayName}さんの未確認 ${data.unreadCount}件`:'共有事項を確認する'}</p></div>{!fullPage&&<Link href="/staff/benkei" prefetch={false} style={button}>連絡一覧・確認者を見る</Link>}</div>
  <p style={{fontSize:12,marginBottom:8}}>Notionのベンケイと連携しています。</p>
  {data?.staff.trialOnly&&<p style={{fontSize:13,marginBottom:12}}>操作確認中：現在は利用対象を限定しています。</p>}
  {fullPage&&data&&<BenkeiAuthoring/>}
  <p style={{fontSize:13,marginBottom:14}}>行を押すと本文が開きます。確認後も行は残り、選択して「一覧から外す」を押した項目だけ、自分の確認一覧から外れます。</p>
  {fullPage&&<div style={{...actions,marginBottom:16}} role="group" aria-label="表示するベンケイ"><button type="button" style={all?button:primary} aria-pressed={!all} disabled={!!busy} onClick={()=>{setAll(false);setSelected([])}}>自分の確認一覧</button><button type="button" style={all?primary:button} aria-pressed={all} disabled={!!busy} onClick={()=>{setAll(true);setSelected([])}}>全件・確認者</button></div>}
  {error&&<p role="alert" style={{color:'#a32626',marginBottom:12}}>{error}</p>}
  {error&&data&&<p style={{fontSize:12,marginBottom:12}}>最後に読み込めた情報を表示しています。最新の確認状態は再読み込み後に確認してください。</p>}
  {notice&&<div role="status" aria-live="polite" style={{border:'1px solid #b7d4c9',borderRadius:8,background:'#eef7f2',padding:14,marginBottom:14}}><p style={{color:'var(--foreground)',fontSize:13}}>{notice.message}</p>{!!notice.undoIds?.length&&<button type="button" style={{...button,marginTop:8}} disabled={!!busy||loading} onClick={()=>void mutate('restore',undefined,notice.undoIds)}>一覧から外す操作を取り消す</button>}</div>}
  {data&&!displayItems.length&&<p style={{padding:'12px 0'}}>{all?'共有事項はまだありません。':'自分の確認一覧に表示する項目はありません。全件の本文・履歴は連絡一覧から確認できます。'}</p>}
  <div style={{display:'grid',gap:8}}>{displayItems.map(item=>{
   if(!all&&removedRows.some(row=>row.item.id===item.id)&&!data?.items.some(value=>value.id===item.id))return <article key={item.id} style={{border:'1px solid var(--line)',borderRadius:9,padding:'12px 16px',background:'#f5f8f5'}}><h3 style={{fontSize:14,marginBottom:4}}>{item.title}</h3><p style={{fontSize:12}}>自分の一覧から外しました。本文・確認履歴は残っています。</p><button type="button" style={{...button,marginTop:8}} disabled={!!busy||loading} onClick={()=>void mutate('restore',undefined,[item.id])}>元に戻す</button></article>;
   const readers=item.readers??[],history=item.history??[],confirmed=readers.filter(reader=>reader.confirmedAt),url=notionUrl(item.source_url),open=expanded.includes(item.id);
   return <article key={item.id} style={{border:'1px solid var(--line)',borderRadius:9,minWidth:0,overflow:'hidden'}}>
    <div style={{display:'flex',alignItems:'center',gap:2,padding:'6px 8px'}}>
     <label style={{display:'flex',alignItems:'center',justifyContent:'center',width:38,minHeight:48,flexShrink:0}} title={!item.confirmed?'未確認の項目は一覧から外せません':'一覧から外す項目を選択'}><input type="checkbox" aria-label={`${item.title}を一覧から外す対象に選択`} style={{width:18,height:18}} checked={selected.includes(item.id)} disabled={!item.confirmed||item.dismissed||!!busy||loading} onChange={event=>setSelected(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/></label>
     <button type="button" aria-expanded={open} aria-controls={`benkei-body-${item.id}`} onClick={()=>setExpanded(current=>open?current.filter(id=>id!==item.id):[...current,item.id])} style={{border:0,background:'transparent',color:'var(--foreground)',padding:'6px 4px',minWidth:0,flex:1,textAlign:'left',cursor:'pointer'}}><h3 style={{fontSize:14,lineHeight:1.6,margin:'0 0 3px'}}>{item.title} <span aria-hidden="true">{open?'▴':'▾'}</span></h3><span style={{display:'block',color:item.confirmed?'var(--accent)':'#9b5b08',fontSize:12}}>{item.confirmed?'確認済み':item.version>1?'改訂・再確認が必要':'未確認'}{item.dismissed?' ・ 自分の一覧から外した項目':''} ・ 第{item.version}版 ・ {when(item.source_edited_at)}</span></button>
    </div>
    {open&&<div id={`benkei-body-${item.id}`} style={{borderTop:'1px solid var(--line)',padding:'16px 18px'}}><div style={{whiteSpace:'pre-wrap',lineHeight:1.85,marginBottom:16,fontSize:14}}><LinkedBody text={item.body||'本文がありません。原文をご確認ください。'}/></div><div style={actions}>{!item.confirmed?<button type="button" style={primary} disabled={!!busy||loading} onClick={()=>void mutate('confirm',item)}>{busy===item.id?'保存中…':'読んで確認した'}</button>:<p style={{color:'var(--accent)',fontSize:13}}>この版は確認済みです。行は一覧に残っています。</p>}{url&&<a href={url} target="_blank" rel="noopener noreferrer" style={button}>Notionの原文を開く ↗</a>}{item.dismissed&&<button type="button" style={button} disabled={!!busy||loading} onClick={()=>void mutate('restore',undefined,[item.id])}>自分の確認一覧に戻す</button>}</div>
     <button type="button" style={{...button,marginTop:12}} disabled={!item.confirmed||item.dismissed||!!busy||loading} onClick={()=>void mutate('dismiss',undefined,[item.id])}>自分の一覧から削除</button>
     <p style={{fontSize:12,marginTop:6}}>確認後に自分の一覧から外せます。Notion原文・全件履歴は削除しません。</p>
     <details style={{marginTop:14}}><summary style={{cursor:'pointer',minHeight:36,padding:'8px 0',fontSize:13,fontWeight:700}}>確認者 {confirmed.length} / {readers.length}人</summary><div style={{display:'grid',gap:6,marginTop:8}}>{readers.map(reader=><p key={reader.readerId} style={{fontSize:13}}>{reader.name}：{reader.confirmedAt?`確認済み ${when(reader.confirmedAt)}`:'未確認'}</p>)}</div>{history.some(receipt=>receipt.version!==item.version)&&<details style={{marginTop:10}}><summary style={{cursor:'pointer',padding:'8px 0',fontSize:13}}>過去の版の確認履歴</summary>{history.filter(receipt=>receipt.version!==item.version).map((receipt,index)=><p key={`${receipt.readerId}-${receipt.version}-${index}`} style={{fontSize:12}}>第{receipt.version}版 ・ {receipt.name} ・ {when(receipt.confirmedAt)}</p>)}</details>}</details>
    </div>}
   </article>;
  })}</div>
  {!!data?.items.length&&<div style={{...actions,marginTop:14}}><button type="button" style={button} disabled={!selectedConfirmed.length||loading||!!busy} onClick={()=>void mutate('dismiss',undefined,selectedConfirmed)}>選択した確認済み項目を一覧から外す</button><span style={{fontSize:12,color:'var(--muted)'}}>{selectedConfirmed.length}件選択 ・ 未確認の項目は外せません</span></div>}
  <div style={{...actions,marginTop:16}}>{data?.hasMore&&<button type="button" style={button} disabled={loading||!!busy} onClick={()=>void refresh(true,data.items.length)}>{loading?'読み込み中…':'続きを表示'}</button>}<button type="button" style={button} disabled={loading||!!busy} onClick={()=>{setRemovedRows([]);void refresh()}}>{loading?'読み込み中…':'確認状態を再読み込み'}</button>{fullPage&&data?.staff.staffCode==='KUDO'&&<button type="button" style={button} disabled={loading||!!busy} onClick={()=>void mutate('sync')}>{busy==='sync'?'同期中…':'Notionの最新内容を取得'}</button>}</div>
  {fullPage&&data?.sync&&<p style={{fontSize:12,marginTop:12}}>最終取得：{when(data.sync.last_sync_at)}{data.sync.sync_status!=='ok'&&' ・ 最新内容の取得を確認してください'}</p>}
 </section>;
}
