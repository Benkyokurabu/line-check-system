'use client';
const names:Record<string,string>={KUDO:'工藤さん',KINJO:'金城正樹さん'};
export default function StaffEntry({code,onChange,disabled}:{code:string;onChange:(value:string)=>void;disabled:boolean}){
 return code?<div><p>{names[code]}用の入口</p><button type="button" disabled={disabled} onClick={()=>onChange('')}>利用者を選び直す</button></div>
  :<div><p>利用する方の入口を選んでください。</p><div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{Object.entries(names).map(([value,name])=><button type="button" key={value} disabled={disabled} onClick={()=>onChange(value)}>{name}の入口</button>)}</div></div>;
}
