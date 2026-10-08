'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import styles from './workspace.module.css';
import MaterialPdfViewer from './material-pdf-viewer';
import BatchFolderPanel from './batch-folder-panel';
import DailyMaterialPanel from './daily-material-panel';
import ManualMaterialPanel from './manual-material-panel';
import { fetchInfoSummary, fetchMaterialContext, requestInfoSummary, type MaterialContext } from './material-context';
import { canSaveOfflineFolder, downloadInterviewPdf, interviewMaterialsSharePath, saveInterviewFolder, saveSchoolLibraryFolder, updateInterviewFolderSummary, type MaterialAppointment } from './save-offline-folder';
import { individualInterviewMaterialFolderParts, interviewMaterialFolderParts } from '@/lib/interview-material-folder.mjs';

type Field = { label: string; value: string };
type Answer = { id: string; date: string; schools: string[]; fields: Field[]; url: string };
type Student = { number: string; name: string; grade: string; teacher: string; responses: Answer[] };
type Teacher = { id: string; display_name: string };
type Manifest = { items: {label: string; source: string; staffOnly: boolean; startPage?: number; endPage?: number; previewUrl?: string}[]; missing: string[]; pages: number; savedPath?: string | null; cloudSynced?: boolean; saveError?: string | null };
type SchoolPreview = { rank: number; surveyName: string; name: string; found: boolean; files: {kind: string; year: string; filename: string}[] };
type HokushinPreview = { found: boolean; indexing?: boolean; year?: string; round?: string; filename?: string; message?: string };
type TermReportPreview = { found: boolean; year?: string; term?: string; filename?: string; pages?: number[]; message?: string };
type MaterialChoice = { id: string; group: string; label: string; detail: string; staffOnly: boolean };
const LOCAL_HELPER_HEALTH = 'http://127.0.0.1:38473/health';
const searchable = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s/g, '');
const answerKey = (value: string) => value.replaceAll('-', '').toLowerCase();
const suggestedSchools = (schools: string[]) => schools.map(name => /^えいめい(?:高校|高等学校)?$/u.test(name.trim()) ? '叡明' : name);
const requestError = (error: unknown) => error instanceof TypeError
  ? '勉たんとの通信が切れました。ネット接続を確認してから、もう一度お試しください。'
  : error instanceof Error ? error.message : '処理できませんでした。';
const subscribeToBrowserSupport = () => () => {};

