import { NextRequest } from 'next/server';
import { StaffAuthError } from '@/lib/staff-auth-core.mjs';
import { UUID, validateCodexInput } from '@/lib/codex-panel-core.mjs';
import { assertStaffMutationOrigin, staffContext, staffErrorResponse, staffJsonBody, staffResponse } from '@/lib/staff-auth-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: NextRequest, mutation: boolean) {
  let context;
  try {
    if (mutation) assertStaffMutationOrigin(request);
    context = await staffContext(request);
    let body: Record<string, unknown> = {};
    let action = 'status';
    if (mutation) {
      body = await staffJsonBody(request);
      action = String(body.action);
      if (action === 'send') body = validateCodexInput(body);
      else if (!['cancel', 'approve'].includes(action) || !UUID.test(String(body.id)) || !UUID.test(String(body.conversationId))) throw new StaffAuthError('invalid_request', 400);
    } else if (request.nextUrl.searchParams.has('conversationId')) {
      const id = request.nextUrl.searchParams.get('conversationId')!;
      if (!UUID.test(id)) throw new StaffAuthError('invalid_request', 400);
      body = { conversationId: id }; action = 'list';
    }
    const { data, error } = await context.dataClient.rpc('bentan_codex_action', {
      p_auth_user_id: context.identity.authUserId, p_auth_session_id: context.identity.authSessionId, p_action: action, p_body: body,
    });
    if (error) {
      if (error.message === 'staff_permission_denied') throw new StaffAuthError('permission_denied', 403);
      const messages: Record<string, string> = { request_busy: 'この会話の処理が終わるまでお待ちください。', request_limit: '送信回数が多いため、しばらく待ってください。', request_conflict: '受付状況が変わりました。表示を更新してください。' };
      if (messages[error.message]) return staffResponse({ error: messages[error.message] }, context, 409);
      throw new StaffAuthError(error.message === 'invalid_request' ? 'invalid_request' : 'auth_unavailable', error.message === 'invalid_request' ? 400 : 503);
    }
    return staffResponse(data, context);
  } catch (error) {
    return staffErrorResponse(error instanceof Error && error.message === 'invalid_request' ? new StaffAuthError('invalid_request',400) : error, context);
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
