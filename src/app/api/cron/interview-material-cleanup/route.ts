import 'server-only';
import { NextResponse } from 'next/server';
import { requireAttendanceCronToken } from '@/lib/env';
import { createSupabaseAdminClient } from '@/lib/supabase';
import { MATERIAL_BUCKET } from '@/lib/interview-material-worker';
import { removeMaterialJobFiles } from '@/lib/interview-material-cleanup.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!requireAttendanceCronToken(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const client = createSupabaseAdminClient();
    const { data: jobs, error } = await client.from('interview_material_jobs')
      .select('id,result').lt('expires_at', new Date().toISOString()).limit(50);
    if (error) throw error;
    let removed = 0;
    for (const job of jobs || []) {
      const storage = client.storage.from(MATERIAL_BUCKET);
      await removeMaterialJobFiles(storage, job.id);
      const { error: deleteError } = await client.from('interview_material_jobs').delete().eq('id', job.id);
      if (deleteError) throw deleteError;
      removed++;
    }
    return NextResponse.json({ removed });
  } catch (error) {
    console.error('material cleanup failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'cleanup_failed' }, { status: 503 });
  }
}
