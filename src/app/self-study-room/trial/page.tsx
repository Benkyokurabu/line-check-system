import StudentTrial from './student-trial';
export const dynamic='force-dynamic';
export default async function StudentTrialPage({searchParams}:{searchParams:Promise<{staff?:string;from?:string}>}){const {staff,from}=await searchParams;return <StudentTrial entryCode={staff&&['KUDO','KINJO'].includes(staff)?staff:''} returnTo={from==='menu'?'menu':from==='staff'?'staff':undefined}/>;}
