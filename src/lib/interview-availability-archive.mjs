const key=value=>String(value??'').replaceAll('-','').toLowerCase();

export function archiveBlockReason({pageId,slot,bookings,requests,invitations}){
 if(bookings.some(row=>key(row.notion_page_id)===key(pageId)))return '面談の予約履歴がある枠は削除できません。面談一覧で確認してください。';
 if(slot&&requests.some(row=>row.status==='pending'&&Array.isArray(row.choices)&&row.choices.some(choice=>choice.slotId===slot.id)))return '保護者の申請中のため削除できません。先に申請を処理してください。';
 if(slot&&invitations.some(row=>row.status==='active'&&Array.isArray(row.slots)&&row.slots.some(choice=>choice.id===slot.id)))return '日程の打診中のため削除できません。先に案内を取り消してください。';
 return '';
}
