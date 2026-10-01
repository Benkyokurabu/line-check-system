import Workspace from './workspace';
import {pageMetadata} from '@/lib/page-titles';
export const dynamic='force-dynamic';
export const metadata=pageMetadata('アンケートから面談を進める');
export default async function Page({searchParams}:{searchParams:Promise<{answer?:string}>}){
 const params=await searchParams;
 return <Workspace answerId={params.answer??''}/>;
}
