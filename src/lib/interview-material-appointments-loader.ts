import type { SupabaseClient } from '@supabase/supabase-js';
import { BENSUKE_SOURCE, staffDirectory } from '@/lib/bensuke-booking.mjs';
import { readBensukeDay } from '@/lib/bensuke-reader.mjs';
import { rosterMaterialDecisions, resolveMaterialAppointments } from '@/lib/bensuke-material-ai.mjs';
import { loadMaterialStudents } from '@/lib/interview-material-students';
import { notionRequest } from '@/lib/notion';
import { materialReadRequest } from '@/lib/interview-material-read.mjs';

export async function loadInterviewMaterialAppointments(client: SupabaseClient, date: string, signal: AbortSignal = AbortSignal.timeout(50000)) {
    return (await loadInterviewMaterialAppointmentRange(client, [date], signal))[0];
}

export async function loadInterviewMaterialAppointmentRange(client: SupabaseClient, dates: string[], signal: AbortSignal = AbortSignal.timeout(50000)) {
    const sourceId = process.env.NOTION_BENSUKE_DATA_SOURCE_ID || BENSUKE_SOURCE;
    const read = materialReadRequest(notionRequest, signal);
    const [schema, students] = await Promise.all([read(`/data_sources/${sourceId}`), loadMaterialStudents(client)]);
    const directory = await staffDirectory(read, schema);
    const planned = [];
    for (let index = 0; index < dates.length; index += 2) planned.push(...await Promise.all(dates.slice(index, index + 2).map(async date => {
      const day = await readBensukeDay({ date, sourceId, request: read });
      const rows = day.rows.filter(row => !row.availability);
      const decisions = rosterMaterialDecisions(rows, students);
      const result = resolveMaterialAppointments({ rows, decisions, students, directory, date });
      return { ...result, directory, day, sourceId, read };
    })));
    return planned;
}
