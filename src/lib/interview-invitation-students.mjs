export const surveyKey=row=>JSON.stringify([row.source_name??'',row.school_year??'',row.round_label??'',row.subject??'']);
export function invitationStudents(students,surveys){
 const rounds=new Map();
 for(const row of surveys){const id=surveyKey(row),old=rounds.get(id);rounds.set(id,{id,label:[row.source_name,row.school_year,row.round_label,row.subject].filter(Boolean).join(' ／ '),latest:row.answered_at&&(!old?.latest||row.answered_at>old.latest)?row.answered_at:old?.latest??null});}
 return {rounds:[...rounds.values()].sort((a,b)=>(b.latest??'').localeCompare(a.latest??'')||a.id.localeCompare(b.id)),students:students.filter(s=>s.enrollment_status==='current_roster').map(s=>({id:s.id,number:s.student_number,name:s.student_name,teacher:s.homeroom_teacher??'',grade:s.grade??'',pilot:s.student_number==='2018999',surveys:[...rounds.keys()].map(round=>{
  const rows=surveys.filter(r=>surveyKey(r)===round&&r.student_number===s.student_number),linked=rows.filter(r=>r.link_status==='linked');
  const eligible=surveys.find(r=>surveyKey(r)===round)?.eligible_grades;
  return {round,status:linked.length?'submitted':rows.length||eligible&&!eligible.includes(s.grade)?'unknown':'missing',date:linked.map(r=>r.answered_at).filter(Boolean).sort().at(-1)??null};
 })})),syncedAt:surveys.map(r=>r.synced_at).filter(Boolean).sort().at(-1)??null};
}
export function filterInvitationStudents(students,{round='',teacher='',status='',query='',from='',to='',sort='date-desc'}={}){
 const tokens=query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return students.map(s=>({...s,answer:s.surveys.find(r=>r.round===round)??{status:'unknown',date:null}})).filter(s=>
  (!teacher||s.teacher===teacher)&&(!status||s.answer.status===status)&&tokens.every(t=>`${s.name} ${s.number}`.normalize('NFKC').toLocaleLowerCase().includes(t))&&
  (!from||s.answer.date&&s.answer.date.slice(0,10)>=from)&&(!to||s.answer.date&&s.answer.date.slice(0,10)<=to)
 ).sort((a,b)=>{
  let c=0;
  if(sort.startsWith('date')){const x=a.answer.date,y=b.answer.date;c=!x&&!y?0:!x?1:!y?-1:sort==='date-asc'?x.localeCompare(y):y.localeCompare(x);}
  else if(sort==='teacher'||sort==='name'||sort==='number')c=String(a[sort]).localeCompare(String(b[sort]),'ja');
  else {const ranks=sort==='missing'?{missing:0,unknown:1,submitted:2}:{submitted:0,missing:1,unknown:2};c=ranks[a.answer.status]-ranks[b.answer.status];}
  return c||a.number.localeCompare(b.number);
 });
}
