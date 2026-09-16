'use client';
import {useEffect,useRef,useState} from 'react';
export default function Entry(){
 const started=useRef(false),[error,setError]=useState('');
 useEffect(()=>{
  if(started.current)return;started.current=true;
  const params=new URLSearchParams(location.hash.slice(1)),key=params.get('key'),destination=params.get('to')??'interviews';
  history.replaceState(null,'',location.pathname);
  void(async()=>{
   await Promise.resolve();
   if(!key){setError('LINEの個別メニューから開いてください。');return;}
   try{
    const response=await fetch('/api/staff/entry',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({key,destination})});
    const body=await response.json();
    if(!response.ok){setError(response.status===429?'少し時間を置いて、LINEのメニューから開き直してください。':'専用入口を確認できませんでした。LINEのメニューから開き直してください。');return;}
    if(typeof body.destination!=='string'||!/^\/(staff\/interviews|self-study-room\/trial|reservations\/trial|interviews\/trial)\?staff=(KUDO|KINJO)(&kind=interview)?$/.test(body.destination))throw Error();
    location.replace(body.destination);
   }catch{setError('接続できませんでした。LINEのメニューから開き直してください。');}
  })();
 },[]);
 return <main className="shell"><section className="panel"><h1>専用入口</h1>{error?<p role="alert">{error}</p>:<p role="status">開いています…</p>}</section></main>;
}
