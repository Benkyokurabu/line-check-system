export type InterviewRecord = { id: string; date: string; title: string; method?: string; purpose?: string; attachments?: string[]; body: string; url: string };
export type StudentInfo = { source: string; value: string };
export type SchoolMention = { date: string; text: string; url: string };
export type SchoolCandidate = SchoolMention & { name: string };
export type InfoSummary = { status: 'empty' | 'prepared' | 'queued' | 'running' | 'completed' | 'failed';
  items: { source: string; note: string; original: string }[]; sourceHash?: string };
export type MaterialContext = { studentNumber?: string; capturedAt?: string; records: InterviewRecord[]; schoolMentions: SchoolMention[]; schoolCandidates?: SchoolCandidate[]; info: StudentInfo[]; summary: InfoSummary;
  siblingSchoolWarning?: string; studentUrl: string; source: 'notion'; showPastSchools?: boolean };

export async function fetchMaterialContext(number: string, signal?: AbortSignal): Promise<MaterialContext> {
  const response = await fetch(`/api/staff/interview-material-context?number=${encodeURIComponent(number)}`, { cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || '面談記録を取得できません。');
  return body as MaterialContext;
}

export async function fetchInfoSummary(number: string, signal?: AbortSignal): Promise<InfoSummary> {
  const response = await fetch(`/api/staff/interview-material-info?number=${encodeURIComponent(number)}`, { cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || '情報の要約を取得できません。');
  return body.summary as InfoSummary;
}

export async function requestInfoSummary(number: string): Promise<void> {
  const response = await fetch('/api/staff/interview-material-info', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number }) });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || 'AI要約を依頼できません。');
}
