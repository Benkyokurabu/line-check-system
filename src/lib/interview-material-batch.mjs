/** Latest survey only; equal timestamps and missing dates need explicit review. */
export function latestMaterialBatchAnswer(responses) {
  if (!responses.length) return null;
  if (responses.length === 1) return responses[0];
  if (responses.some(response => !Number.isFinite(Date.parse(response.date))))
    throw Error('最新のアンケート回答を特定できません。個別に回答を確認してください。');
  const sorted = [...responses].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (Date.parse(sorted[0].date) === Date.parse(sorted[1].date))
    throw Error('同じ日時のアンケート回答が複数あります。個別に回答を確認してください。');
  return sorted[0];
}

export function sameMaterialAppointment(a, b) {
  return ['id', 'number', 'name', 'grade', 'teacher', 'teacherId', 'date', 'start', 'editedAt', 'source']
    .every(field => a[field] === b[field]);
}

export function materialAppointmentKey(appointment) {
  return `${appointment.id}:${appointment.number ?? ''}`;
}

export function materialBatchAppointments(appointments, date, teacherId) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !teacherId) throw Error('面談日と先生を選んでください。');
  const selected = appointments.filter(row => row.date === date && row.teacherId === teacherId);
  if (selected.some(row => row.source !== 'notion-bensuke') || new Set(selected.map(materialAppointmentKey)).size !== selected.length)
    throw Error('Notionの面談予定を確認できません。再取得してください。');
  return selected.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name, 'ja'));
}
/** Report unavailable personal documents as well as conversion/download failures. */
export function materialBatchMissing(preview, grade, missing = []) {
  const warnings = [...missing];
  const personal = [...(/^(中2|中3)$/.test(grade) ? [['hokushin', '北辰の個人成績票'], ['vmogi', 'Vもぎ']] : []),
    ['termReport', '成績通知の個人成績表']];
  for (const [key, label] of personal) {
    if (preview?.[key]?.found === false) warnings.push(`${label}：${preview[key].message || '該当資料なし'}`);
  }
  return [...new Set(warnings)];
}
