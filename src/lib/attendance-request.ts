export const ATTENDANCE_READ_TIMEOUT_MS = 15_000;
export const ATTENDANCE_CHECK_TIMEOUT_MS = 45_000;

// Bound the whole response, including its body. A cancelled check may still be
// running on the server, so callers must not describe a timeout as cancellation.
export async function attendanceRequest(
  url: string,
  options: RequestInit = {},
  timeoutMs = ATTENDANCE_READ_TIMEOUT_MS,
  timeoutMessage = "通信に時間がかかり、最新の情報を取得できませんでした。表示中の連絡はそのままです。時間をおいて「最新のLINEを確認して更新」を押してください。",
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const body = await response.json();
        return { response, body };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMessage));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
