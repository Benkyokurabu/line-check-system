/** Limit concurrency while preserving source order and rejecting incomplete snapshots. */
export async function mapMaterialSources(values, load, concurrency = 2) {
 const result = new Array(values.length);
 let next = 0;
 await Promise.all(Array.from({length:Math.min(concurrency,values.length)}, async()=>{
  while(next<values.length){const index=next++;result[index]=await load(values[index]);}
 }));
 return result;
}
