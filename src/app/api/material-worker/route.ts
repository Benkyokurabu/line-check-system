import { NextRequest, NextResponse } from 'next/server';
import { materialJobBody, MATERIAL_BUCKET, workerContext } from '@/lib/interview-material-worker';

export const dynamic = 'force-dynamic';

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
    const id = String(body.id || '');
    const lease = String(body.lease || '');
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}$/.test(lease)) return response({ error: '依頼番号を確認してください。' }, 400);
    const { data: job, error: jobError } = await context.client.from('interview_material_jobs')
      .select('id,kind,status,worker_id,lease_token,lease_until').eq('id', id).maybeSingle();
    if (jobError) throw jobError;
    if (!job || job.status !== 'running' || job.worker_id !== context.id || job.lease_token !== lease
      || Date.parse(job.lease_until) < Date.now()) return response({ error: '作成権限の期限が切れました。' }, 409);
    if (action === 'renew') {
      const { data, error } = await context.client.rpc('interview_material_renew', { p_job: id, p_worker: context.id, p_lease: lease });
      if (error) throw error;
      return response({ ok: data === true }, data === true ? 200 : 409);
    }
    if (action === 'upload') {
      if (job.kind !== 'generate') return response({ error: 'PDFの作成依頼ではありません。' }, 400);
      const path = `jobs/${id}/bundle.pdf`;
      const { data, error } = await context.client.storage.from(MATERIAL_BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error) throw error;
      return response({ url: data.signedUrl, path });
    }
    if (action === 'complete') {
      if (!body.result || typeof body.result !== 'object' || Array.isArray(body.result)) return response({ error: '作成結果を確認してください。' }, 400);
      const result = body.result as Record<string, unknown>;
      if (job.kind === 'generate') {
        const path = `jobs/${id}/bundle.pdf`;
        const { data, error } = await context.client.storage.from(MATERIAL_BUCKET).info(path);
        if (error || !data || result.storagePath !== path) return response({ error: '完成PDFが見つかりません。' }, 409);
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
    if (error instanceof SyntaxError || error instanceof Error && /invalid_|request_too_large/.test(error.message)) {
      return response({ error: '入力内容を確認してください。' }, 400);
    }
    console.error('material worker request failed', error instanceof Error ? error.message : error);
    return response({ error: '作成PCの処理に失敗しました。' }, 503);
  }
}
