import {randomBytes} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {exchangeLineCode,flowCookie,parentCookie,hashToken,loginConfig,verifyLoginFlow} from '@/lib/parent-line-login.mjs';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 const config=loginConfig();if(!config)return NextResponse.json({error:'面談予約の受付準備中です。'},{status:503,headers:{'Cache-Control':'no-store'}});
 const response=NextResponse.redirect(config.origin+'/interviews');
 response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
 response.cookies.set(flowCookie,'',{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:0});
 try{
  const flow=verifyLoginFlow(request.cookies.get(flowCookie)?.value,request.nextUrl.searchParams.get('state'),config);
  const code=request.nextUrl.searchParams.get('code');if(!flow||!code||code.length>2048||request.nextUrl.searchParams.has('error'))throw Error();
  const lineUserId=await exchangeLineCode(config,flow,code),token=randomBytes(32).toString('base64url'),db=createSupabaseAdminClient();
  const {error}=await db.from('interview_parent_sessions').insert({token_hash:hashToken(token),line_user_id:lineUserId,expires_at:new Date(Date.now()+12*3600000).toISOString()});if(error)throw Error();
  response.cookies.set(parentCookie,token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:12*3600});
 }catch{response.headers.set('Location',config.origin+'/interviews?login=failed');}
 return response;
}
