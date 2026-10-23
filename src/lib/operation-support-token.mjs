import {createHmac,timingSafeEqual} from 'node:crypto';
export const OPERATION_SUPPORT_COOKIE='__Host-bentan-operation-support';
const lifetime=15*60;
function mac(secret,text){return createHmac('sha256',secret).update('operation-support-v1:'+text).digest('base64url');}
export function operationSupportActor(staffId,secret){return mac(secret,'actor:'+staffId);}
// This scope permits only analysis of non-private diagnostic enums. Business
// routes never accept it. Mint it only after the existing staff authorization.
export function operationSupportToken(staff,secret,now=Date.now()){
 if(!secret||typeof staff?.staffId!=='string')return null;
 const remaining=Math.floor((Date.parse(staff.expiresAt)-now)/1000),ttl=Math.min(lifetime,remaining);
 if(!Number.isFinite(ttl)||ttl<=0)return null;
 const body=Buffer.from(JSON.stringify({v:1,scope:'operation-analysis',actor:operationSupportActor(staff.staffId,secret),exp:Math.floor(now/1000)+ttl})).toString('base64url');
 return {value:body+'.'+mac(secret,body),maxAge:ttl};
}
export function verifyOperationSupportToken(token,secret,now=Date.now()){
 if(!secret||typeof token!=='string'||token.length>1024)return null;
 try{
  const [body,signature,...extra]=token.split('.');if(extra.length||!body||!signature)return null;
  const expected=Buffer.from(mac(secret,body)),actual=Buffer.from(signature);
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
  const data=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  if(data.v!==1||data.scope!=='operation-analysis'||typeof data.actor!=='string'||!/^[\w-]{43}$/.test(data.actor)
   ||!Number.isInteger(data.exp)||data.exp<=Math.floor(now/1000)||data.exp>Math.floor(now/1000)+lifetime)return null;
  return {actor:data.actor};
 }catch{return null;}
}
