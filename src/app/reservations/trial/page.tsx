import ReservationTrial from './workspace';
import {pageMetadata} from '@/lib/page-titles';
export const dynamic='force-dynamic';
export async function generateMetadata({searchParams}:{searchParams:Promise<{kind?:string}>}){
 const {kind}=await searchParams;
 return pageMetadata(kind==='interview'?'面談予約':'予約メニュー');
}
export default async function Page({searchParams}:{searchParams:Promise<{staff?:string;kind?:string}>}){
 const {staff,kind}=await searchParams;
 return <ReservationTrial entryCode={staff&&['KUDO','KINJO'].includes(staff)?staff:''} view={kind==='interview'?'student':'menu'}/>;
}
