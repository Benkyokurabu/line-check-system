import { diagnosticArea } from './operation-diagnostics.mjs';
export type Diagnostic = {area:string;method:string;symptom:string;status:number;elapsedMs:number;online:boolean};
export type OperationSignal = {key:string;action:string;startedAt:number;request:string;anchor:HTMLElement|null;phase:'waiting'|'responded'|'failure';diagnostic:Diagnostic};
type Action = {id:string;key:string;anchor:HTMLElement;at:number;settled:number;active:number};

// Observe requests without retrying them, reading their headers/bodies ahead of
// callers, or changing their signals, business payloads or return values.
export function observeOperations(receive:(signal:OperationSignal)=>void){
 let active=true,current:Action|null=null;
 const keys=new WeakMap<HTMLElement,string>(),timers=new Set<ReturnType<typeof setTimeout>>();
 const original=window.fetch;
 function capture(event:Event){
  const target=event instanceof SubmitEvent?event.submitter:event.target;
  if(!(target instanceof Element)||target.closest('[data-operation-feedback]'))return;
  const button=target.closest<HTMLElement>('button,input[type="submit"],input[type="button"]');
  if(!button||button.matches(':disabled'))return;
  if(!keys.has(button))keys.set(button,crypto.randomUUID());
  current={id:crypto.randomUUID(),key:keys.get(button)!,anchor:button,at:Date.now(),settled:0,active:0};
 }
 function action(){
  return current?.anchor.isConnected&&Date.now()-current.at<90_000
   &&(Date.now()-current.at<1500||current.active>0||Date.now()-current.settled<1000)?current:null;
 }
 const wrapped:typeof fetch=async(input,init)=>{
  let url:URL;try{url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);}catch{return original(input,init);}
  const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase(),owner=action();
  const api=url.origin===location.origin&&url.pathname.startsWith('/api/');
  const ignore=url.pathname==='/api/operation-analysis'||url.pathname==='/api/app-version'||url.pathname.startsWith('/api/codex')
   ||(!owner&&['/api/staff/session','/api/staff/session/activity','/api/private-feedback/summary'].includes(url.pathname));
  if(ignore||(!api&&!owner)||!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method))return original(input,init);
  const start=Date.now(),request=crypto.randomUUID(),area=diagnosticArea(api?url.pathname:location.pathname);
  const key=owner?.key??'background-'+area,actionId=owner?.id??request;
  let failure=false;
  const emit=(phase:OperationSignal['phase'],symptom='network',status=0)=>{
   if(!active)return;
   try{receive({key,action:actionId,startedAt:owner?.at??start,request,anchor:owner?.anchor??null,phase,
    diagnostic:{area,method,symptom,status,elapsedMs:Math.min(3_600_000,Math.max(0,Date.now()-start)),online:navigator.onLine}});}catch{}
  };
  const fail=(symptom:string,status=0)=>{if(!failure){failure=true;emit('failure',symptom,status);}};
  const begin=()=>{
   if(owner)owner.active++;
   const timer=setTimeout(()=>{timers.delete(timer);if(!failure&&owner)emit('waiting');},3000);timers.add(timer);
   return ()=>{clearTimeout(timer);timers.delete(timer);if(owner){owner.active=Math.max(0,owner.active-1);owner.settled=Date.now();}};
  };
  const finish=begin();
  try{
   const response=await original(input,init);finish();
   if(!response.ok)fail('http',response.status);
   else if(owner)emit('responded','http',response.status);
   const json=response.json.bind(response);
   try{response.json=async()=>{
    const complete=begin();
    try{
     const body=await json();
     if(response.ok&&body&&typeof body==='object'&&!Array.isArray(body)
      &&(body.ok===false||body.success===false||(typeof body.error==='string'&&body.error.trim())))fail('application',response.status);
     else if(response.ok&&owner&&!failure)emit('responded','http',response.status);
     return body;
    }catch(error){if(response.ok)fail('invalid_response',response.status);throw error;}finally{complete();}
   };}catch{}
   return response;
  }catch(error){
   finish();
   const name=error instanceof Error?error.name:'';
   if(name==='TimeoutError'||(name==='AbortError'&&Date.now()-start>=10_000))fail('timeout');
   else if(name!=='AbortError')fail('network');
   throw error;
  }
 };
 window.fetch=wrapped;
 const clientError=()=>{
  const owner=action(),id=crypto.randomUUID();
  try{receive({key:owner?.key??'background-client',action:owner?.id??id,startedAt:owner?.at??Date.now(),request:id,anchor:owner?.anchor??null,phase:'failure',
   diagnostic:{area:diagnosticArea(location.pathname),method:'GET',symptom:'client',status:0,elapsedMs:0,online:navigator.onLine}});}catch{}
 };
 document.addEventListener('click',capture,true);document.addEventListener('submit',capture,true);
 window.addEventListener('error',clientError);
 return ()=>{active=false;if(window.fetch===wrapped)window.fetch=original;for(const t of timers)clearTimeout(t);
  document.removeEventListener('click',capture,true);document.removeEventListener('submit',capture,true);window.removeEventListener('error',clientError);};
}
