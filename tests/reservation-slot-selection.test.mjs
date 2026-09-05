import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extendReservationRange } from '../src/lib/reservation-slot-selection.mjs';

test('all 15,625 six-action sequences preserve an additive range until explicit clear',()=>{
  for(let sequence=0;sequence<5**6;sequence++) {
    let code=sequence, range=null, chosen=[];
    for(let step=0;step<6;step++) {
      const action=code%5; code=Math.floor(code/5);
      if(action===4) {range=null;chosen=[];continue;}
      const result=extendReservationRange(range,action,[3],4);
      if(action===3) {assert.equal(result.blocked,true);assert.deepEqual(result.range,range);}
      else {chosen.push(action);assert.equal(result.blocked,false);}
      range=result.range;
      assert.deepEqual(range,chosen.length ? [Math.min(...chosen),Math.max(...chosen)] : null);
    }
  }
});
test('unavailable middle prevents crossing in either direction without losing selection',()=>{
  assert.deepEqual(extendReservationRange([0,0],2,[1],4),{range:[0,0],blocked:true});
  assert.deepEqual(extendReservationRange([2,2],0,[1],4),{range:[2,2],blocked:true});
});
test('invalid slot indices and ranges are rejected',()=>{
  for(const index of [-1,4,1.5,NaN]) assert.throws(()=>extendReservationRange(null,index,[],4),RangeError);
  for(const range of [[2,1],[-1,1],[0,4],[0,1.5]]) assert.throws(()=>extendReservationRange(range,1,[],4),RangeError);
});
