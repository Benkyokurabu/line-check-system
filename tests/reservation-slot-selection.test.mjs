import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleReservationSlot as toggle } from '../src/lib/reservation-slot-selection.mjs';

test('all 15,625 six-action sequences toggle slots off individually and extend endpoints',()=>{
  for(let sequence=0;sequence<5**6;sequence++) {
    let code=sequence, selection=[];
    for(let step=0;step<6;step++) {
      const action=code%5; code=Math.floor(code/5);
      if(action===4) {selection=[];continue;}
      const previous=[...selection];
      const result=toggle(selection,action,[3],4);
      assert.deepEqual(selection,previous,'input must not be mutated');
      if(action===3) {assert.equal(result.blocked,true);assert.deepEqual(result.selection,previous);}
      else if(previous.includes(action)) assert.deepEqual(result.selection,previous.filter(slot=>slot!==action));
      else {
        const expected=new Set(previous);expected.add(action);
        if(previous.length && action<previous[0]) for(let slot=action;slot<previous[0];slot++) expected.add(slot);
        if(previous.length && action>previous.at(-1)) for(let slot=previous.at(-1)+1;slot<action;slot++) expected.add(slot);
        assert.deepEqual(result.selection,[...expected].sort((a,b)=>a-b));
      }
      selection=result.selection;
    }
  }
});
test('middle removal, reselect, empty selection and preserved interior holes',()=>{
  assert.deepEqual(toggle([0,1,2],1,[],5).selection,[0,2]);
  assert.deepEqual(toggle([0,2],1,[],5).selection,[0,1,2]);
  assert.deepEqual(toggle([0,2],4,[],5).selection,[0,2,3,4]);
  assert.deepEqual(toggle([1],1,[],5).selection,[]);
  assert.deepEqual(toggle([],2,[],5).selection,[2]);
});
test('unavailable middle prevents extending across it without losing selection',()=>{
  assert.deepEqual(toggle([0],2,[1],4),{selection:[0],blocked:true});
  assert.deepEqual(toggle([2],0,[1],4),{selection:[2],blocked:true});
});
test('invalid slots are rejected',()=>{
  for(const index of [-1,4,1.5,NaN]) assert.throws(()=>toggle([],index,[],4),RangeError);
  for(const selection of [[-1,1],[0,4],[0,1.5]]) assert.throws(()=>toggle(selection,1,[],4),RangeError);
});
