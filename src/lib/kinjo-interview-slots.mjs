// Kinjo's meeting length is the full interval. Breaks are already between slots.
export const kinjoInterviewSlots=Object.freeze([
 {start:'11:00',end:'12:00'},
 {start:'12:10',end:'13:10'},
 {start:'13:20',end:'14:20'},
 {start:'14:30',end:'15:30'},
 {start:'15:40',end:'16:40'},
 {start:'17:15',end:'18:15'},
 {start:'18:35',end:'19:25'},
 {start:'19:30',end:'20:20'},
 {start:'20:25',end:'21:15'},
 {start:'21:25',end:'22:15'},
 {start:'22:05',end:'',requiresLateClass:true},
]);

export const kinjoInterviewSlot=start=>kinjoInterviewSlots.find(slot=>slot.start===start);
export const isKinjoTeacher=value=>String(value??'').normalize('NFKC').replace(/\s/g,'').replace(/(?:先生|さん)$/u,'')==='金城';
export const isKinjoSlot=(start,end)=>{const slot=kinjoInterviewSlot(start);return !!slot&&slot.end===end;};
