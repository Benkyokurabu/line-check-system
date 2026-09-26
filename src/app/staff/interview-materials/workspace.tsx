'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import styles from './workspace.module.css';

type Field = { label: string; value: string };
type Answer = { id: string; date: string; schools: string[]; fields: Field[]; url: string };
type Student = { number: string; name: string; grade: string; teacher: string; responses: Answer[] };
type Manifest = { items: {label: string; source: string; staffOnly: boolean}[]; missing: string[]; pages: number; savedPath?: string | null; cloudSynced?: boolean; saveError?: string | null };
type SchoolPreview = { rank: number; surveyName: string; name: string; found: boolean; files: {kind: string; year: string; filename: string}[] };
type HokushinPreview = { found: boolean; indexing?: boolean; year?: string; round?: string; filename?: string; message?: string };
type TermReportPreview = { found: boolean; year?: string; term?: string; filename?: string; pages?: number[]; message?: string };
type RecentJob = { id: string; status: string; number: string; name: string; createdAt: string };
const searchable = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s/g, '');
const answerKey = (value: string) => value.replaceAll('-', '').toLowerCase();
const suggestedSchools = (schools: string[]) => schools.map(name => /^えいめい(?:高校|高等学校)?$/u.test(name.trim()) ? '叡明' : name);
const requestError = (error: unknown) => error instanceof TypeError
  ? '勉たんとの通信が切れました。ネット接続を確認してから、もう一度お試しください。'
  : error instanceof Error ? error.message : '処理できませんでした。';

