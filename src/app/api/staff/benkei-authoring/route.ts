import {NextRequest} from 'next/server';
import {staffContext,staffResponse,staffErrorResponse,staffJsonBody,assertStaffMutationOrigin} from '@/lib/staff-auth-http';
import {notionRequest} from '@/lib/notion';
import {BenkeiAuthoringError,readAuthoring,saveAuthoring,processAuthoring,publicAuthoringOperation} from '@/lib/benkei-authoring.mjs';
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=60;
type Context=Awaited<ReturnType<typeof staffContext>>;
function request(path:string,init:RequestInit={}){return notionRequest(path,{...init,signal:AbortSignal.timeout(18000)});}
function failure(error:unknown,c?:Context){
 if(error instanceof BenkeiAuthoringError){const messages:Record<string,string>={source_conflict:'Notionの原文が更新されています。原文を確認し、入力内容を照合してください。',source_structure_changed:'Notionで構成が変更されています。原文から編集してください。',content_too_large:'本文が保存可能な容量を超えています。内容を分けてください。',permission_denied:'この操作を行う権限がありません。',source_not_owned:'勉たんで作成した連絡だけを編集できます。',prior_result_unknown:'同じ内容の保存結果を確認中です。既存の操作から原文の反映結果を確認してください。'};return staffResponse({error:messages[error.code]??'保存内容または接続を確認してください。入力内容は保持されています。',code:error.code},c,error.status);}
 return staffErrorResponse(error,c);
}
export async function GET(req:NextRequest){let c:Context|undefined;try{
 c=await staffContext(req);const id=req.nextUrl.searchParams.get('operation');if(id&&!/^[0-9a-f-]{36}$/i.test(id))throw new BenkeiAuthoringError('invalid_request');
 return staffResponse(await readAuthoring({db:c.dataClient,identity:c.identity,operationId:id}),c);
}catch(error){return failure(error,c);}}
export async function POST(req:NextRequest){let c:Context|undefined;try{
 assertStaffMutationOrigin(req);c=await staffContext(req);const body=await staffJsonBody(req,550000);
 if(body.action==='recover'){
  if(typeof body.operationId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.operationId))throw new BenkeiAuthoringError('invalid_request');
  const before=await readAuthoring({db:c.dataClient,identity:c.identity,operationId:body.operationId});if(!before.operation)throw new BenkeiAuthoringError('invalid_request');
  const processed=await processAuthoring({db:c.dataClient,request,id:body.operationId,recoverOnly:true});return staffResponse({operation:processed?publicAuthoringOperation(processed):before.operation},c);
 }
 if(body.action!=='save')throw new BenkeiAuthoringError('invalid_request');
 const result=await saveAuthoring({db:c.dataClient,request,identity:c.identity,body});
 const operation=result.operation;if(operation?.status==='conflict')return staffResponse({...result,error:'Notionの原文を確認し、入力内容を照合してください。',code:operation.errorCode??'source_conflict'},c,409);
 return staffResponse(result,c);
}catch(error){return failure(error,c);}}
