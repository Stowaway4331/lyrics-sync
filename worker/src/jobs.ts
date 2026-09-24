import type { PipelineParams } from './types';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Per-device limits, per hour. `prefetch` is separate so silent pre-translation never blocks what the user asks for. */
export const LIMITS = {
  recognize: { limit: 30, windowMs: 3600_000 },
  chat: { limit: 60, windowMs: 3600_000 },
  jobs: { limit: 30, windowMs: 3600_000 },
  prefetch: { limit: 60, windowMs: 3600_000 },
};

export const sessionOf = (env: Env, deviceId: string) => env.USER_SESSION.get(env.USER_SESSION.idFromName(deviceId));
export type Session = ReturnType<typeof sessionOf>;

export async function limit(session: Session, kind: keyof typeof LIMITS) {
  const { limit: n, windowMs } = LIMITS[kind];
  if (!(await session.checkRate(kind, n, windowMs))) throw new HttpError(429, 'Too many requests, try again later');
}

export async function startJob(env: Env, session: Session, params: PipelineParams): Promise<string> {
  await session.startJob(params.jobId, params.kind);
  await env.PIPELINE.create({ id: params.jobId, params });
  return params.jobId;
}

/** Status of a Workflow instance, or null if it doesn't exist (or has aged out). */
export async function instanceStatus(env: Env, id: string): Promise<InstanceStatus | null> {
  try {
    return await (await env.PIPELINE.get(id)).status();
  } catch {
    return null;
  }
}

export const ACTIVE: InstanceStatus['status'][] = ['queued', 'running', 'waiting', 'paused', 'waitingForPause'];
