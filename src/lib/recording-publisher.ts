import 'server-only';
import {publisherIssuer,verifyPublisherIdentity} from '@/lib/recording-publisher-core.mjs';
let cache:{expires:number;keys:{kid:string;kty:string}[]}|undefined;
export async function recordingPublisherAllowed(token:string){
 if(token.length>16384)return false;
 if(token.split('.').length===3){
  if(!cache||cache.expires<Date.now()){
   const response=await fetch(publisherIssuer+'/.well-known/jwks',{cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!response.ok)return false;
   const data=await response.json();if(!Array.isArray(data.keys))return false;
   cache={expires:Date.now()+300000,keys:data.keys};
  }
  return verifyPublisherIdentity(token,cache.keys);
 }
 // Local publishing retains the existing repository-write credential check.
 const response=await fetch('https://api.github.com/repos/Benkyokurabu/student-calendar',{headers:{Authorization:'Bearer '+token,'User-Agent':'BentanRecordingPublisher','Accept':'application/vnd.github+json'},cache:'no-store',signal:AbortSignal.timeout(10000)});
 return response.ok&&(await response.json()).permissions?.push===true;
}
