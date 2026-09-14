import ReservationTrial from './workspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{staff?:string;kind?:string}>}){
 const {staff,kind}=await searchParams;
 return <ReservationTrial entryCode={staff&&['KUDO','KINJO'].includes(staff)?staff:''} view={kind==='interview'?'student':'menu'}/>;
}
