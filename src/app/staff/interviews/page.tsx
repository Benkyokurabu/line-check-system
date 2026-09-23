import InterviewWorkspace from './desk';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{staff?:string;tab?:string}>}){
 const {staff,tab}=await searchParams;
 return <InterviewWorkspace key={tab==='invitations'?'invitations':'requests'} initialTab={tab==='invitations'?'invitations':'requests'} entryCode={staff&&['KUDO','KINJO'].includes(staff)?staff:''}/>;
}
