type Time={date:string;start:string;end:string};
type Slot=Time&{id:string;campus:string;available:boolean};
type Row={id:string;status:string;version:number;choices:Slot[];confirmed:Slot|null;details:{note:string};reason?:string};
export function studentPreviewState(value:{studentName:string;slots:Slot[];requests:Row[]}){
 const candidates=value.slots.filter(s=>s.campus==='本校'&&['13:00','14:00'].includes(s.start));
 const dates=[...new Set(candidates.map(s=>s.date))].sort().slice(0,5);
 return {students:[{id:'preview',name:value.studentName}],
  slots:candidates.filter(s=>s.available&&dates.includes(s.date)).map(s=>({id:s.id,studentId:'preview',date:s.date,start:s.start,end:s.end})),
  requests:value.requests.map(r=>({id:r.id,studentId:'preview',version:r.version,status:['approved','change_requested','cancel_requested'].includes(r.status)?'approved':r.status,note:r.details.note,reason:r.reason??'',choices:r.choices.map(s=>({slotId:s.id,date:s.date,start:s.start,end:s.end})),confirmed:r.confirmed?{...r.confirmed,status:r.status==='cancelled'?'cancelled':'confirmed'}:null}))};
}
export function studentPreviewOperation(op:Record<string,unknown>){
 if(op.action==='submit')return {operationKey:op.operationKey,action:'submit',choices:op.choices,note:op.note,method:'Zoom',purpose:'オンライン面談の操作確認',participants:'本人・保護者'};
 if(op.action==='withdraw')return {operationKey:op.operationKey,action:'cancel',id:op.id,version:op.version,reason:'生徒役で申請を取り下げ'};
 throw Error('検証画面の操作を確認してください。');
}
