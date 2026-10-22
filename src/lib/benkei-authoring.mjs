import {createHash} from 'node:crypto';
import {BENKEI_PAGE,blockText,readBenkeiItem} from './benkei-core.mjs';
export const BENKEI_INSERT_AFTER='c8397cca-0e2f-4560-a2bd-68651df1646f';
export const AUTHORING_LIMITS={maxCharacters:190000,maxBytes:480000};
const ORIGIN='https://line-check-system.vercel.app';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export class BenkeiAuthoringError extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
export const authoringLink=id=>`${ORIGIN}/staff/benkei?operation=${id}`;
export const sourceLink=id=>`https://app.notion.com/p/${BENKEI_PAGE.replaceAll('-','')}#${id.replaceAll('-','')}`;
export function authoringRichText(payload,operationId){
 const content=`${payload.title}\n\n${payload.body}`;const parts=[];
 for(let start=0;start<content.length;){let end=Math.min(start+2000,content.length);if(end<content.length&&/[\uD800-\uDBFF]/.test(content[end-1]))end--;parts.push({type:'text',text:{content:content.slice(start,end)}});start=end;}
 parts.push({type:'text',text:{content:'\n\n勉たんで確認',link:{url:authoringLink(operationId)}}});
 if(parts.length>100)throw new BenkeiAuthoringError('content_too_large',413);return parts;
}
export function prepareAuthoring(body){
 if(!uuid(body?.operationId)||!['create','edit'].includes(body.kind)||typeof body.title!=='string'||typeof body.body!=='string')throw new BenkeiAuthoringError('invalid_request');
 const title=body.title.trim(),content=body.body.trim();
 if(!title||title.length>160||title.includes('\n')||title.includes('\r')||!content||content.length>=300000||content.length>AUTHORING_LIMITS.maxCharacters)throw new BenkeiAuthoringError('invalid_request');
 if(body.kind==='edit'&&(!uuid(body.sourceId)||typeof body.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedHash)))throw new BenkeiAuthoringError('invalid_request');
 const payload={title,body:content,...(body.kind==='edit'?{sourceId:body.sourceId,expectedHash:body.expectedHash}:{})};
 const richText=authoringRichText(payload,body.operationId);
 const block={object:'block',type:'callout',callout:{rich_text:richText,icon:{type:'emoji',emoji:'📣'}}};
 const create={after:BENKEI_INSERT_AFTER,children:[block]},update={callout:{rich_text:richText}};
 if(Math.max(Buffer.byteLength(JSON.stringify(create)),Buffer.byteLength(JSON.stringify(update)))>AUTHORING_LIMITS.maxBytes)throw new BenkeiAuthoringError('content_too_large',413);
 const desiredHash=hash(blockText(block).trim());
 return {id:body.operationId,kind:body.kind,payload,requestHash:hash({kind:body.kind,payload}),desiredHash,create,update};
}
function checked(result){if(result.error){const text=result.error.message??'';throw new BenkeiAuthoringError(text.includes('permission_denied')?'permission_denied':text.includes('idempotency')?'idempotency_conflict':text.includes('unknown_operation')?'prior_result_unknown':text.includes('source_not_owned')?'source_not_owned':'database_unavailable',text.includes('permission_denied')?403:text.includes('idempotency')||text.includes('unknown_operation')||text.includes('source_not_owned')?409:503);}return result.data;}
export function publicAuthoringOperation(row){return row?{id:row.id,kind:row.kind,status:row.status,sourceId:row.source_id??null,errorCode:row.error_code??null,payload:row.payload,result:row.result,sourceRef:row.source_id?sourceLink(row.source_id):null,createdAt:row.created_at,updatedAt:row.updated_at}:null;}
export function authoringInputFromSource(item){
 const content=item.body.replace(/\n\n勉たんで確認 \(https:\/\/line-check-system\.vercel\.app\/staff\/benkei\?operation=[0-9a-f-]+\)$/i,'');
 const at=content.indexOf('\n\n');return {title:at>=0?content.slice(0,at):item.title,body:at>=0?content.slice(at+2):content};
}
/** @param {{db:any,identity:{authUserId:string,authSessionId:string},operationId?:string|null}} options */
export async function readAuthoring({db,identity,operationId=null}){
 const data=checked(await db.rpc('benkei_authoring_read',{p_user:identity.authUserId,p_session:identity.authSessionId,p_operation:operationId}));
 if(operationId)return {operation:publicAuthoringOperation(data.operation),limits:AUTHORING_LIMITS};
 return {entries:(data.entries??[]).map(entry=>({sourceId:entry.source_id,...authoringInputFromSource(entry),sourceHash:entry.source_hash,sourceRef:entry.source_url,updatedAt:entry.updated_at})),operations:(data.operations??[]).map(publicAuthoringOperation),limits:AUTHORING_LIMITS};
}
async function originalChildren(request){
 const results=[];let cursor;
 for(let pages=0;pages<10;pages++){
  const response=await request(`/blocks/${BENKEI_PAGE}/children?page_size=100${cursor?`&start_cursor=${encodeURIComponent(cursor)}`:''}`);
  if(!Array.isArray(response.results)||response.has_more&&!response.next_cursor)throw new BenkeiAuthoringError('source_lookup_incomplete',503);
  results.push(...response.results);if(!response.has_more)return results;cursor=response.next_cursor;
 }
 throw new BenkeiAuthoringError('source_lookup_incomplete',503);
}
function hasMarker(block,operationId){return (block[block.type]?.rich_text??[]).some(part=>(part.href??part.text?.link?.url)===authoringLink(operationId));}
async function finish(db,operation,lease,status,{sourceId=null,item=null,errorCode=null}={}){
 return checked(await db.rpc('benkei_authoring_finish',{p_id:operation.id,p_lease:lease,p_status:status,p_source:sourceId,p_item:item,p_error:errorCode}));
}
/** A write is attempted once only. All repeats after a possible write are reads. */
export async function processAuthoring({db,request,id,recoverOnly=false}){
 const claim=checked(await db.rpc('benkei_authoring_claim',{p_id:id,p_recover_only:recoverOnly}));
 if(!claim)return null;
 const operation=claim.operation,lease=claim.lease;
 const prepared=prepareAuthoring({operationId:operation.id,kind:operation.kind,...operation.payload});
 let sourceId=operation.source_id,writeAttempted=false;
 try{
  if(claim.mode==='recover'){
   let source;
   if(sourceId)source=await request(`/blocks/${sourceId}`);
   else{
    const matches=(await originalChildren(request)).filter(block=>hasMarker(block,operation.id));
    if(matches.length!==1)return await finish(db,operation,lease,'unknown',{errorCode:matches.length?'multiple_sources_found':'result_not_confirmed'});
    source=matches[0];sourceId=source.id;
   }
   const item=await readBenkeiItem(source,request);
   if(item.hash!==prepared.desiredHash)return await finish(db,operation,lease,'unknown',{sourceId,errorCode:'result_does_not_match'});
   return await finish(db,operation,lease,'synced',{sourceId,item});
  }
  if(operation.kind==='create'){
   const children=await originalChildren(request),anchorIndex=children.findIndex(block=>block.id===BENKEI_INSERT_AFTER),dividerIndex=children.findIndex(block=>block.type==='divider');
   if(anchorIndex<0||dividerIndex>=0&&anchorIndex>=dividerIndex)throw new BenkeiAuthoringError('insertion_anchor_changed',409);
   const duplicates=children.filter(block=>hasMarker(block,operation.id));
   if(duplicates.length){sourceId=duplicates[0].id;const item=await readBenkeiItem(duplicates[0],request);return await finish(db,operation,lease,item.hash===prepared.desiredHash&&duplicates.length===1?'synced':'unknown',{sourceId,item:item.hash===prepared.desiredHash&&duplicates.length===1?item:null,errorCode:item.hash===prepared.desiredHash?null:'result_does_not_match'});}
   writeAttempted=true;
   const response=await request(`/blocks/${BENKEI_PAGE}/children`,{method:'PATCH',body:JSON.stringify(prepared.create)});
   if(!Array.isArray(response.results)||response.results.length!==1)throw new Error('write_result_unknown');
   sourceId=response.results[0].id;
  }else{
   const source=await request(`/blocks/${sourceId}`);
   const item=await readBenkeiItem(source,request);
   if(item.hash!==operation.payload.expectedHash){checked(await db.rpc('benkei_import',{p_items:[item]}));return await finish(db,operation,lease,'conflict',{sourceId,errorCode:'source_conflict'});}
   if(source.type!=='callout'||source.has_children||source.archived||source.in_trash)throw new BenkeiAuthoringError('source_structure_changed',409);
   writeAttempted=true;
   await request(`/blocks/${sourceId}`,{method:'PATCH',body:JSON.stringify(prepared.update)});
  }
  const source=await request(`/blocks/${sourceId}`),item=await readBenkeiItem(source,request);
  if(item.hash!==prepared.desiredHash)return await finish(db,operation,lease,'unknown',{sourceId,errorCode:'result_does_not_match'});
  return await finish(db,operation,lease,'synced',{sourceId,item});
 }catch(error){
  const rejected=writeAttempted&&[400,401,403,404,422,429].includes(error?.status);
  const status=!rejected&&(writeAttempted||claim.mode==='recover')?'unknown':error instanceof BenkeiAuthoringError&&error.status===409?'conflict':'blocked';
  return await finish(db,operation,lease,status,{sourceId,errorCode:rejected?'notion_write_rejected':writeAttempted?'write_result_unknown':error instanceof BenkeiAuthoringError?error.code:'source_read_failed'});
 }
}
export async function saveAuthoring({db,request,identity,body}){
 const prepared=prepareAuthoring(body);
 const operation=checked(await db.rpc('benkei_authoring_prepare',{p_user:identity.authUserId,p_session:identity.authSessionId,p_id:prepared.id,p_kind:prepared.kind,p_payload:prepared.payload,p_hash:prepared.requestHash,p_desired_hash:prepared.desiredHash}));
 if(operation.status==='synced'||operation.status==='conflict'||operation.status==='blocked')return {operation:publicAuthoringOperation(operation)};
 const processed=await processAuthoring({db,request,id:prepared.id});
 return {operation:publicAuthoringOperation(processed??operation)};
}
