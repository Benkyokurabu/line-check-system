import AvailabilityWorkspace from './workspace';
import {pageMetadata} from '@/lib/page-titles';
export const dynamic='force-dynamic';
export const metadata=pageMetadata('予約可能枠を作る');
export default async function Page({searchParams}:{searchParams:Promise<{staff?:string}>}){
 const {staff}=await searchParams,entryCode=staff&&/^[A-Za-z0-9_-]{1,64}$/.test(staff)?staff.toUpperCase():'';
 return <><div style={{maxWidth:780,margin:'16px auto 0',padding:'0 16px'}}><a href="/staff/interview-availability/manual" style={{display:'inline-flex',alignItems:'center',minHeight:44,padding:'0 16px',borderRadius:9,background:'#177d63',color:'#fff',textDecoration:'none',fontWeight:700}}>Notionの予約可を確認・削除</a></div><AvailabilityWorkspace entryCode={entryCode}/></>;
}
