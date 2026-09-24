import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { parseLrc, plainLines } from '../../src/lib/lrc';
import { getLyricsById, getTranslation, putAcrMapping, putMiss, putTrack, putTranslation } from './cache';
import { sessionOf } from './jobs';
import { cleanQuery, translateLines } from './llm';
import { searchTracks, toLyrics, toSong, type LrclibTrack } from './lrclib';
import { basicCleanTitle, pickByDuration, primaryArtist } from './match';
import { prefetchTranslations } from './translations';
import type { JobUpdate, PipelineParams, RecoveryResult, TranslationResult } from './types';

type RecoveryParams = Extract<PipelineParams, { kind: 'recovery' }>;
type TranslationParams = Extract<PipelineParams, { kind: 'translation' }>;

const RETRY = { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' }, timeout: '2 minutes' } as const;

/**
 * Slow, LLM-backed work that must not block the recognition request:
 *  - recovery: when the exact LRCLIB lookup missed, clean the title with the
 *    LLM, search LRCLIB and pick the closest version by duration.
 *  - translation: translate lyric lines one-to-one and cache the result.
 * Each step is retried by Workflows; the result is pushed to the user's
 * Durable Object, which forwards it to the app.
 */
export class LyricsPipeline extends WorkflowEntrypoint<Env, PipelineParams> {
  async run(event: WorkflowEvent<PipelineParams>, step: WorkflowStep) {
    const p = event.payload;
    let update: JobUpdate;
    try {
      const result = p.kind === 'recovery' ? await this.recover(p, step) : await this.translate(p, step);
      update = result
        ? { type: 'job.update', jobId: p.jobId, kind: p.kind, status: 'complete', result }
        : { type: 'job.update', jobId: p.jobId, kind: p.kind, status: 'failed', error: 'No lyrics found' };
    } catch (e) {
      update = {
        type: 'job.update',
        jobId: p.jobId,
        kind: p.kind,
        status: 'failed',
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
    await step.do('notify', async () => {
      const session = sessionOf(this.env, p.deviceId);
      await session.finishJob(update);
    });
    // The instance output lets other requests read the result without waiting on KV propagation.
    return update;
  }

  private async recover(p: RecoveryParams, step: WorkflowStep): Promise<RecoveryResult | null> {
    const { track } = p;
    const durationS = track.durationMs / 1000;

    const query = await step.do('clean-query', RETRY, () => cleanQuery(this.env.AI, track));

    const picked = await step.do('search-and-pick', RETRY, async () => {
      const searches: Parameters<typeof searchTracks>[0][] = [
        { title: query.title, artist: query.artist },
        { title: basicCleanTitle(track.title), artist: primaryArtist(track.artist) },
        { q: `${query.title} ${query.artist}` },
      ];
      const byId = new Map<number, LrclibTrack>();
      for (const s of searches) {
        for (const t of await searchTracks(s)) byId.set(t.id, t);
        const pick = pickByDuration([...byId.values()], durationS, p.excludeIds);
        if (pick?.withinTolerance) break; // good enough; skip the remaining searches
      }
      return pickByDuration([...byId.values()], durationS, p.excludeIds);
    });

    if (!picked) {
      if (track.acrId) await step.do('record-miss', () => putMiss(this.env.CACHE, track.acrId!));
      return null;
    }

    await step.do('cache-result', async () => {
      await putTrack(this.env.CACHE, picked.track);
      // Only remember the mapping when the durations agree, so a near-miss can still be improved later.
      if (track.acrId && picked.withinTolerance) await putAcrMapping(this.env.CACHE, track.acrId, picked.track.id);
    });

    // Found lyrics the fast path missed: pre-translate them like any other song.
    await step.do('prefetch-translations', () =>
      prefetchTranslations(this.env, sessionOf(this.env, p.deviceId), p.deviceId, toLyrics(picked.track), track.language)
    );

    return {
      song: { ...toSong(picked.track, track.acrId), language: track.language ?? null },
      lyrics: toLyrics(picked.track),
      versionMismatch: !picked.withinTolerance,
    };
  }

  private async translate(p: TranslationParams, step: WorkflowStep): Promise<TranslationResult | null> {
    const lines = await step.do('translate', RETRY, async () => {
      const cached = await getTranslation(this.env.CACHE, p.lrclibId, p.lang);
      if (cached) return cached;
      const entry = await getLyricsById(this.env.CACHE, p.lrclibId);
      if (!entry) return null;
      const { synced, plain } = entry.lyrics;
      // Same line order the app uses to render the player.
      const source = synced ? parseLrc(synced).map((l) => l.text) : plain ? plainLines(plain) : [];
      if (source.length === 0) return null;
      const translated = await translateLines(this.env.AI, source, p.lang);
      await putTranslation(this.env.CACHE, p.lrclibId, p.lang, translated, p.prefetch === true);
      return translated;
    });
    return lines ? { lrclibId: p.lrclibId, lang: p.lang, lines } : null;
  }
}
