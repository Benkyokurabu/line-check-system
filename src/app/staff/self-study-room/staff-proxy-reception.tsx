'use client';
import {useState} from 'react';
import StaffIntake from './staff-intake';
import StaffProxyCancel from './staff-proxy-cancel';
import styles from './staff-proxy-reception.module.css';
export type ProxyProps={busy:boolean;request:(url:string,init?:RequestInit)=>Promise<unknown>;work:(task:()=>Promise<void>)=>Promise<void>;onPending:(pending:boolean)=>void;onDone:(date:string)=>Promise<void>};
export default function StaffProxyReception({canSubmit,canCancel,...props}:ProxyProps&{canSubmit:boolean;canCancel:boolean}){
 const [mode,setMode]=useState<'submit'|'cancel'|null>(null),[pending,setPending]=useState(false);
 const onPending=(value:boolean)=>{setPending(value);props.onPending(value);};
 return <section aria-label="職員の代理手続き" className={styles.panel}>
  <h2>生徒の代わりに行う手続き</h2><p>電話・LINEなどで受けた依頼の目的を選んでください。</p>
  <div className={styles.choices}>
   {canSubmit&&<button type="button" disabled={props.busy||pending} aria-pressed={mode==='submit'} onClick={()=>setMode('submit')}><strong>予約を申し込む</strong><span>生徒を選び、希望の日時・座席を申請</span></button>}
   {canCancel&&<button type="button" disabled={props.busy||pending} aria-pressed={mode==='cancel'} onClick={()=>setMode('cancel')}><strong>予約を取り消す</strong><span>生徒の予約を探して、代わりに取消</span></button>}
  </div>
  {mode==='submit'&&canSubmit&&<StaffIntake {...props} onPending={onPending}/>}
  {mode==='cancel'&&canCancel&&<StaffProxyCancel {...props} onPending={onPending}/>}
 </section>;
}
