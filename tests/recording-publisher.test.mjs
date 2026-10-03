import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyPublisherIdentity,publisherIssuer,publisherAudience} from '../src/lib/recording-publisher-core.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key'},now=Date.now();
const claims={iss:publisherIssuer,aud:publisherAudience,exp:now/1000+60,nbf:now/1000-30,repository:'Benkyokurabu/student-calendar',repository_id:'1158938531',repository_owner_id:'261856226',ref:'refs/heads/main',event_name:'push',workflow_ref:'Benkyokurabu/student-calendar/.github/workflows/recording-publication.yml@refs/heads/main'};
function jwt(changes={},header={}){const body=[{alg:'RS256',kid:'test-key',...header},{...claims,...changes}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');}
test('only the three signed production publishing workflows are accepted',()=>{
 for(const workflow of ['recording-publication.yml','publish-zoom-recording-urls.yml','update-journal.yml'])assert(verifyPublisherIdentity(jwt({workflow_ref:`Benkyokurabu/student-calendar/.github/workflows/${workflow}@refs/heads/main`}),[jwk],now));
});
test('wrong identity, branch, audience, workflow, expiry and pull requests cannot capture original URLs',()=>{
 for(const changed of [{iss:'https://other.test'},{aud:'other'},{repository:'other/student-calendar'},{repository_id:'other'},{repository_owner_id:'other'},{ref:'refs/heads/other'},{event_name:'pull_request'},{workflow_ref:'Benkyokurabu/student-calendar/.github/workflows/other.yml@refs/heads/main'},{exp:now/1000-1},{nbf:now/1000+100}])assert.equal(verifyPublisherIdentity(jwt(changed),[jwk],now),false,JSON.stringify(changed));
});
test('tampering, missing keys, unsupported algorithms and malformed tokens are rejected',()=>{
 const valid=jwt(),parts=valid.split('.');parts[1]=Buffer.from(JSON.stringify({...claims,aud:'tampered'})).toString('base64url');
 for(const token of [parts.join('.'),jwt({}, {alg:'none'}),'malformed'])assert.equal(verifyPublisherIdentity(token,[jwk],now),false);
 assert.equal(verifyPublisherIdentity(valid,[],now),false);
});
