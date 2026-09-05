/**
 * Add a slot to a consecutive range. Repeated clicks are idempotent; only an
 * explicit clear action removes a selection. Never cross an unavailable slot.
 * @param {[number, number] | null} current
 * @param {number} index
 * @param {number[]} unavailable
 * @param {number} count
 * @returns {{range: [number, number] | null, blocked: boolean}}
 */
export function extendReservationRange(current,index,unavailable,count) {
  if (!Number.isInteger(count) || count<1 || !Number.isInteger(index) || index<0 || index>=count
    || (current!==null && (current.length!==2 || !current.every(Number.isInteger)
      || current[0]<0 || current[1]>=count || current[0]>current[1]))) throw new RangeError('Invalid slot range');
  const start=current===null ? index : Math.min(current[0],index);
  const end=current===null ? index : Math.max(current[1],index);
  if (unavailable.some(slot=>slot>=start && slot<=end)) return {range:current,blocked:true};
  return {range:[start,end],blocked:false};
}
