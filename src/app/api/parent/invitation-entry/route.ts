import {NextRequest} from 'next/server';
import {assertStaffMutationOrigin,staffJsonBody} from '@/lib/staff-auth-http';
import {parentResponse,parentFailure} from '@/lib/parent-interview-http';
import {invitationAccess,invitationCookie,invitationCookieOptions} from '@/lib/interview-invitation-access';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
 try{
  assertStaffMutationOrigin(request);const body=await staffJsonBody(request,1024);
  const access=await invitationAccess(body.token);
  const response=parentResponse({invitationId:access.id});
  response.cookies.set(invitationCookie,String(body.token),invitationCookieOptions);
  return response;
 }catch(e){return parentFailure(e);}
}
export async function DELETE(request:NextRequest){
 try{assertStaffMutationOrigin(request);const response=parentResponse({signedOut:true});response.cookies.set(invitationCookie,'',{...invitationCookieOptions,maxAge:0});return response;}catch(e){return parentFailure(e);}
}
