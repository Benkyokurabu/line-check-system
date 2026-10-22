import 'server-only';
import {notionRequest} from '@/lib/notion';
import {readAnnouncements,readBenkeiItem} from '@/lib/benkei-core.mjs';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {createSupabaseAdminClient} from '@/lib/supabase';
type Database=ReturnType<typeof createSupabaseAdminClient>;
function pacedRequest(){let last=0;return async(path:string)=>{const wait=350-(Date.now()-last);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));last=Date.now();return notionRequest(path);};}
export async function syncBenkei(db:Database){
 try{
  const items=await readAnnouncements(pacedRequest());
  const {data,error}=await db.rpc('benkei_complete_sync',{p_items:items});if(error)throw new Error('benkei_import_failed');
  return {imported:data,scope:'ベンケイ上部の共有連絡。進捗表・埋込DBは対象外。'};
 }catch{
  await db.from('bentan_benkei_settings').update({sync_status:'failed',sync_error:'原文の取得が完了しませんでした。前回取得分を表示しています。'}).eq('singleton',true);
  throw new StaffAuthError('auth_unavailable',503);
 }
}
export async function verifyBenkeiSource(db:Database,id:string,hash:string){
 const {data:item,error}=await db.from('bentan_benkei_items').select('source_id').eq('id',id).eq('active',true).single();
 if(error||!item)throw new StaffAuthError('invalid_request',400);
 try{
  const request=pacedRequest();const block=await request(`/blocks/${item.source_id}`);const current=await readBenkeiItem(block,request);
  if(current.hash!==hash){const imported=await db.rpc('benkei_import',{p_items:[current]});if(imported.error)throw new Error();throw new StaffAuthError('reservation_conflict',409);}
 }catch(error){if(error instanceof StaffAuthError)throw error;throw new StaffAuthError('auth_unavailable',503);}
}
