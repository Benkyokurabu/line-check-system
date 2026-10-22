import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {StaffAuthError} from '@/lib/staff-auth-core.mjs';
import {syncBenkei,verifyBenkeiSource} from '@/lib/benkei-sync';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=60;
type Context=Awaited<ReturnType<typeof staffContext>>;
function checked<T>(result:{data:T;error:{message?:string}|null}):T{if(result.error){const text=result.error.message??'';throw new StaffAuthError(text.includes('permission_denied')?'permission_denied':text.includes('benkei_conflict')?'reservation_conflict':'auth_unavailable',text.includes('permission_denied')?403:text.includes('benkei_conflict')?409:503);}return result.data;}
function identity(c:Context){return {p_auth_user_id:c.identity.authUserId,p_auth_session_id:c.identity.authSessionId};}
export async function GET(request:NextRequest){let c:Context|undefined;try{
 c=await staffContext(request);const all=request.nextUrl.searchParams.get('all')??'0',offset=Number(request.nextUrl.searchParams.get('offset')??0);
 if(!['0','1'].includes(all)||!Number.isInteger(offset)||offset<0||offset>1000000)throw new StaffAuthError('invalid_request',400);
 return staffResponse(checked(await c.dataClient.rpc('benkei_list',{...identity(c),p_all:all==='1',p_offset:offset})),c);
}catch(error){return staffErrorResponse(error,c);}}
export async function POST(request:NextRequest){let c:Context|undefined;try{
 assertStaffMutationOrigin(request);c=await staffContext(request);checked(await c.dataClient.rpc('benkei_actor',identity(c)));const body=await staffJsonBody(request);
 if(body.action==='sync')return staffResponse(await syncBenkei(c.dataClient),c);
 if(body.action==='dismiss'||body.action==='restore'){
  if(!Array.isArray(body.itemIds)||body.itemIds.length<1||body.itemIds.length>100||body.itemIds.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))throw new StaffAuthError('invalid_request',400);
  return staffResponse(checked(await c.dataClient.rpc('benkei_set_dismissed',{...identity(c),p_ids:body.itemIds,p_dismiss:body.action==='dismiss'})),c);
 }
 if(body.action!=='confirm'||typeof body.itemId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.itemId)||!Number.isInteger(body.version)||Number(body.version)<1||typeof body.sourceHash!=='string'||!body.sourceHash.match(/^[a-f0-9]{64}$/))throw new StaffAuthError('invalid_request',400);
 await verifyBenkeiSource(c.dataClient,body.itemId,body.sourceHash);
 return staffResponse(checked(await c.dataClient.rpc('benkei_confirm',{...identity(c),p_id:body.itemId,p_version:body.version,p_hash:body.sourceHash})),c);
}catch(error){return staffErrorResponse(error,c);}}
