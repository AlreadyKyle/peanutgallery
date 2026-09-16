// Sleep that returns early when the signal aborts, so shutdown never waits out a tick.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Runs fn up to `tries` times, waiting delayMs before the second attempt and twice as long before
// each one after; onError hears every failure, and the last one is rethrown.
export async function retry<T>(fn: () => Promise<T>, tries: number, delayMs: number, onError?: (error: unknown, attempt: number) => void): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      onError?.(error, attempt);
      if (attempt < tries) await sleep(delayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
