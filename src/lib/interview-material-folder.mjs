/** @param {string} value */
export function safeFolderPart(value) {
  return String(value).trim().replace(/\s+/gu, ' ').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').replace(/[. ]+$/u, '').slice(0, 60);
}

/** @param {{number:string,name:string,grade:string}} student */
export function individualInterviewMaterialFolderParts(student) {
  const { number, name, grade } = student;
  if (!/^\d{5,12}$/u.test(number) || !name?.trim() || !grade?.trim())
    throw Error('生徒の学籍番号・氏名・学年を確認できません。');
  return ['個別保存', `${safeFolderPart(grade)} ${safeFolderPart(name)}（${number}）`];
}

/** @param {{date:string,start:string,teacher:string,grade:string,name:string}} appointment */
export function interviewMaterialFolderParts(appointment) {
  const { date, start, teacher, grade, name } = appointment;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !/^\d{2}:\d{2}$/u.test(start)
    || !/^(小[4-6]|中[1-3])$/u.test(grade) || !teacher?.trim() || !name?.trim())
    throw Error('面談日時・担当先生・学年・氏名を確認できません。');
  const [year, month, day] = date.split('-').map(Number);
  const hour = Number(start.slice(0, 2)), minute = Number(start.slice(3));
  const actual = new Date(Date.UTC(year, month - 1, day));
  if (actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day
    || hour > 23 || minute > 59) throw Error('面談日時を確認できません。');
  const fullGrade = grade.replace(/[1-6]/gu, digit => String.fromCharCode(digit.charCodeAt(0) + 0xfee0));
  const teacherName = safeFolderPart(teacher.replace(/先生\s*$/u, ''));
  if (!teacherName) throw Error('担当先生を確認できません。');
  return [
    `${teacherName}先生`,
    `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}.${start.replace(':', '')}-${fullGrade}${safeFolderPart(name.replace(/\s+/gu, ''))}`,
  ];
}
