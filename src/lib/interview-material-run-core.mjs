export function materialRunDates(from, to, today) {
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from < today || to < from
    || Date.parse(to) - Date.parse(from) > 7 * 86400000 || Date.parse(to) - Date.parse(today) > 30 * 86400000)
    throw Error('本日から30日以内で、8日間までの面談日を選んでください。');
  return Array.from({ length: (Date.parse(to) - Date.parse(from)) / 86400000 + 1 },
    (_, i) => new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10));
}

export function materialRunJobs(appointments, { runId, staffCode, teacherId, from, to }) {
  const selected = appointments.filter(row => !teacherId || row.teacherId === teacherId);
  if (selected.length > 300) throw Error('面談が300件を超えています。面談日または先生で対象を絞ってください。');
  return selected.map(appointment => ({ kind: 'generate', staff_code: staffCode,
    daily_key: `manual:${staffCode}:${runId}:${appointment.id}:${appointment.number}`,
    payload: { number: appointment.number, name: appointment.name, grade: appointment.grade, schools: [], campus: '',
      autoDaily: { appointment, manual: true, runId, from, to, teacherId } } }));
}

export function materialRunReviews(planned, teacherId = '') {
  return planned.flatMap(({ day, review, directory }) => review
    .filter(item => !teacherId || !item.teacherIds?.length || item.teacherIds.includes(teacherId))
    .map(item => {
      const row = day.rows.find(row => row.id === item.id);
      const start = row?.date?.start;
      const instant = typeof start === 'string' && start.includes('T')
        ? Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/u.test(start) ? start : `${start}+09:00`) : NaN;
      const local = Number.isFinite(instant) ? new Date(instant + 9 * 3600000).toISOString() : '';
      return { id: item.id, title: item.title, reason: item.reason, url: item.url,
        date: local.slice(0, 10) || day.date, start: local.slice(11, 16),
        teachers: directory.filter(staff => item.teacherIds?.includes(staff.id)).map(staff => staff.name.replace(/(?:先生|さん)$/u, '')) };
    }));
}
