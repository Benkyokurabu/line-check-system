import InterviewWorkspace from './desk';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{staff?:string}>}){
 const {staff}=await searchParams;
 return <InterviewWorkspace entryCode={staff&&['KUDO','KINJO'].includes(staff)?staff:''}/>;
}
