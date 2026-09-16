import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
export const parentCookie='__Host-bentan-parent';
export const flowCookie='__Host-bentan-line-flow';
export const hashToken=token=>createHash('sha256').update(token).digest('hex');
export function loginConfig(env=process.env){
 const origin=env.STAFF_AUTH_ORIGIN;
 if(!origin||!/^https:\/\/[^/]+$/.test(origin)||!/^\d+$/.test(env.LINE_LOGIN_CHANNEL_ID??'')||!env.LINE_LOGIN_CHANNEL_SECRET||!env.SUPABASE_SECRET_KEY)return null;
 return {origin,channelId:env.LINE_LOGIN_CHANNEL_ID,channelSecret:env.LINE_LOGIN_CHANNEL_SECRET,secret:env.SUPABASE_SECRET_KEY,redirect:origin+'/api/parent/line/callback'};
}
const mac=(value,secret)=>createHmac('sha256',secret).update('parent-line-flow-v1:'+value).digest('base64url');
export function beginLineLogin(config,now=Date.now()){
 const state=randomBytes(24).toString('hex'),nonce=randomBytes(24).toString('hex'),verifier=randomBytes(32).toString('base64url');
 const encoded=Buffer.from(JSON.stringify({state,nonce,verifier,expires:now+600000})).toString('base64url');
 const cookie=encoded+'.'+mac(encoded,config.secret);
 const url=new URL('https://access.line.me/oauth2/v2.1/authorize');
 url.search=new URLSearchParams({response_type:'code',client_id:config.channelId,redirect_uri:config.redirect,state,scope:'openid',nonce,code_challenge:hashBase64(verifier),code_challenge_method:'S256',ui_locales:'ja'}).toString();
 return {cookie,url:url.href};
}
function hashBase64(value){return createHash('sha256').update(value).digest('base64url');}
export function verifyLoginFlow(cookie,state,config,now=Date.now()){
 try{
  if(typeof cookie!=='string'||cookie.length>2000||typeof state!=='string')return null;
  const [encoded,signature,...extra]=cookie.split('.');if(extra.length||!signature)return null;
  const a=Buffer.from(signature),b=Buffer.from(mac(encoded,config.secret));if(a.length!==b.length||!timingSafeEqual(a,b))return null;
  const flow=JSON.parse(Buffer.from(encoded,'base64url').toString());
  if(flow.state!==state||!flow.verifier||!flow.nonce||flow.expires<=now)return null;return flow;
 }catch{return null;}
}
export async function exchangeLineCode(config,flow,code,fetcher=fetch){
 const post=async(path,body)=>{
  const r=await fetcher('https://api.line.me'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(10000),cache:'no-store'});
  if(!r.ok)throw Error('LINE認証を完了できませんでした。もう一度お試しください。');return r.json();
 };
 const tokens=await post('/oauth2/v2.1/token',{grant_type:'authorization_code',code,redirect_uri:config.redirect,client_id:config.channelId,client_secret:config.channelSecret,code_verifier:flow.verifier});
 if(typeof tokens.id_token!=='string')throw Error('LINE認証を確認できません。');
 const identity=await post('/oauth2/v2.1/verify',{id_token:tokens.id_token,client_id:config.channelId,nonce:flow.nonce});
 if(identity.iss!=='https://access.line.me'||String(identity.aud)!==config.channelId||identity.nonce!==flow.nonce||identity.exp*1000<=Date.now()||!/^U[0-9a-f]{32}$/i.test(identity.sub??''))throw Error('LINE認証を確認できません。');
 return identity.sub;
}
