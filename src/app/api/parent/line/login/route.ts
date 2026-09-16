import {NextResponse} from 'next/server';
import {beginLineLogin,flowCookie,loginConfig} from '@/lib/parent-line-login.mjs';
export const dynamic='force-dynamic';
export async function GET(){
 const config=loginConfig();
 if(!config)return NextResponse.json({error:'面談予約の受付準備中です。'},{status:503,headers:{'Cache-Control':'no-store'}});
 const flow=beginLineLogin(config),response=NextResponse.redirect(flow.url);
 response.cookies.set(flowCookie,flow.cookie,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600});response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
}
