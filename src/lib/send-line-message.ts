export type LineSendContext =
  | "dashboard_contact_search"
  | "dashboard_conversation"
  | "student_roster";

export async function sendLineMessage(input: {
  lineUserId: string;
  text: string;
  sentBy?: string | null;
  context: LineSendContext;
}) {
  return fetch("/api/line/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      line_user_id: input.lineUserId,
      text: input.text,
      sent_by: input.sentBy?.trim() || null,
      send_context: input.context,
    }),
  });
}
