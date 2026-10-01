// 2026年秋のNotionフォームビルダーで表示された設問順（2026-10-01確認）。
// 回答表の列順には、フォームにない職員用・旧項目も含まれるため使用しない。
// フォームビュー: 小4 9f0f0120, 小5 9acf0120, 小6 934f0120,
// 中1 7d7f0120, 中2 a26f0120, 中3 bbcf0120。
const teacherFeedback = [
  'OXm[', 'W??j', 'TYlQ', 'rkze', 'lQVc', 'UH:a', 'fBiC', 'zw~W', '@x?s', 'q\\xY',
];
const opening = (studentNumberId, classes) => [
  'o|K]', studentNumberId, 'title', '<?FJ', ...classes,
];

export const INTERVIEW_SURVEY_PROPERTY_ORDER = Object.freeze({
  小4: [
    ...opening('[aiP', ['uJFF', 'hoib']),
    '[^X:', '|<M@', '=o]^', '<X]Q',
    'FZWL', 'ePQs', 'qxd:', '{SQX',
    ...teacherFeedback, 'zgW|',
  ],
  小5: [
    ...opening('`d^`', ['uJFF', 'hoib', 'ZbSZ']),
    '[^X:', '|<M@', '<X]Q',
    'FZWL', 'ePQs', 'e~^Y', 'qxd:', '{SQX', 'cTcx',
    ...teacherFeedback, 'zgW|',
  ],
  小6: [
    ...opening('ruKA', ['uJFF', 'hoib', 'ZbSZ']),
    '[^X:', '|<M@', '=o]^', '<X]Q',
    'FZWL', 'ePQs', 'e~^Y', 'qxd:', '{SQX', 'cTcx',
    ...teacherFeedback, 'zgW|',
  ],
  中1: [
    ...opening('o:ee', ['uJFF', 'ZbSZ', 'hoib']),
    '[^X:', '|<M@', '=o]^', '<X]Q',
    'FZWL', 'e~^Y', 'ePQs', 'qxd:', 'cTcx', '{SQX',
    ...teacherFeedback, 'zgW|',
  ],
  中2: [
    ...opening(']YmP', ['uJFF', 'ZbSZ', 'hoib']),
    '[^X:', '|<M@', '=o]^', '<X]Q',
    'FZWL', 'e~^Y', 'ePQs', 'qxd:', 'cTcx', '{SQX',
    ...teacherFeedback, 'zgW|',
  ],
  中3: [
    ...opening('J=Q?', ['uJFF', 'ZbSZ', 'hoib', 'zs<p', 'Cx^f']),
    '|<M@', 'V>du', 'D~vZ', 'dkrH', 'y=oj', '<X]Q', 'nRrm',
    'FZWL', 'e~^Y', 'ePQs', 'mx=V', 'm];s',
    'qxd:', 'cTcx', '{SQX', 'RG|n', 'PAeL',
    ...teacherFeedback, 'zgW|',
  ],
});
