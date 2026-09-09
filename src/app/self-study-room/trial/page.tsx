import StudentTrial from './student-trial';
export const dynamic='force-dynamic';
export default async function StudentTrialPage({searchParams}:{searchParams:Promise<{staff?:string}>}){const {staff}=await searchParams;return <StudentTrial entryCode={staff&&['KUDO','KINJO'].includes(staff)?staff:''}/>;}
