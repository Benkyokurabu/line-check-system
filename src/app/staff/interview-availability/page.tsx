import AvailabilityWorkspace from './workspace';
import {pageMetadata} from '@/lib/page-titles';
export const dynamic='force-dynamic';
export const metadata=pageMetadata('面談受付枠を作る');
export default async function Page({searchParams}:{searchParams:Promise<{staff?:string}>}){
 const {staff}=await searchParams,entryCode=staff&&/^[A-Za-z0-9_-]{1,64}$/.test(staff)?staff.toUpperCase():'';
 return <AvailabilityWorkspace entryCode={entryCode}/>;
}
