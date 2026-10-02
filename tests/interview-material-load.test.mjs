import test from 'node:test';
import assert from 'node:assert/strict';
import {mapMaterialSources} from '../src/lib/interview-material-load.mjs';
test('parallel source reads are bounded and preserve record order',async()=>{
 let active=0,maximum=0;
 const result=await mapMaterialSources([30,5,10,1],async value=>{
  active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,value));active--;return value;
 });
 assert.deepEqual(result,[30,5,10,1]);assert.equal(maximum,2);
});
test('missing required source rejects the snapshot instead of omitting files',async()=>{
 await assert.rejects(mapMaterialSources([1,2,3],async value=>{if(value===2)throw Error('required source failed');return value;}),/required source failed/);
 assert.deepEqual(await mapMaterialSources([],async value=>value),[]);
});