export default function MaterialsDesk() {
  const [staff, setStaff] = useState(false), [ready, setReady] = useState(false);
  const [code, setCode] = useState(''), [password, setPassword] = useState('');
  const [students, setStudents] = useState<Student[]>([]), [query, setQuery] = useState('');
  const [teacherFilter, setTeacherFilter] = useState(''), [gradeFilter, setGradeFilter] = useState(''), [displayLimit, setDisplayLimit] = useState(30);
  const [number, setNumber] = useState(''), [answerId, setAnswerId] = useState('');
  const [schoolNames, setSchoolNames] = useState<string[]>([]);
  const [preview, setPreview] = useState<SchoolPreview[] | null>(null);
  const [previewHokushin, setPreviewHokushin] = useState<HokushinPreview | null>(null);
  const [previewTermReport, setPreviewTermReport] = useState<TermReportPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false), [previewMessage, setPreviewMessage] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [generationMessage, setGenerationMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [savedFile, setSavedFile] = useState('');
  const [cloudSynced, setCloudSynced] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [workerStatus, setWorkerStatus] = useState('作成PCを確認中…');
  const [workerOnline, setWorkerOnline] = useState(false);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const selected = students.find(s => s.number === number);
  const answer = selected?.responses.find(r => r.id === answerId);
  const campusValue = answer?.fields.find(field => field.label === '所属校舎')?.value.trim() || '';
  const campus = campusValue === '本校' || campusValue === '南教室' ? campusValue : '';
  const teachers = useMemo(() => [...new Set(students.map(s => s.teacher).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja')), [students]);
  const grades = useMemo(() => ['小4', '小5', '小6', '中1', '中2', '中3'].filter(grade => students.some(s => s.grade === grade)), [students]);
  const matching = useMemo(() => students.filter(s => {
    if (teacherFilter && s.teacher !== teacherFilter || gradeFilter && s.grade !== gradeFilter) return false;
    const terms = query.trim().normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
    const values = [s.name, s.number, s.grade, s.teacher].map(searchable);
    return terms.every(term => values.some(value => value.includes(searchable(term))));
  }), [students, query, teacherFilter, gradeFilter]);
  const visible = matching.slice(0, displayLimit);
  const chooseStudent = useCallback((student: Student, preferredAnswer = '') => {
    const selectedAnswer = student.responses.find(response => answerKey(response.id) === answerKey(preferredAnswer))
      ?? (student.responses.length === 1 ? student.responses[0] : undefined);
    setNumber(student.number); setAnswerId(selectedAnswer?.id ?? '');
    setSchoolNames(suggestedSchools(selectedAnswer?.schools ?? []));
    setPreview(null); setPreviewHokushin(null); setPreviewTermReport(null); setPreviewMessage('');
    setManifest(null); setPdfUrl(''); setGenerationMessage(''); setSaveMessage(''); setSavedFile(''); setCloudSynced(false);
  }, []);

  const refreshWorkers = useCallback(async () => {
    try {
      const workers = await fetch('/api/staff/interview-material-jobs', { cache: 'no-store' });
      const workerBody = await workers.json();
      const available = workers.ok && Boolean(workerBody.available?.length);
      setWorkerOnline(available);
      const primary = available && workerBody.available.some((worker: { priority: number }) => worker.priority === 1);
      const standby = available && workerBody.available.some((worker: { priority: number }) => worker.priority === 2);
      setWorkerStatus(primary && standby ? '主担当PCと予備PCが稼働中です' : primary ? '主担当PCが稼働中です' : standby
        ? '予備PCが稼働中です。主担当PCの代わりに作成できます。' : '作成PCは停止中です。起動後に利用できます。');
      setRecentJobs(Array.isArray(workerBody.recent) ? workerBody.recent : []);
    } catch { setWorkerOnline(false); setWorkerStatus('作成PCの稼働状況を確認できません。'); }
  }, []);
  const load = useCallback(async () => {
    const response = await fetch('/api/staff/interview-materials', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || 'アンケートを取得できません。');
    setStudents(body.students);
    const linkedAnswer = new URLSearchParams(window.location.search).get('answer');
    if (linkedAnswer && /^[a-f0-9-]{32,36}$/i.test(linkedAnswer)) {
      const linkedStudent = (body.students as Student[]).find(student => student.responses.some(response => answerKey(response.id) === answerKey(linkedAnswer)));
      if (linkedStudent) chooseStudent(linkedStudent, linkedAnswer);
      else setMessage('このアンケート回答と生徒を照合できませんでした。担任・学年・氏名で生徒を探してください。');
    }
    await refreshWorkers();
  }, [refreshWorkers, chooseStudent]);
  async function submitJob(kind: 'preview' | 'generate') {
    if (!selected) throw Error('生徒を選択してください。');
    const response = await fetch('/api/staff/interview-material-jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, number: selected.number, campus, schools: kind === 'preview'
        ? schoolNames.map(name => name.trim()).filter(Boolean) : preview?.map(school => school.name) || [] }),
    });
    const created = await response.json();
    if (!response.ok) throw Error(created.error || '作成依頼を登録できません。');
    for (let attempt = 0; attempt < 300; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const status = await fetch(`/api/staff/interview-material-jobs?id=${created.id}`, { cache: 'no-store' });
      const body = await status.json();
      if (!status.ok) throw Error(body.error || '作成状況を確認できません。');
      if (body.job.status === 'completed') return body.job;
      if (body.job.status === 'failed') throw Error(body.job.error || '作成PCで処理できませんでした。');
    }
    throw Error('作成状況の確認が時間切れになりました。もう一度画面を開いて確認してください。');
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/staff/session', { cache: 'no-store' });
        if (response.ok) { if (active) setStaff(true); await load(); }
      } catch (error) { if (active) setMessage((error as Error).message); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, [load]);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/staff/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffCode: code.trim().toUpperCase(), password }) });
      const body = await response.json(); setPassword('');
      if (!response.ok) throw Error(body.error || 'ログインできません。');
      setStaff(true); await load();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function checkMaterials() {
    if (!selected || (selected.responses.length > 1 && !answer)) return;
    setPreviewBusy(true); setPreviewMessage(''); setPreview(null); setPreviewHokushin(null); setPreviewTermReport(null); setManifest(null);
    try {
      const job = await submitJob('preview');
      setPreview(job.result.schools);
      setPreviewHokushin(job.result.hokushin ?? null);
      setPreviewTermReport(job.result.termReport ?? null);
    } catch (error) { setPreviewMessage(requestError(error)); }
    finally { setPreviewBusy(false); }
  }
  async function generate() {
    if (!selected || !preview || (selected.responses.length > 1 && !answer)) return;
    setBusy(true); setGenerationMessage(''); setSaveMessage(''); setSavedFile(''); setCloudSynced(false); setManifest(null);
    try {
      const job = await submitJob('generate');
      setManifest(job.result);
      setPdfUrl(job.pdfUrl || '');
      setSavedFile(job.result.savedPath || '');
      setCloudSynced(Boolean(job.result.cloudSynced));
      setSaveMessage(job.result.saveError || '');
      await refreshWorkers();
    } catch (error) { setGenerationMessage(requestError(error)); }
    finally { setBusy(false); }
  }
  async function restoreJob(id: string) {
    setMessage('');
    try {
      const response = await fetch(`/api/staff/interview-material-jobs?id=${id}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || body.job?.status !== 'completed') throw Error(body.error || body.job?.error || 'まだPDFを開けません。');
      setManifest(body.job.result);
      setPdfUrl(body.job.pdfUrl || '');
      setSavedFile(body.job.result.savedPath || '');
      setCloudSynced(Boolean(body.job.result.cloudSynced));
      setSaveMessage(body.job.result.saveError || '');
    } catch (error) { setMessage(requestError(error)); }
  }
  return <main className={styles.page}>
    <header><Link href="/">勉たんに戻る</Link><h1>面談資料を作る</h1><p>2026年 秋の面談アンケート ／ 先生の手元用</p></header>
    {message && <p className={styles.error} role="status">{message}</p>}
    {!ready ? <p>読み込んでいます…</p> : !staff ? <form className={styles.card} onSubmit={login}>
      <h2>職員ログイン</h2><label>職員コード<input value={code} onChange={event => setCode(event.target.value)} autoComplete="username" required /></label>
      <label>パスワード<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      <button disabled={busy}>ログイン</button>
    </form> : <>
      <p role="status" className={styles.note}>{workerStatus} <button type="button" onClick={() => void refreshWorkers()}>稼働状況を再確認</button></p>
      {recentJobs.length > 0 && <section className={styles.card}><h2>最近の作成依頼</h2>
        <ul>{recentJobs.map(job => <li key={job.id}>{job.name}（{job.number}）／{job.status === 'completed' ? '完成' : job.status === 'failed' ? '失敗' : '作成中'}{' '}
          {job.status === 'completed' && <button type="button" onClick={() => void restoreJob(job.id)}>PDFを再表示</button>}</li>)}</ul>
      </section>}
      <section className={styles.card}><h2>1. 生徒を選ぶ</h2>
        <div className={styles.studentFilters}>
          <label>担任<select value={teacherFilter} onChange={event => { setTeacherFilter(event.target.value); setDisplayLimit(30); }}><option value="">すべての担任</option>{teachers.map(teacher => <option key={teacher} value={teacher}>{teacher}先生</option>)}</select></label>
          <label>学年<select value={gradeFilter} onChange={event => { setGradeFilter(event.target.value); setDisplayLimit(30); }}><option value="">すべての学年</option>{grades.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select></label>
          <label className={styles.studentSearch}>氏名・学籍番号に含まれる文字<input type="search" value={query} onChange={event => { setQuery(event.target.value); setDisplayLimit(30); }} placeholder="例：木村、美海、2018" /></label>
        </div>
        {selected && <p className={styles.selectedStudent} role="status">選択中：{selected.grade} {selected.name} ／ {selected.number} ／ 担任：{selected.teacher || '未設定'}</p>}
        <p className={styles.note}>該当 {matching.length}人{matching.length > displayLimit ? ` ／ 先頭${displayLimit}人を表示` : ''}</p>
        {matching.length === 0 ? <p>条件に合う生徒はいません。担任・学年・検索文字を変更してください。</p> : <div className={styles.studentResults} aria-label="生徒の検索結果">{visible.map(student => <button type="button" className={styles.studentResult} aria-pressed={number === student.number} key={student.number} onClick={() => chooseStudent(student)}><strong>{student.grade} {student.name}</strong><span>{student.number} ／ 担任：{student.teacher || '未設定'} ／ 回答{student.responses.length}件</span></button>)}</div>}
        {matching.length > displayLimit && <button type="button" onClick={() => setDisplayLimit(limit => limit + 30)}>さらに30人表示</button>}
      </section>
      {selected && <section className={styles.card}><h2>2. アンケート回答を選ぶ</h2>
        {!selected.responses.length ? <p>今回の回答はありません。指導簿と見つかった模試資料を作ります。</p> : <>
          <p>回答が複数ある場合は、使う回答を先生が選択してください。</p>
          <div className={styles.answers}>{selected.responses.map((response, index) => <label key={response.id} className={styles.answer}>
            <input type="radio" name="answer" checked={answerId === response.id} onChange={() => { setAnswerId(response.id); setSchoolNames(suggestedSchools(response.schools)); setPreview(null); setPreviewMessage(''); setManifest(null); setGenerationMessage(''); setSaveMessage(''); setSavedFile(''); setCloudSynced(false); }} />
            <span>{index === 0 ? '最新' : `${index + 1}件目`} ／ {response.date || '日時不明'}<br />志望校：{response.schools.join('、') || '記載なし'}</span>
          </label>)}</div>
          {answer && <div className={styles.reviewGrid}>
            <div className={styles.survey}><h3>アンケート回答</h3><p>回答日：{answer.date || '日時不明'}</p><dl>{answer.fields.map((field, index) => <div key={index}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl><a href={answer.url} target="_blank" rel="noreferrer">Notionの回答原本</a></div>
            <div><h3>志望順位の確認</h3><p>アンケートの第1・第2・第3志望を確認してください。違う場合はここで直せます。</p>
              {schoolNames.map((school, index) => <label key={index}>第{index + 1}志望<input value={school} onChange={event => { setSchoolNames(names => names.map((name, position) => position === index ? event.target.value : name)); setPreview(null); setManifest(null); }} /></label>)}
              {schoolNames.length < 6 && <button type="button" onClick={() => { setSchoolNames(names => [...names, '']); setPreview(null); setManifest(null); }}>志望校を追加</button>}
              {answer.schools.some(name => /^えいめい(?:高校|高等学校)?$/u.test(name.trim())) && <p className={styles.note}>アンケートの「えいめい」は「叡明」として確認します。</p>}
            </div>
          </div>}
        </>}
        <div className={styles.actions}><button className={styles.primary} disabled={!workerOnline || previewBusy || selected.responses.length > 1 && !answer} onClick={() => void checkMaterials()}>{previewBusy ? 'NASの資料を確認中…' : '資料を作る'}</button></div>
        {selected.responses.length > 1 && !answer && <p className={styles.note}>上のアンケート回答を1つ選ぶと資料を確認できます。</p>}
        {previewMessage && <p className={styles.error} role="alert">{previewMessage}</p>}
        {preview && <div className={styles.preview}><h3>見つかった資料と年度</h3>
          {preview.length === 0 ? <p>志望校の回答はありません。指導簿・模試資料を作成します。</p> : <ol>{preview.map(school => <li key={school.rank}><strong>第{school.rank}志望：{school.name}</strong> — {school.found ? school.files.map(file => `${file.kind} ${file.year}`).join('、') : '該当資料なし'}</li>)}</ol>}
          {previewHokushin && selected.grade.match(/^中[23]$/) && <p>北辰の個人成績票：{previewHokushin.found ? `${previewHokushin.year} ${previewHokushin.round} が見つかりました` : previewHokushin.message || '該当資料なし'}</p>}
          {previewTermReport && <p>成績通知の個人成績表：{previewTermReport.found ? `${previewTermReport.year}年度${previewTermReport.term} ${previewTermReport.filename} の本人ページ（${previewTermReport.pages?.join('、') || '番号不明'}）が見つかりました` : previewTermReport.message || '該当資料なし'}</p>}
          <button className={styles.primary} disabled={!workerOnline || busy || Boolean(previewHokushin?.indexing)} onClick={() => void generate()}>{busy ? 'PDFを作成中…' : 'PDFを作成'}</button>
          {previewHokushin?.indexing && <p className={styles.note}>索引の作成が終わったら「資料を作る」をもう一度押して確認してください。</p>}
        </div>}
        {generationMessage && <p className={styles.error} role="alert">{generationMessage}</p>}
        <p className={styles.note}>NASで資料の有無と年度を確認してからPDFを作成します。指導簿は毎回作成します。</p>
      </section>}
      {manifest && <section className={styles.card}><h2>3. 資料を確認・印刷</h2>
        <p>{manifest.items.length}点 ／ 計{manifest.pages}ページ</p>
        <div className={styles.actions}>
          {pdfUrl && <><a href={pdfUrl} target="_blank" rel="noreferrer">先生用の一式PDFを表示・印刷</a><a href={pdfUrl} download>一式PDFを保存</a></>}
        </div>
        {savedFile && <p role="status">{cloudSynced ? '作成PCとOneDriveのクラウドに保存しました' : '作成PCのOneDriveフォルダに保存しました'}：{savedFile}。別PCで開く前にOneDriveの同期完了を確認してください。</p>}
        {saveMessage && <p className={styles.error} role="alert">{saveMessage}</p>}
        <ol>{manifest.items.map((item, index) => <li key={index}>{item.label}{item.staffOnly && <strong className={styles.caution}>生徒には渡さない</strong>}</li>)}</ol>
        {manifest.missing.length > 0 && <div className={styles.missing}><h3>見つからなかった資料</h3><ul>{manifest.missing.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        <p className={styles.note}>表示リンクは約10分間有効です。完成PDFは非公開で1日保管し、OneDriveにも保存します。</p>
      </section>}
    </>}
  </main>;
}
