import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase';

export const MATERIAL_BUCKET = 'interview-material-bundles';
export const online = (worker: { ready: boolean; last_seen_at: string | null }) =>
  worker.ready && Boolean(worker.last_seen_at) && Date.now() - Date.parse(worker.last_seen_at!) < 35_000;

export async function workerContext(request: NextRequest) {
  const id = request.headers.get('x-material-worker') || '';
  const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] || '';
  if (!/^[a-z0-9_-]{3,32}$/.test(id) || !token) return null;
  const client = createSupabaseAdminClient();
  const { data, error } = await client.from('interview_material_workers').select('id,secret_hash,priority').eq('id', id).maybeSingle();
  if (error || !data) return null;
  const digest = createHash('sha256').update(token).digest();
  const expected = Buffer.from(data.secret_hash, 'hex');
  if (expected.length !== digest.length || !timingSafeEqual(expected, digest)) return null;
  return { client, id, priority: data.priority };
}

export async function materialJobBody(request: NextRequest) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw Error('invalid_content_type');
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 65536) throw Error('request_too_large');
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('invalid_body');
  return body as Record<string, unknown>;
}
