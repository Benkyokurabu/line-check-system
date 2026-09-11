export function validateFeedback(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_feedback");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const sharingPreference=input.sharingPreference===undefined?'unspecified':input.sharingPreference;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id ?? "")
    || !name || name.length > 100 || !message || message.length > 2000
    || !['anonymous','named','unspecified'].includes(sharingPreference)) throw new Error("invalid_feedback");
  return { id: input.id, name, message, sharingPreference };
}
