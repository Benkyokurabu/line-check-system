import {InterviewError,normalizeTeacher} from './interview-core.mjs';
export const dateOnly=d=>({date:d.date,start:d.start,end:d.end});
export function parentRequest(row,bookings){
 const booking=bookings.find(b=>b.id===row.booking_id);
 return {id:row.id,studentId:row.student_id,status:row.status,version:row.version,note:row.note,reason:row.reason,
  choices:row.choices.map(c=>({slotId:c.slotId,...dateOnly(c.data)})),confirmed:booking?{...dateOnly(booking.data),status:booking.status}:null};
}
// Read only the authenticated family's records. No Notion call, global roster,
// lesson scan, availability refresh, or persistent cache on the first display.
export async function parentSummary(db,lineUserId,invitationId=''){
 const empty={students:[],requests:[],slots:[],invitations:[],invitationOnly:true,slotsPending:false};
 const links=await db.from('student_line_accounts').select('student_number').eq('line_user_id',lineUserId).eq('verification_status','confirmed').in('relation',['mother','father','guardian','shared','student']).limit(100);
 if(links.error)throw new InterviewError('登録情報を確認できません。',503);
 if(!links.data.length)return empty;
 const roster=await db.from('student_registry').select('interview_student_id,student_name,homeroom_teacher').in('student_number',links.data.map(l=>l.student_number)).eq('enrollment_status','current_roster');
 if(roster.error)throw new InterviewError('登録情報を確認できません。',503);
 const ids=roster.data.map(s=>s.interview_student_id).filter(Boolean);if(!ids.length)return empty;
 if(invitationId){const target=await db.from('interview_invitations').select('id').eq('id',invitationId).in('student_id',ids).maybeSingle();if(target.error)throw new InterviewError('案内を確認できません。',503);if(!target.data||lineUserId!=='BENTAN-KUDO-INTERVIEW-LIVE-PREVIEW')throw new InterviewError('この案内は開けません。届いたLINEをご確認ください。',404);}
 let requestQuery=db.from('interview_parent_requests').select('id,student_id,status,version,note,reason,choices,booking_id').in('student_id',ids).order('created_at',{ascending:false}).limit(100);
 let inviteQuery=lineUserId==='BENTAN-KUDO-INTERVIEW-LIVE-PREVIEW'?db.from('interview_invitations').select('id,student_id,expires_at,version').in('student_id',ids).eq('status','active').gt('expires_at',new Date().toISOString()):null;
 if(invitationId){requestQuery=requestQuery.eq('invitation_id',invitationId);if(inviteQuery)inviteQuery=inviteQuery.eq('id',invitationId);}
 const [identities,requests,invites]=await Promise.all([
  db.from('interview_students').select('id').in('id',ids).is('retired_at',null),
  requestQuery,
  inviteQuery??Promise.resolve({data:[],error:null}),
 ]);
 if(identities.error||requests.error||invites.error)throw new InterviewError('予約状況を読み込めません。',503);
 const allowed=new Set(identities.data.map(s=>s.id)),own=requests.data.filter(r=>allowed.has(r.student_id));
 const bookingIds=[...new Set(own.map(r=>r.booking_id).filter(Boolean))];
 const bookings=bookingIds.length?await db.from('interview_bookings').select('id,student_id,status,data').in('id',bookingIds).in('student_id',[...allowed]):{data:[],error:null};
 if(bookings.error)throw new InterviewError('確定日時を読み込めません。',503);
 const invitations=invites.data.filter(i=>allowed.has(i.student_id)).map(i=>({id:i.id,studentId:i.student_id,expiresAt:i.expires_at,version:i.version}));
 return {...empty,students:roster.data.filter(s=>allowed.has(s.interview_student_id)).map(s=>({id:s.interview_student_id,name:s.student_name,teacher:normalizeTeacher(s.homeroom_teacher).replace(/(?:先生|さん)$/u,'')})),
  requests:own.map(r=>parentRequest(r,bookings.data)),invitations,slotsPending:invitations.length>0};
}
