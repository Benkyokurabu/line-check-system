import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beginLineLogin,verifyLoginFlow,loginConfig,exchangeLineCode} from '../src/lib/parent-line-login.mjs';
const config=loginConfig({STAFF_AUTH_ORIGIN:'https://example.invalid',LINE_LOGIN_CHANNEL_ID:'12345',LINE_LOGIN_CHANNEL_SECRET:'test-only',SUPABASE_SECRET_KEY:'server-test-only'});
test('LINE設定がないとログインを開始せず、PKCE・state・nonce・期限を検証する',()=>{
 assert.equal(loginConfig({}),null);const a=beginLineLogin(config,10000),url=new URL(a.url),state=url.searchParams.get('state');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('scope'),'openid');
 assert.ok(verifyLoginFlow(a.cookie,state,config,10001));assert.equal(verifyLoginFlow(a.cookie,state,config,700000),null);assert.equal(verifyLoginFlow(a.cookie,'wrong',config,10001),null);assert.equal(verifyLoginFlow(a.cookie+'x',state,config,10001),null);
});
test('IDトークンの検証結果からだけLINEユーザーを取得する',async()=>{
 const flow={nonce:'test-nonce',verifier:'test-verifier'},sub='U'+'1'.repeat(32);let bad=false;
 const fetcher=async(url,init)=>{const b=init.body;assert.equal(b.get('client_id'),'12345');if(url.endsWith('/token')){assert.equal(b.get('code_verifier'),'test-verifier');return {ok:true,json:async()=>({id_token:'test-token'})};}assert.equal(b.get('nonce'),flow.nonce);return {ok:true,json:async()=>({iss:'https://access.line.me',aud:bad?'other':'12345',sub,nonce:flow.nonce,exp:Math.floor(Date.now()/1000)+100})};};
 assert.equal(await exchangeLineCode(config,flow,'test-code',fetcher),sub);bad=true;await assert.rejects(()=>exchangeLineCode(config,flow,'test-code',fetcher));
});
