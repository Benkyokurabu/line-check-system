import InterviewWorkspace from './desk';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{staff?:string;tab?:string}>}){
 const {staff,tab}=await searchParams;
 const initialTab=tab==='invitations'?'invitations':tab==='requests'?'requests':'home';
 return <InterviewWorkspace key={initialTab} initialTab={initialTab} entryCode={staff&&['KUDO','KINJO'].includes(staff)?staff:''}/>;
}
