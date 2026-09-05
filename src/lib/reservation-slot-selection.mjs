/**
 * Toggle selected slots off individually. Extend beyond the current endpoints
 * consecutively, preserving any previously removed interior slots.
 * @param {number[]} current
 * @param {number} index
 * @param {number[]} unavailable
 * @param {number} count
 * @returns {{selection: number[], blocked: boolean}}
 */
export function toggleReservationSlot(current,index,unavailable,count) {
  if (!Number.isInteger(count) || count<1 || !Number.isInteger(index) || index<0 || index>=count
    || !current.every(slot=>Number.isInteger(slot) && slot>=0 && slot<count)) throw new RangeError('Invalid slot selection');
  if(current.includes(index)) return {selection:current.filter(slot=>slot!==index),blocked:false};
  const start=current.length && index>Math.max(...current) ? Math.max(...current)+1 : index;
  const end=current.length && index<Math.min(...current) ? Math.min(...current)-1 : index;
  const added=Array.from({length:end-start+1},(_,offset)=>start+offset);
  if(added.some(slot=>unavailable.includes(slot))) return {selection:current,blocked:true};
  return {selection:[...new Set([...current,...added])].sort((a,b)=>a-b),blocked:false};
}
