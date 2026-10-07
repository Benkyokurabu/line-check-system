import { NextRequest, NextResponse } from 'next/server';
import { materialJobBody, MATERIAL_BUCKET, workerContext } from '@/lib/interview-material-worker';
import { prepareDailyMaterials, scanDailyMaterials } from '@/lib/interview-material-daily';
import { DailyMaterialError } from '@/lib/interview-material-daily-core.mjs';
import { InterviewError } from '@/lib/interview-core.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  try {
    const context = await workerContext(request);
    if (!context) return response({ error: '認証できません。' }, 401);
    const body = await materialJobBody(request);
    const action = String(body.action || '');
    if (action === 'heartbeat') {
      const { error } = await context.client.from('interview_material_workers').update({
        ready: body.ready === true, last_seen_at: new Date().toISOString(),
        status: body.status && typeof body.status === 'object' && !Array.isArray(body.status) ? body.status : {},
      }).eq('id', context.id);
      if (error) throw error;
      return response({ ok: true });
    }
    if (action === 'claim') {
      const { data, error } = await context.client.rpc('interview_material_claim', { p_worker: context.id });
      if (error) throw error;
      const job = data?.[0];
      return response({ job: job ? { id: job.id, kind: job.kind, payload: job.payload, lease: job.lease_token } : null });
    }
    if (action === 'daily-scan') return response(await scanDailyMaterials(context.client, context.id));
    const id = String(body.id || '');
    const lease = String(body.lease || '');
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}$/.test(lease)) return response({ error: '依頼番号を確認してください。' }, 400);
    const { data: job, error: jobError } = await context.client.from('interview_material_jobs')
      .select('id,kind,status,payload,daily_key,worker_id,lease_token,lease_until').eq('id', id).maybeSingle();
    if (jobError) throw jobError;
    if (!job || job.status !== 'running' || job.worker_id !== context.id || job.lease_token !== lease
      || Date.parse(job.lease_until) < Date.now()) return response({ error: '作成権限の期限が切れました。' }, 409);
    if (action === 'renew') {
      const { data, error } = await context.client.rpc('interview_material_renew', { p_job: id, p_worker: context.id, p_lease: lease });
      if (error) throw error;
      return response({ ok: data === true }, data === true ? 200 : 409);
    }
    if (action === 'daily-prepare' || action === 'daily-verify') {
      if (!job.daily_key || !job.payload?.autoDaily?.appointment) return response({ error: '自動作成の依頼ではありません。' }, 400);
      const prepared = await prepareDailyMaterials(context.client, job.payload.autoDaily.appointment, job.payload.autoDaily.manual === true);
      if (action === 'daily-verify') return response({ ok: prepared.sourceHash === body.sourceHash, sourceHash: prepared.sourceHash });
      const template = await fetch(new URL('/interview-material-offline-template.html', request.url), { cache: 'no-store' });
      if (!template.ok) throw Error('面談資料のHTML原本を取得できません。');
      return response({ ...prepared, template: await template.text() });
    }
    if (action === 'upload') {
      if (job.kind !== 'generate') return response({ error: 'PDFの作成依頼ではありません。' }, 400);
      const parts = body.parts === undefined ? 0 : body.parts;
      if (!Number.isInteger(parts) || Number(parts) < 0 || Number(parts) > 300) return response({ error: '資料の件数を確認してください。' }, 400);
      const path = `jobs/${id}/${lease}/bundle.pdf`;
      const { data, error } = await context.client.storage.from(MATERIAL_BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error) throw error;
      const uploads = await Promise.all(Array.from({ length: Number(parts) }, async (_, index) => {
        const materialPath = `jobs/${id}/${lease}/material-${index}.pdf`;
        const { data: material, error: materialError } = await context.client.storage.from(MATERIAL_BUCKET)
          .createSignedUploadUrl(materialPath, { upsert: true });
        if (materialError) throw materialError;
        return { url: material.signedUrl, path: materialPath };
      }));
      return response({ url: data.signedUrl, path, parts: uploads });
    }
    if (action === 'complete') {
      if (!body.result || typeof body.result !== 'object' || Array.isArray(body.result)) return response({ error: '作成結果を確認してください。' }, 400);
      const result = body.result as Record<string, unknown>;
      if (job.kind === 'generate' && !(job.daily_key && result.skipped === true && typeof result.savedFolder === 'string')) {
        const path = `jobs/${id}/${lease}/bundle.pdf`;
        const { data, error } = await context.client.storage.from(MATERIAL_BUCKET).info(path);
        if (error || !data || result.storagePath !== path) return response({ error: '完成PDFが見つかりません。' }, 409);
        const items = Array.isArray(result.items) ? result.items : [];
        if (items.length > 300) return response({ error: '資料の件数を確認してください。' }, 400);
        if (items.some(item => item?.storagePath)) {
          if (items.some((item, index) => item?.storagePath !== `jobs/${id}/${lease}/material-${index}.pdf`))
            return response({ error: '資料ごとのPDFを確認してください。' }, 409);
          const checks = await Promise.all(items.map((_, index) => context.client.storage.from(MATERIAL_BUCKET)
            .info(`jobs/${id}/${lease}/material-${index}.pdf`)));
          if (checks.some(check => check.error || !check.data)) return response({ error: '資料ごとのPDFが見つかりません。' }, 409);
        }
      }
      const { data, error } = await context.client.rpc('interview_material_finish', {
        p_job: id, p_worker: context.id, p_lease: lease, p_status: 'completed', p_result: result, p_error: null,
      });
      if (error) throw error;
      return response({ ok: data === true }, data === true ? 200 : 409);
    }
    if (action === 'fail') {
      const { data, error } = await context.client.rpc('interview_material_finish', {
        p_job: id, p_worker: context.id, p_lease: lease, p_status: 'failed', p_result: null,
        p_error: String(body.error || '資料を作成できませんでした。').slice(0, 300),
      });
      if (error) throw error;
      return response({ ok: data === true }, data === true ? 200 : 409);
    }
    return response({ error: '操作を確認してください。' }, 400);
  } catch (error) {
    if (error instanceof DailyMaterialError || error instanceof InterviewError) return response({ error: error.message }, 409);
    if (error instanceof SyntaxError || error instanceof Error && /invalid_|request_too_large/.test(error.message)) {
      return response({ error: '入力内容を確認してください。' }, 400);
    }
    console.error('material worker request failed', error instanceof Error ? error.message : error);
    return response({ error: '作成PCの処理に失敗しました。' }, 503);
  }
}
