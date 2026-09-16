import {NextRequest} from 'next/server';
import {createSupabaseAdminClient} from '@/lib/supabase';
import {loginStaffEntry,staffEntryDestination} from '@/lib/staff-entry.mjs';
import {assertStaffMutationOrigin,staffJsonBody,staffResponse,staffErrorResponse} from '@/lib/staff-auth-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:NextRequest){
 try{
  assertStaffMutationOrigin(request);const body=await staffJsonBody(request);
  const context=await loginStaffEntry({identityClient:createSupabaseAdminClient(),dataClient:createSupabaseAdminClient(),key:body.key});
  return staffResponse({staff:context.staff,destination:staffEntryDestination(body.destination,context.staff.staffCode)},context);
 }catch(e){return staffErrorResponse(e);}
}
