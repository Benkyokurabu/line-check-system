import RecordingWorkspace from './workspace';
import {currentRecordingMonth} from '@/lib/recording-publication.mjs';
export const metadata={title:'録画の公開設定',robots:{index:false,follow:false}};
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{month?:string;key?:string}>}){
 const params=await searchParams;
 const month=params.month&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(params.month)?params.month:currentRecordingMonth();
 return <RecordingWorkspace initialMonth={month} initialKey={params.key}/>;
}
