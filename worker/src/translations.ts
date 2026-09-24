import { LANGUAGES } from '../../src/lib/languages';
import { getTranslationEntry, putTranslation } from './cache';
import { ACTIVE, instanceStatus, limit, LIMITS, startJob, type Session } from './jobs';
import { looksEnglish } from './match';
import type { JobUpdate, Lyrics } from './types';

export type TranslationState = { status: 'complete'; lines: string[] } | { status: 'running'; jobId: string };

/** Fixed Workflow instance id for one (lyrics version, language). */
export const translationJobId = (lrclibId: number, lang: string) =>
  `tr-${lrclibId}-${lang.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 90);

/**
 * Returns a cached translation or the job producing it. Each (song, language)
 * has one fixed Workflow instance id: KV caches misses for ~60 s, so a repeat
 * request right after a translation finished would otherwise start a second,
 * identical LLM job. Workflow instances are strongly consistent.
 */
export async function ensureTranslation(
  env: Env,
  session: Session,
  deviceId: string,
  lrclibId: number,
  lang: string,
  opts: { prefetch?: boolean } = {}
): Promise<TranslationState> {
  const cached = await getTranslationEntry(env.CACHE, lrclibId, lang);
  if (cached) {
    // Someone asked for a pre-translation: it is no longer "just prefetched", so keep it on discard.
    if (!opts.prefetch && cached.prefetched) await putTranslation(env.CACHE, lrclibId, lang, cached.lines, false);
    return { status: 'complete', lines: cached.lines };
  }

  const baseId = translationJobId(lrclibId, lang);
  const existing = await instanceStatus(env, baseId);
  const output = existing?.output as JobUpdate | undefined;
  if (existing?.status === 'complete' && output?.result && 'lines' in output.result)
    return { status: 'complete', lines: output.result.lines };
  if (existing && ACTIVE.includes(existing.status)) {
    await session.startJob(baseId, 'translation');
    return { status: 'running', jobId: baseId };
  }

  if (!opts.prefetch) await limit(session, 'jobs');
  // A previous run for this id failed: start a fresh instance instead of reusing the id.
  const jobId = existing ? `${baseId}-${Date.now()}` : baseId;
  try {
    await startJob(env, session, { kind: 'translation', deviceId, jobId, lrclibId, lang, prefetch: opts.prefetch });
  } catch (e) {
    if (existing) throw e;
    // Another request created the same instance a moment ago: wait on that one.
    await session.startJob(baseId, 'translation');
  }
  return { status: 'running', jobId };
}

const PREFETCH_COUNT = 3;

/**
 * Languages to pre-translate a song into: the user's own languages first (most
 * relevant first), topped up with the most used languages, skipping the song's
 * own language.
 */
export function prefetchTargets(userLanguages: string[], songLanguage: string | null): string[] {
  const source = songLanguage?.toLowerCase() ?? null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lang of [...userLanguages, ...LANGUAGES]) {
    const key = lang.toLowerCase();
    if (seen.has(key) || key === source) continue;
    seen.add(key);
    out.push(lang);
    if (out.length === PREFETCH_COUNT) break;
  }
  return out;
}

/**
 * Silently starts translations of a song into the user's top languages, so a
 * later pick is instant. Never throws; uses its own rate limit.
 */
export async function prefetchTranslations(
  env: Env,
  session: Session,
  deviceId: string,
  lyrics: Lyrics,
  songLanguage: string | null | undefined
): Promise<void> {
  try {
    if (lyrics.instrumental || (!lyrics.synced && !lyrics.plain)) return;
    const { limit: n, windowMs } = LIMITS.prefetch;
    if (!(await session.checkRate('prefetch', n, windowMs))) return;
    const source = songLanguage ?? (looksEnglish(lyrics.plain ?? lyrics.synced ?? '') ? 'English' : null);
    const { languages } = await session.getPrefs();
    const targets = prefetchTargets(languages, source);
    await Promise.all(
      targets.map((lang) =>
        ensureTranslation(env, session, deviceId, lyrics.lrclibId, lang, { prefetch: true }).catch((e) =>
          console.error('prefetch failed', lyrics.lrclibId, lang, e)
        )
      )
    );
  } catch (e) {
    console.error('prefetch failed', e);
  }
}
