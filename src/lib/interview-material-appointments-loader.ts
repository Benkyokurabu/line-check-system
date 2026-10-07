import type { SupabaseClient } from '@supabase/supabase-js';
import { BENSUKE_SOURCE, staffDirectory } from '@/lib/bensuke-booking.mjs';
import { readBensukeDay } from '@/lib/bensuke-reader.mjs';
import { rosterMaterialDecisions, resolveMaterialAppointments } from '@/lib/bensuke-material-ai.mjs';
import { loadMaterialStudents } from '@/lib/interview-material-students';
import { notionRequest } from '@/lib/notion';

export async function loadInterviewMaterialAppointments(client: SupabaseClient, date: string, signal: AbortSignal = AbortSignal.timeout(50000)) {
    const sourceId = process.env.NOTION_BENSUKE_DATA_SOURCE_ID || BENSUKE_SOURCE;
    const read = (path: string, init?: RequestInit) => notionRequest(path,
      { ...init, cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    const [day, schema, students] = await Promise.all([
      readBensukeDay({ date, sourceId, request: read }), read(`/data_sources/${sourceId}`),
      loadMaterialStudents(client),
    ]);
    const directory = await staffDirectory(read, schema);
    const rows = day.rows.filter(row => !row.availability);
    const decisions = rosterMaterialDecisions(rows, students);
    const result = resolveMaterialAppointments({ rows, decisions, students, directory, date });
    return { ...result, directory, day, sourceId, read };
}
