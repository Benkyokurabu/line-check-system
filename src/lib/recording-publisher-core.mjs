import {createPublicKey,verify} from 'node:crypto';
export const publisherIssuer='https://token.actions.githubusercontent.com';
export const publisherAudience='bentan-recording-capture';
const repository='Benkyokurabu/student-calendar';
const workflows=['recording-publication.yml','publish-zoom-recording-urls.yml','update-journal.yml'];
export function verifyPublisherIdentity(token,keys,now=Date.now()){
 try{
  const parts=token.split('.');if(parts.length!==3)return false;
  const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());
  if(header.alg!=='RS256'||typeof header.kid!=='string')return false;
  const key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!key)return false;
  if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))return false;
  const claim=JSON.parse(Buffer.from(parts[1],'base64url').toString()),seconds=now/1000;
  return claim.iss===publisherIssuer&&claim.aud===publisherAudience&&
   typeof claim.exp==='number'&&claim.exp>seconds&&typeof claim.nbf==='number'&&claim.nbf<=seconds+30&&
   claim.repository===repository&&claim.repository_id==='1158938531'&&claim.repository_owner_id==='261856226'&&
   claim.ref==='refs/heads/main'&&['push','schedule','workflow_dispatch'].includes(claim.event_name)&&
   workflows.some(file=>claim.workflow_ref===`${repository}/.github/workflows/${file}@refs/heads/main`);
 }catch{return false;}
}
