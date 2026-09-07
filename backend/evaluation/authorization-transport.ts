import { RunnerError } from '../src/model-policy.js';

export interface ResponseCapture {
  state: 'complete' | 'partial' | 'unavailable'; httpStatus: number | null; bytes: Uint8Array;
  latencyMs: number; errorCode: string | null;
}

// Evaluation-only transport: preserve bounded error/invalid-JSON bodies without changing production transport.
export async function captureResponse(request: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<ResponseCapture> {
  const controller = new AbortController();
  const chunks: Buffer[] = [];
  const start = performance.now();
  let size = 0; let httpStatus: number | null = null; let complete = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const result = (errorCode: string | null): ResponseCapture => ({
    state: complete ? 'complete' : httpStatus !== null ? 'partial' : 'unavailable', httpStatus,
    bytes: Buffer.concat(chunks), latencyMs: Math.max(0, Math.round(performance.now() - start)), errorCode,
  });
  try {
    if (timeoutMs <= 0 || timeoutMs > 90_000) return result('REQUEST_TIMEOUT');
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { stopped = true; controller.abort(); reject(new RunnerError('REQUEST_TIMEOUT')); }, timeoutMs);
    });
    return await Promise.race([deadline, (async () => {
      const response = await request(url, { ...init, redirect: 'error', signal: controller.signal });
      if (stopped) throw new RunnerError('REQUEST_TIMEOUT');
      httpStatus = response.status;
      if (!response.body) return result('INVALID_RESPONSE');
      reader = response.body.getReader();
      while (!stopped) {
        const next = await reader.read();
        if (stopped) throw new RunnerError('REQUEST_TIMEOUT');
        if (next.done) { complete = true; break; }
        const remaining = 2_000_000 - size;
        const kept = Buffer.from(next.value.subarray(0, remaining));
        chunks.push(kept); size += kept.length;
        if (next.value.byteLength > remaining) {
          stopped = true; controller.abort(); void reader.cancel().catch(() => {});
          return result('RESPONSE_TOO_LARGE');
        }
      }
      return result(response.ok ? null : response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR');
    })()]);
  } catch (error) {
    return result(error instanceof RunnerError ? error.code : error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name) ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
  } finally {
    stopped = true; clearTimeout(timer); controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}
