import {setTimeout as delay} from 'node:timers/promises';

/** One fresh read set per request, with bounded retries for temporary failures only. */
export function materialReadRequest(request, signal, wait = (ms, signal) => delay(ms, undefined, {signal})) {
  const reads = new Map();
  return (path, init = {}) => {
    const method = init.method || 'GET';
    if (method !== 'GET' && !(method === 'POST' && path.endsWith('/query'))) throw Error('Material source reads cannot mutate Notion');
    const key = JSON.stringify([path, method, init.body || null]);
    if (!reads.has(key)) reads.set(key, (async () => {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try { return await request(path, {...init, cache:'no-store', signal:AbortSignal.any([signal, AbortSignal.timeout(8000)])}); }
        catch (error) {
          const temporary = error.status === 429 || error.status >= 500 || ['TypeError','TimeoutError','AbortError'].includes(error.name);
          if (signal.aborted || !temporary || attempt >= 2) throw error;
          const pause = Math.max(1000 * (attempt + 1), Number(error.retryAfterMs) || 0);
          if (!Number.isFinite(pause) || pause > 2147483647) throw error;
          await wait(pause, signal);
        }
      }
    })());
    return reads.get(key);
  };
}
