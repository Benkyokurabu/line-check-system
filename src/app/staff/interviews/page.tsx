import InterviewWorkspace from './desk';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{staff?:string;tab?:string;answer?:string}>}){
 const {staff,tab,answer}=await searchParams;
 const initialAnswer=answer&&/^[a-f0-9]{32}$/i.test(answer)?answer.toLowerCase():'';
 const initialTab=tab==='invitations'?'invitations':tab==='requests'?'requests':'home';
 return <InterviewWorkspace key={initialTab+initialAnswer} initialTab={initialTab} initialAnswer={initialAnswer} entryCode={staff&&['KUDO','KINJO'].includes(staff)?staff:''}/>;
}
