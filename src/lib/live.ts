import { getJob, type JobUpdate } from './api';
import { WS_URL } from './config';
import { getDeviceId } from './device-id';

type Listener = (update: JobUpdate) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retryMs = 1000;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** Opens (and keeps open) the WebSocket to this user's Durable Object. */
export async function startLive() {
  if (started) return;
  started = true;
  const deviceId = await getDeviceId();

  const connect = () => {
    const ws = new WebSocket(`${WS_URL}/ws?deviceId=${encodeURIComponent(deviceId)}`);
    socket = ws;
    ws.onopen = () => {
      retryMs = 1000;
      pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      try {
        const update = JSON.parse(e.data) as JobUpdate;
        if (update.type === 'job.update') listeners.forEach((l) => l(update));
      } catch {}
    };
    ws.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      socket = null;
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    };
    ws.onerror = () => ws.close();
  };
  connect();
}

/**
 * Resolves when a background job finishes. Listens on the WebSocket and also
 * polls every few seconds, so a dropped socket never leaves the UI waiting.
 */
export function awaitJob(jobId: string, timeoutMs = 120_000): Promise<JobUpdate> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (update: JobUpdate) => {
      if (finished) return;
      finished = true;
      listeners.delete(onUpdate);
      clearInterval(poll);
      clearTimeout(timeout);
      resolve(update);
    };
    const onUpdate: Listener = (u) => u.jobId === jobId && finish(u);
    listeners.add(onUpdate);

    const poll = setInterval(async () => {
      try {
        const job = await getJob(jobId);
        if (job.status !== 'running')
          finish({
            type: 'job.update',
            jobId,
            kind: job.kind,
            status: job.status,
            result: job.result ?? undefined,
            error: job.error ?? undefined,
          });
      } catch {}
    }, socket?.readyState === WebSocket.OPEN ? 5000 : 2500);

    const timeout = setTimeout(
      () => finish({ type: 'job.update', jobId, kind: 'recovery', status: 'failed', error: 'Timed out' }),
      timeoutMs
    );
  });
}
