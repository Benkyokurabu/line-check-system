'use client';
import {useState} from 'react';
import FlowDialog from '@/components/flow-dialog';
import {LineRegistrationForm} from '@/app/LineRegistrationForm';

export default function RecipientRegistration({account,studentNumber,staffName,onClose,onRegistered,onBusy}:{account:{id:string;label:string;aliasName?:string;displayName?:string;relation?:string};studentNumber:string;staffName:string;onClose:()=>void;onRegistered:()=>Promise<void>;onBusy:(busy:boolean)=>void}){
 const [saving,setSaving]=useState(false);
 return <FlowDialog label="LINEの本人・続柄を確認" blocked={saving} onBack={onClose}>
  <h2>送信先の本人・続柄を確認</h2><p>登録済みの宛先候補：{account.label}</p><p>このLINEのメッセージと生徒・続柄を確認して登録します。面談の入力内容は保持します。登録だけではLINEを送信しません。</p>
  <LineRegistrationForm userId={account.id} displayName={account.displayName||account.aliasName||account.label} initialStudentNumber={studentNumber} initialRelation={account.relation&&account.relation!=='unknown'?account.relation:undefined} initialAlias={account.aliasName} source="post_interview_review" confirmedBy={staffName} onSavingChange={value=>{setSaving(value);onBusy(value);}} onClose={onClose} onSaved={async()=>{await onRegistered();onClose();}} />
 </FlowDialog>;
}
