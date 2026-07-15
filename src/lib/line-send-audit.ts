import "server-only";

export type BotInfo = {
  userId?: string;
  basicId?: string;
  displayName?: string;
};

let botInfoPromise: Promise<BotInfo | null> | null = null;

export function getLineBotInfo(accessToken: string) {
  if (!botInfoPromise) {
    botInfoPromise = fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
      .then(async (response) => response.ok ? await response.json() as BotInfo : null)
      .catch(() => null);
  }
  return botInfoPromise;
}

export async function readLineResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 4000) };
  }
}