export default function MaterialsDesk() {
  const [staff, setStaff] = useState(false), [ready, setReady] = useState(false);
  const [loginTeachers, setLoginTeachers] = useState<Teacher[]>([]), [teacherId, setTeacherId] = useState(''), [password, setPassword] = useState('');
  const [students, setStudents] = useState<Student[]>([]), [query, setQuery] = useState('');
  const [appointmentDate, setAppointmentDate] = useState(''), [appointments, setAppointments] = useState<MaterialAppointment[]>([]);
  const [appointmentTeachers, setAppointmentTeachers] = useState<{id: string; name: string}[]>([]);
  const [appointmentTeacherId, setAppointmentTeacherId] = useState(''), [batchBusy, setBatchBusy] = useState(false);
  const [appointmentBusy, setAppointmentBusy] = useState(false), [appointmentMessage, setAppointmentMessage] = useState('');
  const [selectedAppointment, setSelectedAppointment] = useState<MaterialAppointment | null>(null);
  const [appointmentReview, setAppointmentReview] = useState<{id: string; title: string; reason: string; url: string; teacherIds?: string[]}[]>([]);
  const [appointmentReload, setAppointmentReload] = useState(0), [shareMessage, setShareMessage] = useState('');
  const [teacherFilter, setTeacherFilter] = useState(''), [gradeFilter, setGradeFilter] = useState(''), [displayLimit, setDisplayLimit] = useState(30);
  const [number, setNumber] = useState(''), [answerId, setAnswerId] = useState('');
  const [schoolNames, setSchoolNames] = useState<string[]>([]);
  const [preview, setPreview] = useState<SchoolPreview[] | null>(null);
  const [previewHokushin, setPreviewHokushin] = useState<HokushinPreview | null>(null);
  const [previewTermReport, setPreviewTermReport] = useState<TermReportPreview | null>(null);
  const [previewVmogi, setPreviewVmogi] = useState<{ found: boolean; message?: string } | null>(null);
  const [previewMaterials, setPreviewMaterials] = useState<MaterialChoice[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false), [previewMessage, setPreviewMessage] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [generationMessage, setGenerationMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [savedFile, setSavedFile] = useState('');
  const [cloudSynced, setCloudSynced] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [schoolViewerOpen, setSchoolViewerOpen] = useState(false);
  const schoolViewerButtonRef = useRef<HTMLButtonElement>(null);
  const [schoolFolderBusy, setSchoolFolderBusy] = useState(false);
  const [schoolFolderMessage, setSchoolFolderMessage] = useState('');
  const [schoolFolderFailed, setSchoolFolderFailed] = useState(false);
  const [materialContext, setMaterialContext] = useState<MaterialContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const contextCache = useRef(new Map<string, MaterialContext>());
  const summaryRequests = useRef(new Set<string>());
  const currentNumber = useRef('');
  const selectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const viewerButtonRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const folderSupported = useSyncExternalStore(subscribeToBrowserSupport, canSaveOfflineFolder, () => false);
  const [folderJob, setFolderJob] = useState<{ id: string; number: string; name: string; grade: string } | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [summarySaveMessage, setSummarySaveMessage] = useState('');
  const [summarySaveBusy, setSummarySaveBusy] = useState(false);
  const [workerStatus, setWorkerStatus] = useState('作成PCを確認中…');
  const [workerOnline, setWorkerOnline] = useState(false);
  const [targetWorkerId, setTargetWorkerId] = useState('');
  const [localWorkerMessage, setLocalWorkerMessage] = useState('');
  const selected = students.find(s => s.number === number);
  const answer = selected?.responses.find(r => r.id === answerId);
  const showPastSchools = selected?.grade === '中2' && (selected.responses.length === 0 || Boolean(answer && answer.schools.length === 0));
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
  const dayTeachers = useMemo(() => appointmentTeachers.length ? appointmentTeachers
    : [...new Map(appointments.map(item => [item.teacherId, { id: item.teacherId, name: item.teacher }])).values()], [appointmentTeachers, appointments]);
  const dayAppointments = appointments.filter(item => item.date === appointmentDate && (!appointmentTeacherId || item.teacherId === appointmentTeacherId));
  const dayReview = appointmentReview.filter(item => !appointmentTeacherId || !item.teacherIds?.length || item.teacherIds.includes(appointmentTeacherId));
  const folderSaveIssue = !folderSupported ? 'フォルダ保存はChromeまたはEdgeで開いてください。'
    : !folderJob ? '保存する資料を確認できません。資料を作成し直してください。'
    : !manifest?.items.length || manifest.items.some(item => !item.previewUrl)
      ? '資料別のPDFを取得できていないため、HTMLを含むフォルダ保存はできません。資料を作成し直してください。' : '';
  useEffect(() => {
    let active = true;
    if (!number || !staff) return;
    const cached = contextCache.current.get(number);
    void (cached ? Promise.resolve(cached) : fetchMaterialContext(number)).then(result => {
      contextCache.current.set(number, result);
      if (active) setMaterialContext(result);
    }).catch(error => { if (active) setContextError(requestError(error)); })
      .finally(() => { if (active) setContextLoading(false); });
    return () => { active = false; };
  }, [number, staff]);
  useEffect(() => {
    const status = materialContext?.summary.status;
    if (!number || !['queued', 'running'].includes(status || '')) return;
    let active = true;
    let timer: number;
    const poll = async () => {
      try {
        const summary = await fetchInfoSummary(number, AbortSignal.timeout(10000));
        if (!active || currentNumber.current !== number) return;
        const cached = contextCache.current.get(number);
        if (cached?.summary.sourceHash && summary.sourceHash !== cached.summary.sourceHash) return;
        setMaterialContext(previous => previous ? { ...previous, summary } : previous);
        if (cached) contextCache.current.set(number, { ...cached, summary });
        if (!['queued', 'running'].includes(summary.status)) return;
      } catch { /* Keep displaying the originals; retry without overlapping requests. */ }
      if (active) timer = window.setTimeout(() => { void poll(); }, 3000);
    };
    timer = window.setTimeout(() => { void poll(); }, 3000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [number, materialContext?.summary.status]);
  const needInfoSummary = useCallback(async () => {
    if (!number || materialContext?.summary.status !== 'prepared' || summaryRequests.current.has(number)) return;
    const selectedNumber = number;
    const sourceHash = materialContext.summary.sourceHash;
    summaryRequests.current.add(selectedNumber);
    const apply = (summary: MaterialContext['summary']) => {
      const cached = contextCache.current.get(selectedNumber);
      if (cached && (!sourceHash || cached.summary.sourceHash === sourceHash))
        contextCache.current.set(selectedNumber, { ...cached, summary });
      if (currentNumber.current === selectedNumber)
        setMaterialContext(previous => previous ? { ...previous, summary } : previous);
    };
    try {
      await requestInfoSummary(selectedNumber);
      apply({ ...materialContext.summary, status: 'queued' });
      try {
        const summary = await fetchInfoSummary(selectedNumber, AbortSignal.timeout(10000));
        if (!sourceHash || sourceHash === summary.sourceHash) apply(summary);
      } catch { /* The regular polling will retry. */ }
    } catch { apply({ ...materialContext.summary, status: 'failed' }); }
    finally { summaryRequests.current.delete(selectedNumber); }
  }, [number, materialContext]);
  useEffect(() => {
    if (!number || materialContext?.summary.status !== 'prepared') return;
    const timer = window.setTimeout(() => { void needInfoSummary(); }, 0);
    return () => window.clearTimeout(timer);
  }, [number, materialContext?.summary.status, needInfoSummary]);
  const chooseStudent = useCallback((student: Student, preferredAnswer = '') => {
    const selectedAnswer = student.responses.find(response => answerKey(response.id) === answerKey(preferredAnswer))
      ?? (student.responses.length === 1 ? student.responses[0] : undefined);
    setNumber(student.number); setAnswerId(selectedAnswer?.id ?? '');
    setTargetWorkerId(''); setLocalWorkerMessage('');
    setSelectedAppointment(null);
    currentNumber.current = student.number;
    setMaterialContext(null); setContextError(''); setContextLoading(true);
    setSchoolNames(suggestedSchools(selectedAnswer?.schools ?? []));
    setPreview(null); setPreviewHokushin(null); setPreviewTermReport(null); setPreviewVmogi(null); setPreviewMaterials([]); setSelectedMaterialIds([]); setPreviewMessage('');
    setManifest(null); setPdfUrl(''); setViewerOpen(false); setFolderJob(null); setDownloadMessage(''); setGenerationMessage(''); setSaveMessage(''); setSavedFile(''); setCloudSynced(false);
  }, []);

  useEffect(() => {
    if (!staff || !appointmentDate) return;
    const controller = new AbortController();
    void fetch(`/api/staff/interview-material-appointments?date=${encodeURIComponent(appointmentDate)}`,
      { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw Error(body.error || '面談予定を取得できません。');
      if (body.source !== 'notion-bensuke') throw Error('Notionベンケイの予定を確認できません。');
      setAppointments(body.appointments ?? []);
      setAppointmentTeachers(body.teachers ?? []);
      setAppointmentReview(body.review ?? []);
    }).catch(error => { if (!controller.signal.aborted) setAppointmentMessage(requestError(error)); })
      .finally(() => { if (!controller.signal.aborted) setAppointmentBusy(false); });
    return () => controller.abort();
  }, [staff, appointmentDate, appointmentReload]);

  function toggleSchoolCandidate(name: string, checked: boolean) {
    setSchoolNames(names => checked
      ? names.some(value => searchable(value) === searchable(name)) || names.filter(Boolean).length >= 6
        ? names : [...names.filter(Boolean), name]
      : names.filter(value => searchable(value) !== searchable(name)));
    setPreview(null); setPreviewMaterials([]); setSelectedMaterialIds([]); setManifest(null); setPdfUrl('');
  }

  useEffect(() => {
    if (manifest && pdfUrl) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [manifest, pdfUrl]);

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
    } catch { setWorkerOnline(false); setWorkerStatus('作成PCの稼働状況を確認できません。'); }
  }, []);
  const load = useCallback(async () => {
    const [response] = await Promise.all([
      fetch('/api/staff/interview-materials', { cache: 'no-store' }), refreshWorkers(),
    ]);
    const body = await response.json();
    if (!response.ok) throw Error(body.error || 'アンケートを取得できません。');
    setStudents(body.students);
    const linkedAnswer = new URLSearchParams(window.location.search).get('answer');
    if (linkedAnswer && /^[a-f0-9-]{32,36}$/i.test(linkedAnswer)) {
      const linkedStudent = (body.students as Student[]).find(student => student.responses.some(response => answerKey(response.id) === answerKey(linkedAnswer)));
      if (linkedStudent) chooseStudent(linkedStudent, linkedAnswer);
      else setMessage('このアンケート回答と生徒を照合できませんでした。担任・学年・氏名で生徒を探してください。');
    }
  }, [refreshWorkers, chooseStudent]);
  async function readThisPcWorkerId() {
    const response = await fetch(LOCAL_HELPER_HEALTH, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('このPCの資料作成アプリに接続できません。');
    const health = await response.json();
    if (!health.ready || typeof health.workerId !== 'string' || !/^[a-z0-9_-]{3,32}$/.test(health.workerId))
      throw Error('このPCの資料作成アプリのworker設定を確認できません。');
    return health.workerId as string;
  }
  async function selectThisPc() {
    setLocalWorkerMessage('');
    try {
      const workerId = await readThisPcWorkerId();
      const response = await fetch('/api/staff/interview-material-jobs', { cache: 'no-store' });
      if (!response.ok) throw Error('作成PCの稼働状況を確認できません。');
      const body = await response.json();
      if (!Array.isArray(body.available) || !body.available.some((worker: { id: string }) => worker.id === workerId))
        throw Error('このPCの資料作成アプリは待機状態ではありません。');
      setTargetWorkerId(workerId);
      setLocalWorkerMessage(`このPC（${workerId}）で今回の資料を作成します。`);
    } catch (error) { setLocalWorkerMessage(requestError(error)); }
  }
  async function submitJob(kind: 'preview' | 'generate') {
    if (targetWorkerId && await readThisPcWorkerId() !== targetWorkerId)
      throw Error('このPCのworker設定が変わりました。作成PCを選び直してください。');
    if (!selected) throw Error('生徒を選択してください。');
    const response = await fetch('/api/staff/interview-material-jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, number: selected.number, campus, schools: kind === 'preview'
        ? schoolNames.map(name => name.trim()).filter(Boolean) : preview?.map(school => school.name) || [],
        ...(answer ? { answerId: answer.id } : {}),
        ...(targetWorkerId ? { targetWorkerId } : {}),
        ...(kind === 'generate' ? { selectedMaterialIds } : {}) }),
    });
    const created = await response.json();
    if (!response.ok) throw Error(created.error || '作成依頼を登録できません。');
    for (let attempt = 0; attempt < 300; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 2000));
      const status = await fetch(`/api/staff/interview-material-jobs?id=${created.id}`, { cache: 'no-store' });
      const body = await status.json();
      if (!status.ok) throw Error(body.error || '作成状況を確認できません。');
      if (body.job.status === 'completed') return { ...body.job, id: created.id };
      if (body.job.status === 'failed') throw Error(body.job.error || '作成PCで処理できませんでした。');
    }
    throw Error('作成状況の確認が時間切れになりました。もう一度画面を開いて確認してください。');
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/admin/teachers', { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw Error(body.error || '先生一覧を取得できません。');
        if (active) setLoginTeachers(body.teachers ?? []);
      } catch (error) { if (active) setMessage(requestError(error)); }
    })();
    return () => { active = false; };
  }, []);
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
      const response = await fetch('/api/staff/availability-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teacherId, password }) });
      const body = await response.json(); setPassword('');
      if (!response.ok) throw Error(body.code === 'invalid_credentials'
        ? '先生の名前またはパスワードを確認してください。' : body.error || 'ログインできません。');
      setStaff(true); await load();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function checkMaterials() {
    if (batchBusy || !selected || (selected.responses.length > 1 && !answer)) return;
    setPreviewBusy(true); setPreviewMessage(''); setPreview(null); setPreviewHokushin(null); setPreviewTermReport(null); setPreviewVmogi(null); setPreviewMaterials([]); setSelectedMaterialIds([]); setManifest(null); setPdfUrl(''); setFolderJob(null); setDownloadMessage('');
    try {
      const job = await submitJob('preview');
      setPreview(job.result.schools);
      setPreviewHokushin(job.result.hokushin ?? null);
      setPreviewTermReport(job.result.termReport ?? null);
      setPreviewVmogi(job.result.vmogi ?? null);
      const materials = Array.isArray(job.result.materials) ? job.result.materials as MaterialChoice[] : [];
      setPreviewMaterials(materials);
      setSelectedMaterialIds(materials.map(item => item.id));
    } catch (error) { setPreviewMessage(requestError(error)); }
    finally { setPreviewBusy(false); }
  }
  async function generate() {
    if (batchBusy || !selected || !preview || selectedMaterialIds.length === 0 || (selected.responses.length > 1 && !answer)) return;
    setBusy(true); setGenerationMessage(''); setSaveMessage(''); setSavedFile(''); setCloudSynced(false); setManifest(null); setFolderJob(null); setDownloadMessage('');
    try {
      const job = await submitJob('generate');
      setManifest(job.result);
      setViewerOpen(false);
      setPdfUrl(job.pdfUrl || '');
      setFolderJob({ id: job.id, number: selected.number, name: selected.name, grade: selected.grade });
      setSavedFile(job.result.savedPath || '');
      setCloudSynced(Boolean(job.result.cloudSynced));
      setSaveMessage(job.result.saveError || '');
      setTargetWorkerId(''); setLocalWorkerMessage('');
      await refreshWorkers();
    } catch (error) { setGenerationMessage(requestError(error)); }
    finally { setBusy(false); }
  }
  async function savePdf() {
    if (!folderJob || downloadBusy || folderBusy) return;
    setDownloadBusy(true); setDownloadFailed(false); setDownloadMessage('一式PDFを保存しています…');
    try {
      const name = await downloadInterviewPdf(folderJob.id, folderJob.number);
      setDownloadMessage(`「${name}」をダウンロードしました。`);
    } catch (error) { setDownloadFailed(true); setDownloadMessage(requestError(error)); }
    finally { setDownloadBusy(false); }
  }
  async function saveFolder() {
    if (batchBusy || !folderJob || folderBusy || downloadBusy) return;
    setFolderBusy(true); setDownloadFailed(false); setDownloadMessage('');
    try {
      const name = await saveInterviewFolder(folderJob.id, folderJob.number, folderJob.name, folderJob.grade, materialContext, setDownloadMessage, Boolean(showPastSchools), setSummarySaveMessage);
      setDownloadMessage(`「${name}」を保存しました。フォルダ内の「面談資料.html」を開けば、ネット接続なしで資料・面談記録・生徒情報を確認できます。AI要約は完成済みの場合に含まれます。`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setDownloadMessage('保存を取り消しました。');
      else { setDownloadFailed(true); setDownloadMessage(requestError(error)); }
    } finally { setFolderBusy(false); }
  }
  function changeAppointmentDate(value: string) {
    setAppointmentTeacherId(''); setAppointmentTeachers([]);
    setAppointmentDate(value); setSelectedAppointment(null); setAppointments([]); setAppointmentReview([]);
    setAppointmentBusy(Boolean(value)); setAppointmentMessage('');
  }
  async function saveSchoolFolder() {
    if (batchBusy || schoolFolderBusy) return;
    setSchoolFolderBusy(true); setSchoolFolderFailed(false); setSchoolFolderMessage('');
    try {
      const name = await saveSchoolLibraryFolder(setSchoolFolderMessage);
      setSchoolFolderMessage(`「${name}」フォルダを保存しました。「北辰基礎資料.html」を開けば、全学校・学科をネット接続なしで閲覧できます。生徒フォルダごとに保存する必要はありません。`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setSchoolFolderMessage('保存を取り消しました。');
      else { setSchoolFolderFailed(true); setSchoolFolderMessage(requestError(error)); }
    } finally { setSchoolFolderBusy(false); }
  }
  async function updateSavedSummary() {
    if (batchBusy || !selected || summarySaveBusy) return;
    setSummarySaveBusy(true);setSummarySaveMessage('');
    try { await updateInterviewFolderSummary(selected.number, setSummarySaveMessage); }
    catch (error) { setSummarySaveMessage(error instanceof DOMException && error.name === 'AbortError' ? '更新を取り消しました。' : requestError(error)); }
    finally { setSummarySaveBusy(false); }
  }
  return <main className={styles.page}>
    <header><Link href="/">勉たんに戻る</Link><h1>面談資料を作る</h1><p>2026年 秋の面談アンケート ／ 先生の手元用</p></header>
    {message && <p className={styles.error} role="status">{message}</p>}
    {!ready ? <p>読み込んでいます…</p> : !staff ? <form className={styles.card} onSubmit={login}>
      <h2>先生ログイン</h2><label>先生の名前<select value={teacherId} onChange={event => setTeacherId(event.target.value)} required><option value="">選択してください</option>{loginTeachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.display_name}先生</option>)}</select></label>
      <label>いつものパスワード<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      <button disabled={busy || loginTeachers.length === 0}>ログイン</button>
    </form> : <>
      <p role="status" className={styles.note}>{workerStatus} <button type="button" onClick={() => void refreshWorkers()}>稼働状況を再確認</button></p>
      <DailyMaterialPanel />
      <ManualMaterialPanel teachers={loginTeachers.map(teacher => ({ id: teacher.id, name: teacher.display_name }))} />
      <section className={styles.card} aria-label="共通の北辰基礎資料"><h2>北辰基礎資料（全学校）</h2>
        <p>面談中にほかの学校を見たいときは、こちらを開いてください。生徒を選ぶ前でも使えます。</p>
        <div className={styles.actions}>
          <button type="button" ref={schoolViewerButtonRef} onClick={() => setSchoolViewerOpen(true)}>北辰基礎資料を見る</button>
          <button type="button" disabled={batchBusy || !folderSupported || schoolFolderBusy} onClick={() => void saveSchoolFolder()}>{schoolFolderBusy ? '北辰用フォルダを保存中…' : '北辰用フォルダを保存'}</button>
        </div>
        <p className={styles.note}>全学校のPDFは「北辰基礎資料」フォルダに1セットだけ保存します（約750MB）。保存後は、その中の「北辰基礎資料.html」を必要なときに開いてください。2回目以降は確認済みのPDFを再利用します。{!folderSupported && 'フォルダ保存はChromeまたはEdgeで利用できます。'}</p>
        {schoolFolderMessage && <p role={schoolFolderFailed ? 'alert' : 'status'} className={schoolFolderFailed ? styles.error : styles.note}>{schoolFolderMessage}</p>}
      </section>
      <section className={styles.card}><h2>1. 生徒を選ぶ</h2>
        <div className={styles.appointmentPicker}>
          <h3>面談日から選ぶ</h3>
          <label>面談日<input type="date" value={appointmentDate} disabled={batchBusy} onChange={event => changeAppointmentDate(event.target.value)} /></label>
          <label>面談の先生<select value={appointmentTeacherId} disabled={batchBusy || appointmentBusy || !appointmentDate}
            onChange={event => { setAppointmentTeacherId(event.target.value); setSelectedAppointment(null); }}>
            <option value="">先生を選ぶ</option>{dayTeachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}先生</option>)}
          </select></label>
          <p className={styles.note}>取得元：Notionベンケイ。先生ごとの予定の書き方をAIが読み取り、生徒台帳・職員DBと一致した面談から選べます。</p>
          <button type="button" disabled={!appointmentDate || appointmentBusy || batchBusy} onClick={() => { setAppointmentTeacherId(''); setAppointmentTeachers([]); setSelectedAppointment(null); setAppointments([]); setAppointmentReview([]); setAppointmentMessage(''); setAppointmentBusy(true); setAppointmentReload(value => value + 1); }}>Notionの予定を再取得</button>
          {appointmentBusy && <p role="status">面談予定を読み込んでいます…</p>}
          {appointmentMessage && <p role="alert" className={styles.error}>{appointmentMessage}</p>}
          <BatchFolderPanel key={`${appointmentDate}:${appointmentTeacherId}:${appointmentReload}`} date={appointmentDate} teacherId={appointmentTeacherId}
            appointments={appointments} folderSupported={folderSupported} workerOnline={workerOnline}
            disabled={appointmentBusy || Boolean(appointmentMessage) || busy || previewBusy || folderBusy || downloadBusy || schoolFolderBusy || summarySaveBusy}
            onBusyChange={setBatchBusy} />
          {appointmentDate && !appointmentBusy && !appointmentMessage && (dayAppointments.length
            ? <div className={styles.studentResults} aria-label="選んだ日の面談予定">{dayAppointments.map(item => <button type="button" key={`${item.id}:${item.number}`} disabled={batchBusy}
                className={styles.studentResult} aria-pressed={selectedAppointment?.id === item.id && selectedAppointment?.number === item.number} onClick={() => {
                  const student = students.find(row => row.number === item.number);
                  if (!student) { setAppointmentMessage('面談予定の生徒が現在の台帳に見つかりません。'); return; }
                  if (number !== student.number || !manifest || folderJob?.number !== student.number) chooseStudent(student);
                  setSelectedAppointment(item);
                }}><strong>{item.start}　{item.grade} {item.name}</strong><span>{item.teacher}先生 ／ {item.number}</span></button>)}</div>
            : <p>この日に保存できる面談予定はありません。</p>)}
          {!!dayReview.length && <div className={styles.appointmentReview} aria-label="要確認の面談予定">
            <h3>要確認 {dayReview.length}件（保存対象外）</h3>
            {dayReview.map(item => <div key={item.id}><strong>{item.title}</strong><p>{item.reason}</p>
              <div className={styles.actions}><a href={item.url} target="_blank" rel="noreferrer">Notionで予定を確認</a></div></div>)}
          </div>}
          {selectedAppointment && <div className={styles.appointmentReview}>
            <p>保存予定：{interviewMaterialFolderParts(selectedAppointment).join('／')}</p>
            <div className={styles.actions}><a href={selectedAppointment.url} target="_blank" rel="noreferrer">選んだ面談のNotion原本を開く</a></div>
          </div>}
        </div>
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
      {selected && <section className={styles.card}><h2 ref={selectionHeadingRef} tabIndex={-1} style={{ scrollMarginTop: 24 }}>2. アンケート回答を選ぶ</h2>
        {!selected.responses.length ? <p>今回の回答はありません。指導簿と見つかった模試資料を作ります。</p> : <>
          <p>回答が複数ある場合は、使う回答を先生が選択してください。</p>
          <div className={styles.answers}>{selected.responses.map((response, index) => <label key={response.id} className={styles.answer}>
            <input type="radio" name="answer" checked={answerId === response.id} onChange={() => { setAnswerId(response.id); setSchoolNames(suggestedSchools(response.schools)); setPreview(null); setPreviewMaterials([]); setSelectedMaterialIds([]); setPreviewMessage(''); setManifest(null); setPdfUrl(''); setFolderJob(null); setDownloadMessage(''); setGenerationMessage(''); setSaveMessage(''); setSavedFile(''); setCloudSynced(false); }} />
            <span>{index === 0 ? '最新' : `${index + 1}件目`} ／ {response.date || '日時不明'}<br />志望校：{response.schools.join('、') || '記載なし'}</span>
          </label>)}</div>
          {answer && <div className={styles.reviewGrid}>
            <div className={styles.survey}><div className={styles.surveyHeading}><h3>アンケート回答</h3><span>回答日：{answer.date || '日時不明'}</span></div><dl>{answer.fields.map((field, index) => <div className={styles.surveyField} key={index}><dt>{field.label}</dt><dd>{field.value || '（回答なし）'}</dd></div>)}</dl><a href={answer.url} target="_blank" rel="noreferrer">Notionの回答原本</a></div>
            <div><h3>{answer.schools.length ? '志望順位の確認' : '資料を探す高校'}</h3><p>{answer.schools.length ? 'アンケートの第1・第2・第3志望を確認してください。違う場合はここで直せます。' : '過去の記録で話題に出た高校を下から複数選べます。ここで選んでも志望校として確定しません。'}</p>
              {schoolNames.map((school, index) => <label key={index}>{answer.schools.length ? `第${index + 1}志望` : `資料候補 ${index + 1}`}<input value={school} onChange={event => { setSchoolNames(names => names.map((name, position) => position === index ? event.target.value : name)); setPreview(null); setPreviewMaterials([]); setSelectedMaterialIds([]); setManifest(null); }} /></label>)}
              {schoolNames.length < 6 && <button type="button" onClick={() => { setSchoolNames(names => [...names, '']); setPreview(null); setPreviewMaterials([]); setSelectedMaterialIds([]); setManifest(null); }}>{answer.schools.length ? '志望校を追加' : '資料候補を追加'}</button>}
              {answer.schools.some(name => /^えいめい(?:高校|高等学校)?$/u.test(name.trim())) && <p className={styles.note}>アンケートの「えいめい」は「叡明」として確認します。</p>}
            </div>
          </div>}
        </>}
        {showPastSchools && <div className={styles.preview}><h3>過去の面談で話題に出た高校</h3>
          <p className={styles.note}>アンケートに志望校の記載がないため、Notionの過去の面談記録にある高校への言及を示します。志望校として確定した情報ではありません。</p>
          {!!materialContext?.schoolCandidates?.length && <fieldset><legend>資料を探す高校を複数選択</legend>
            {materialContext.schoolCandidates.map(candidate => <label className={styles.materialOption} key={candidate.name}>
              <input type="checkbox" checked={schoolNames.some(name => searchable(name) === searchable(candidate.name))}
                disabled={!schoolNames.some(name => searchable(name) === searchable(candidate.name)) && schoolNames.filter(Boolean).length >= 6}
                onChange={event => toggleSchoolCandidate(candidate.name, event.target.checked)} />
              <span><strong>{candidate.name}</strong><small>{candidate.date || '日付なし'}・{candidate.text} ／ <a href={candidate.url} target="_blank" rel="noreferrer">Notion原本</a></small></span>
            </label>)}
            <p className={styles.note}>選択した高校の資料を検索します。最大6校まで選べます。</p>
          </fieldset>}
          {contextLoading ? <p role="status">面談記録を確認中…</p> : contextError ? <p role="alert">{contextError}</p>
            : materialContext?.schoolMentions?.length ? <ul>{materialContext.schoolMentions.map((mention, index) => <li key={`${mention.url}-${index}`}>{mention.text} <small>（{mention.date || '日付なし'}・<a href={mention.url} target="_blank" rel="noreferrer">Notion原本</a>）</small></li>)}</ul>
              : <p>高校名への言及は見つかりませんでした。</p>}
          {!answer && <div><h4>選択中の資料候補</h4>{schoolNames.map((school, index) => <label key={index}>資料候補 {index + 1}<input value={school} onChange={event => { setSchoolNames(names => names.map((name, position) => position === index ? event.target.value : name)); setPreview(null); setPreviewMaterials([]); setSelectedMaterialIds([]); setManifest(null); }} /></label>)}
            {schoolNames.length < 6 && <button type="button" onClick={() => { setSchoolNames(names => [...names, '']); setPreview(null); setPreviewMaterials([]); setSelectedMaterialIds([]); setManifest(null); }}>資料候補を追加</button>}</div>}
        </div>}
        <div className={styles.actions}>
          <button type="button" disabled={batchBusy || previewBusy || busy || Boolean(preview)} onClick={() => void selectThisPc()}>このPCで処理</button>
          {targetWorkerId && <button type="button" disabled={batchBusy || previewBusy || busy || Boolean(preview)} onClick={() => { setTargetWorkerId(''); setLocalWorkerMessage(''); }}>自動選択に戻す</button>}
        </div>
        {localWorkerMessage && <p className={styles.note} role="status">{localWorkerMessage}</p>}
        <div className={styles.actions}><button className={styles.primary} disabled={batchBusy || !workerOnline || previewBusy || selected.responses.length > 1 && !answer} onClick={() => void checkMaterials()}>{previewBusy ? 'NASの資料を確認中…' : '資料を作る'}</button></div>
        {selected.responses.length > 1 && !answer && <p className={styles.note}>上のアンケート回答を1つ選ぶと資料を確認できます。</p>}
        {previewMessage && <p className={styles.error} role="alert">{previewMessage}</p>}
        {preview && <div className={styles.preview}><h3>印刷する資料を選ぶ</h3>
          <p className={styles.note}>チェックした資料だけを一式PDFに入れ、保存・印刷します。見つかった資料は最初から選択されています。</p>
          {previewMaterials.length > 0 ? <>
            <div className={styles.selectionTools}>
              <button type="button" onClick={() => setSelectedMaterialIds(previewMaterials.map(item => item.id))}>見つかった資料をすべて選ぶ</button>
              <button type="button" onClick={() => setSelectedMaterialIds([])}>選択をすべて外す</button>
              <strong role="status">選択中 {selectedMaterialIds.length}点 ／ 見つかった資料 {previewMaterials.length}点</strong>
            </div>
            {[...new Set(previewMaterials.map(item => item.group))].map(group => <div className={styles.materialGroup} key={group}>
              <h4>{group}</h4>
              {previewMaterials.filter(item => item.group === group).map(item => <label className={styles.materialOption} key={item.id}>
                <input type="checkbox" checked={selectedMaterialIds.includes(item.id)} onChange={event => setSelectedMaterialIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />
                <span><strong>{item.label}{item.staffOnly && <em className={styles.caution}>先生用・生徒に渡さない</em>}</strong><small>{item.detail}</small></span>
              </label>)}
            </div>)}
          </> : <p className={styles.error}>作成PCの資料一覧を取得できませんでした。作成アプリを更新し、もう一度「資料を作る」を押してください。</p>}
          <section className={styles.materialContextPreview} aria-label="面談記録とAIのまとめ">
            <h4>面談記録とAIのまとめ</h4>
            <p className={styles.note}>PDFを作成する前に先生が確認する情報です。印刷用の一式PDFには入りません。</p>
            {contextLoading ? <p role="status">Notionの面談記録を読み込み中…</p>
              : contextError ? <p className={styles.error} role="alert">{contextError}</p>
                : !materialContext ? <p>面談記録を取得できませんでした。</p> : <>
                  <div className={styles.materialContextSummary}>
                    <h5>面談前の確認点（AI）</h5>
                    {materialContext.summary.status === 'completed'
                      ? materialContext.summary.items.length
                        ? <ul>{materialContext.summary.items.map((item, index) => <li key={`${item.source}-${index}`}><strong>{item.note}</strong><small>出典：{item.source}</small></li>)}</ul>
                        : <p>特記する項目はありません。</p>
                      : materialContext.summary.status === 'failed' ? <p>AIのまとめを取得できませんでした。下の記録本文を確認してください。</p>
                        : materialContext.summary.status === 'empty' ? <p>まとめる記録や生徒情報はありません。</p>
                          : <p role="status">過去の面談記録と生徒情報を確認中です。</p>}
                  </div>
                  <div className={styles.materialContextRecords}>
                    <h5>面談記録（Notionの直近3回）</h5>
                    {materialContext.records.length ? materialContext.records.map(record => <details key={record.id}>
                      <summary>{record.date || '日付なし'}　{record.title}</summary>
                      {(record.method || record.purpose) && <p>方法：{record.method || '記載なし'} ／ 目的：{record.purpose || '記載なし'}</p>}
                      <div className={styles.materialContextBody}>{record.body || '本文はありません。'}</div>
                      {!!record.attachments?.length && <p>添付ファイル：{record.attachments.join('、')}（原本から確認）</p>}
                      <a href={record.url} target="_blank" rel="noreferrer">Notionの原本を開く</a>
                    </details>) : <p>過去の面談記録は見つかりませんでした。</p>}
                  </div>
                </>}
          </section>
          {preview.some(school => !school.found) && <div className={styles.unavailable}><h4>見つからなかった志望校資料</h4><ol>{preview.filter(school => !school.found).map(school => <li key={school.rank}>第{school.rank}志望：{school.name} — 該当資料なし・選択不可</li>)}</ol></div>}
          {previewHokushin && !previewHokushin.found && selected.grade.match(/^中[23]$/) && <p>北辰の個人成績票：{previewHokushin.message || '該当資料なし'}</p>}
          {previewTermReport && !previewTermReport.found && <p>成績通知の個人成績表：{previewTermReport.message || '該当資料なし'}</p>}
          {previewVmogi && !previewVmogi.found && selected.grade.match(/^中[23]$/) && <p>Vもぎ：{previewVmogi.message || '該当資料なし'}</p>}
          <button className={styles.primary} disabled={batchBusy || !workerOnline || busy || Boolean(previewHokushin?.indexing) || selectedMaterialIds.length === 0} onClick={() => void generate()}>{busy ? 'PDFを作成中…' : `選んだ${selectedMaterialIds.length}点でPDFを作成`}</button>
          {previewHokushin?.indexing && <p className={styles.note}>索引の作成が終わったら「資料を作る」をもう一度押して確認してください。</p>}
        </div>}
        {generationMessage && <p className={styles.error} role="alert">{generationMessage}</p>}
        <p className={styles.note}>NASで資料の有無と年度を確認してからPDFを作成します。アンケート回答も最初から印刷対象に選ばれています。</p>
      </section>}
      {selected && folderSupported && <section className={styles.card}><h2>保存済みフォルダのAI要約</h2><p>AIの完成後に勉たんを閉じていた場合も、生徒名のフォルダを選んで要約だけを追加できます。</p><button type="button" disabled={batchBusy || summarySaveBusy || folderBusy} onClick={() => void updateSavedSummary()}>{summarySaveBusy ? 'AI要約を更新中…' : '保存済みフォルダのAI要約を更新'}</button>{summarySaveMessage && <p role="status">{summarySaveMessage}</p>}</section>}
      {manifest && <section className={`${styles.card} ${styles.resultCard}`} ref={resultRef}><h2>3. 完成した資料を使う</h2>
        <p>{manifest.items.length}点 ／ 計{manifest.pages}ページ。使い方を選んでください。</p>
        <div className={styles.actions}><button type="button" onClick={() => {
          selectionHeadingRef.current?.focus({ preventScroll: true });
          selectionHeadingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}>← アンケート・資料の選択に戻る</button></div>
        {pdfUrl && <div className={styles.resultChoices} role="group" aria-label="完成した面談資料の使い方">
          <a className={styles.resultChoice} href={`${pdfUrl.split('#')[0]}#zoom=100&navpanes=0`} target="_blank" rel="noreferrer" aria-label="印刷用の一式PDFを開く"><strong>印刷</strong><span>一式PDFを開く</span></a>
          <button ref={viewerButtonRef} type="button" className={styles.resultChoice} onClick={() => setViewerOpen(true)}><strong>画面で見る</strong><span>資料を切り替える</span></button>
          <button type="button" className={styles.resultChoice} disabled={batchBusy || Boolean(folderSaveIssue) || folderBusy || downloadBusy} onClick={() => void saveFolder()}><strong>{folderBusy ? 'フォルダを保存中…' : '共有フォルダに保存'}</strong><span>HTML・PDFを生徒別に保存</span></button>
        </div>}
        {pdfUrl && <p className={styles.note}>別タブで開いたPDFから戻るときは、元の勉たんのタブを選んでください。</p>}
        {pdfUrl && <div className={styles.downloadOptions} aria-label="HTMLとPDFの保存先">
          <strong>保存後は「面談資料.html」を開く</strong>
          <p>資料を切り替えて画面で見るためのHTML、PDF、面談記録、生徒情報を同じフォルダに保存します。</p>
          {folderSaveIssue && <p className={styles.error} role="status">{folderSaveIssue}</p>}
          {folderJob && <p className={styles.sharePath}>保存するフォルダ：98面談資料／{individualInterviewMaterialFolderParts(folderJob).join('／')}／面談資料.html</p>}
          <p className={styles.note}>{folderSupported ? '「共有フォルダに保存」を押し、保存先の選択画面で下記の「98面談資料」を選んでください。「個別保存」の中に生徒名と学籍番号のフォルダを作ります。日程や先生を選ぶ必要はありません。保存した「面談資料.html」をダブルクリックすると、ブラウザで資料を閲覧できます。' : 'フォルダ保存はChromeまたはEdgeで利用できます。一式PDFは保存できます。'}</p>
          {folderSupported && <><p className={styles.sharePath}>{interviewMaterialsSharePath}</p><button type="button" onClick={() => {
            void navigator.clipboard.writeText(interviewMaterialsSharePath).then(() => setShareMessage('共有フォルダの場所をコピーしました。保存先の選択画面のアドレス欄へ貼り付けてください。'))
              .catch(() => setShareMessage('表示した共有フォルダの場所を保存先のアドレス欄へ入力してください。'));
          }}>共有フォルダの場所をコピー</button>{shareMessage && <p role="status">{shareMessage}</p>}
          <p className={styles.note}>保存先のアドレス欄が上の共有パスであることを確認してください。同じ生徒の資料を再保存すると、末尾に「再保存」を付けた新しいフォルダを作り、前の資料を残します。</p></>}
          <div className={styles.downloadActions}><button type="button" disabled={!folderJob || downloadBusy || folderBusy} onClick={() => void savePdf()}>{downloadBusy ? '一式PDFを保存中…' : '一式PDFをダウンロード'}<small>PDFを1つのファイルとして保存</small></button></div>
        </div>}
        {downloadMessage && <p role="status" className={downloadFailed ? styles.error : styles.note}>{downloadMessage}</p>}
        {savedFile && <p role="status">{cloudSynced ? '作成PCとOneDriveのクラウドに保存しました' : '作成PCのOneDriveフォルダに保存しました'}（一式PDF）：{savedFile}。HTMLで閲覧する資料一式は、上の「共有フォルダに保存」から保存してください。別PCでPDFを開く前にOneDriveの同期完了を確認してください。</p>}
        {saveMessage && <p className={styles.error} role="alert">{saveMessage}</p>}
        <ol>{manifest.items.map((item, index) => <li key={index}>{item.label}{item.staffOnly && <strong className={styles.caution}>生徒には渡さない</strong>}</li>)}</ol>
        {manifest.missing.length > 0 && <div className={styles.missing}><h3>見つからなかった資料</h3><ul>{manifest.missing.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        <p className={styles.note}>表示リンクは約10分間有効です。完成PDFは非公開で1日保管し、OneDriveにも保存します。</p>
      </section>}
      {manifest && pdfUrl && <MaterialPdfViewer key={pdfUrl} items={manifest.items} pdfUrl={pdfUrl} open={viewerOpen} onClose={() => {
        setViewerOpen(false);
        requestAnimationFrame(() => viewerButtonRef.current?.focus());
      }} context={materialContext} contextLoading={contextLoading} contextError={contextError} showPastSchools={Boolean(showPastSchools)} onNeedInfoSummary={needInfoSummary} />}
      <MaterialPdfViewer items={[]} pdfUrl="" schoolLibraryOnly open={schoolViewerOpen} onClose={() => {
        setSchoolViewerOpen(false);
        requestAnimationFrame(() => schoolViewerButtonRef.current?.focus());
      }} context={null} contextLoading={false} contextError="" showPastSchools={false} onNeedInfoSummary={() => {}} />
    </>}
  </main>;
}
