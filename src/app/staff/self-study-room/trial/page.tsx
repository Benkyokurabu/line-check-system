import StaffStudyRoom from '../staff-study-room';

export const dynamic = 'force-dynamic';
export default async function StaffStudyRoomTrialPage({searchParams}:{searchParams:Promise<{staff?:string}>}) {
  const {staff}=await searchParams;
  return <StaffStudyRoom trial entryCode={staff&&['KUDO','KINJO'].includes(staff)?staff:''} />;
}
