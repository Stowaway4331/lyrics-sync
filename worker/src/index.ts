import { identify, MAX_SAMPLE_BYTES, offsetAtStop, toSong as acrToSong } from './acrcloud';
import { getAcrMapping, getLyricsById, hasMiss, putAcrMapping, putTrack } from './cache';
import { HttpError, instanceStatus, limit, sessionOf, startJob } from './jobs';
import { CHAT_SYSTEM_PROMPT, routeChat, streamReply, type ChatRoute, type Message } from './llm';
import { getTrack, LrclibUnavailable, searchTracks, toLyrics, type LrclibTrack } from './lrclib';
import {
  basicCleanTitle,
  pickByDuration,
  primaryArtist,
  snippetScore,
  SNIPPET_MATCH_THRESHOLD,
  titleMatches,
} from './match';
import { discardPrefetched, ensureTranslation, prefetchTranslations } from './translations';
import type { JobUpdate, Lyrics, Song, SongCard } from './types';

export { LyricsPipeline } from './pipeline';
export { UserSession } from './session';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Clip-Ms',
  'Access-Control-Max-Age': '86400',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

function deviceIdOf(req: Request, url: URL): string {
  const id = req.headers.get('X-Device-Id') ?? url.searchParams.get('deviceId') ?? '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new HttpError(400, 'Missing or invalid device id');
  return id;
}

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

// ---------------------------------------------------------------------------
// POST /recognize — body is the raw audio clip.
// ---------------------------------------------------------------------------

type LyricsStatus = 'found' | 'recovering' | 'none';

async function recognize(req: Request, env: Env, ctx: ExecutionContext, deviceId: string) {
  const session = sessionOf(env, deviceId);
  await limit(session, 'recognize');

  // Real clip length (the user can submit early); it feeds the sync offset, so keep it accurate.
  const clipMs = Math.min(20_000, Math.max(500, Number(req.headers.get('X-Clip-Ms')) || 10_000));
  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0) throw new HttpError(400, 'Empty audio');
  if (audio.byteLength >= MAX_SAMPLE_BYTES) throw new HttpError(413, 'Audio clip too large (max 5 MB)');

  const result = await identify(audio, req.headers.get('Content-Type') ?? 'application/octet-stream', {
    host: env.ACR_HOST,
    accessKey: env.ACR_ACCESS_KEY,
    accessSecret: env.ACR_ACCESS_SECRET,
  });
  if (result.kind === 'no_match') return json({ match: false });
  if (result.kind === 'error') {
    console.error('ACRCloud error', result.code, result.message);
    throw new HttpError(502, 'Song recognition is unavailable right now');
  }

  const song = acrToSong(result.music);
  const offsetAtStopMs = offsetAtStop(result.music, clipMs);

  let lyrics: Lyrics | null = null;
  let status: LyricsStatus = 'none';
  let jobId: string | null = null;

  try {
    const found = await findLyricsFast(env, song);
    if (found) {
      lyrics = found;
      song.lrclibId = found.lrclibId;
      status = 'found';
    }
  } catch (e) {
    // LRCLIB is down or slow: let the Workflow retry in the background.
    if (!(e instanceof LrclibUnavailable) && !(e instanceof DOMException)) throw e;
  }

  if (!lyrics && song.acrId && !(await hasMiss(env.CACHE, song.acrId))) {
    jobId = await startJob(env, session, {
      kind: 'recovery',
      deviceId,
      jobId: crypto.randomUUID(),
      track: song,
      excludeIds: [],
    });
    status = 'recovering';
  }

  ctx.waitUntil(session.addSong(song, 'listen'));
  if (lyrics) ctx.waitUntil(prefetchTranslations(env, session, deviceId, lyrics, song.language));
  return json({ match: true, song, offsetAtStopMs, clipMs, lyrics, lyricsStatus: status, jobId, versionMismatch: false });
}

/** Cache → exact LRCLIB lookup → deterministic search. No LLM on this path. */
async function findLyricsFast(env: Env, song: Song): Promise<Lyrics | null> {
  if (song.acrId) {
    const mapped = await getAcrMapping(env.CACHE, song.acrId);
    if (mapped != null) {
      const cached = await getLyricsById(env.CACHE, mapped);
      if (cached) return cached.lyrics;
    }
  }

  const durationS = song.durationMs / 1000;
  const remember = async (track: LrclibTrack) => {
    await putTrack(env.CACHE, track);
    if (song.acrId) await putAcrMapping(env.CACHE, song.acrId, track.id);
    return toLyrics(track);
  };

  const exact = await getTrack({
    title: song.title,
    artist: primaryArtist(song.artist),
    album: song.album,
    durationS,
  });
  if (exact && (exact.syncedLyrics || exact.plainLyrics || exact.instrumental)) return remember(exact);

  const candidates = await searchTracks({ title: basicCleanTitle(song.title), artist: primaryArtist(song.artist) });
  const pick = pickByDuration(candidates, durationS);
  return pick?.withinTolerance ? remember(pick.track) : null;
}

// ---------------------------------------------------------------------------
// POST /chat — Server-Sent Events: status, action, cards, token..., done.
// ---------------------------------------------------------------------------

interface ChatBody {
  message?: string;
  currentSong?: Song | null;
  /** Recent messages of the thread, oldest first. Threads live on the device, not here. */
  history?: { role?: string; content?: string }[];
}

const HISTORY_LIMIT = 20;
const HISTORY_MESSAGE_CHARS = 4000;

function cleanHistory(history: ChatBody['history']): Message[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content!.slice(0, HISTORY_MESSAGE_CHARS) }));
}

async function verifyCandidates(
  env: Env,
  ctx: ExecutionContext,
  candidates: ChatRoute['candidates'],
  snippet: string | null
): Promise<SongCard[]> {
  const results = await Promise.all(
    candidates.map(async (c): Promise<SongCard | null> => {
      try {
        // LRCLIB search is fuzzy and can return unrelated songs, so only accept title matches.
        const usable = (tracks: LrclibTrack[]) =>
          tracks.filter((t) => (t.syncedLyrics || t.plainLyrics) && titleMatches(t.trackName, c.title));
        let matches = usable(await searchTracks({ title: c.title, artist: c.artist }));
        if (matches.length === 0) matches = usable(await searchTracks({ q: `${c.title} ${c.artist}` }));
        const track = matches.find((t) => t.syncedLyrics) ?? matches[0];
        if (!track) return null;
        ctx.waitUntil(putTrack(env.CACHE, track));

        let label: SongCard['label'] = null;
        if (snippet) {
          const text = track.plainLyrics ?? track.syncedLyrics ?? '';
          label = snippetScore(snippet, text) >= SNIPPET_MATCH_THRESHOLD ? 'match' : 'possible';
        }
        return {
          lrclibId: track.id,
          acrId: null,
          title: track.trackName,
          artist: track.artistName,
          album: track.albumName,
          durationMs: Math.round(track.duration * 1000),
          label,
        };
      } catch {
        return null;
      }
    })
  );

  const seen = new Set<number>();
  const cards = results.filter((c): c is SongCard => !!c && !seen.has(c.lrclibId!) && !!seen.add(c.lrclibId!));
  // Songs whose real lyrics contain the snippet go first.
  return cards.sort((a, b) => Number(b.label === 'match') - Number(a.label === 'match'));
}

async function chat(req: Request, env: Env, ctx: ExecutionContext, deviceId: string) {
  const session = sessionOf(env, deviceId);
  const body = await readJson<ChatBody>(req);
  const message = (body.message ?? '').trim();
  if (!message || message.length > 1000) throw new HttpError(400, 'Message must be 1–1000 characters');
  await limit(session, 'chat');
  const currentSong = body.currentSong ?? null;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event: Record<string, unknown>) => writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  const work = (async () => {
    let reply = '';
    let cards: SongCard[] = [];
    try {
      const history = cleanHistory(body.history);

      await send({ type: 'status', text: 'Thinking…' });
      const route = await routeChat(env.AI, message, history, currentSong).catch((e): ChatRoute => {
        console.error('chat routing failed', e);
        return { intent: 'other', candidates: [], action: null, language: null, snippet: null };
      });
      console.log('chat route', JSON.stringify(route));

      const notes: string[] = [];
      if ((route.intent === 'title' || route.intent === 'lyrics') && route.candidates.length > 0) {
        await send({ type: 'status', text: 'Checking the lyrics database…' });
        cards = await verifyCandidates(env, ctx, route.candidates, route.intent === 'lyrics' ? (route.snippet ?? message) : null);
        notes.push(
          cards.length
            ? `These songs were verified in the lyrics database and are shown to the user as cards they can tap: ${cards
                .map((c) => `"${c.title}" by ${c.artist}${c.label === 'match' ? ' (the quoted lyrics appear in this song)' : c.label === 'possible' ? ' (song exists, but the quoted lyrics were not found in it)' : ''}`)
                .join('; ')}. Only mention these songs as results.`
            : 'None of the songs you would suggest could be found in the lyrics database. Tell the user you could not find it and suggest adding more lines, or using the Listen tab while the song plays.'
        );
      } else if (route.intent === 'song_action') {
        if (!currentSong?.lrclibId) {
          notes.push('No song with lyrics is open. Ask the user to open a song first, then ask again.');
        } else if (route.action === 'translate') {
          const lang = route.language ?? (await session.getPrefs()).targetLanguage;
          if (!lang) {
            notes.push('The user wants a translation but did not say which language. Ask which language.');
          } else {
            await session.setPrefs({ targetLanguage: lang });
            await session.recordLanguage(lang);
            const state = await ensureTranslation(env, session, deviceId, currentSong.lrclibId, lang);
            await send(
              state.status === 'complete'
                ? { type: 'action', action: 'translate', lang, lines: state.lines }
                : { type: 'action', action: 'translate', lang, jobId: state.jobId }
            );
            notes.push(`A ${lang} translation of the current song is being shown under the lyrics. Confirm briefly.`);
          }
        } else if (route.action === 'wrong_version') {
          await limit(session, 'jobs');
          const jobId = await startJob(env, session, {
            kind: 'recovery',
            deviceId,
            jobId: crypto.randomUUID(),
            track: currentSong,
            excludeIds: [currentSong.lrclibId],
          });
          ctx.waitUntil(discardPrefetched(env, session, currentSong.lrclibId));
          await send({ type: 'action', action: 'wrong_version', jobId });
          notes.push('The app is now searching for a different version of the lyrics. Confirm briefly.');
        }
      }

      const system = [
        CHAT_SYSTEM_PROMPT,
        currentSong ? `Current song on screen: "${currentSong.title}" by ${currentSong.artist}.` : '',
        notes.length ? `App context for this reply: ${notes.join(' ')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      if (cards.length) await send({ type: 'cards', cards });
      for await (const token of streamReply(env.AI, [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: message },
      ])) {
        reply += token;
        await send({ type: 'token', text: token });
      }
    } catch (e) {
      console.error('chat failed', e);
      const text = e instanceof HttpError ? e.message : 'Something went wrong. Please try again.';
      if (!reply) reply = text;
      await send({ type: 'error', message: text });
    } finally {
      await send({ type: 'done' });
      await writer.close();
    }
  })();
  ctx.waitUntil(work);

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const route = `${req.method} ${path}`;

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (route === 'GET /') return json({ ok: true, service: 'lyrics-sync-api' });

  const deviceId = deviceIdOf(req, url);
  const session = sessionOf(env, deviceId);

  if (route === 'POST /recognize') return recognize(req, env, ctx, deviceId);
  if (route === 'POST /chat') return chat(req, env, ctx, deviceId);

  if (route === 'GET /ws') {
    // The Durable Object accepts the socket and pushes job updates on it.
    return session.fetch(req);
  }

  const lyricsMatch = /^\/lyrics\/(\d+)$/.exec(path);
  if (req.method === 'GET' && lyricsMatch) {
    const entry = await getLyricsById(env.CACHE, Number(lyricsMatch[1]));
    if (!entry) throw new HttpError(404, 'Lyrics not found');
    if (url.searchParams.get('save') === 'chat') ctx.waitUntil(session.addSong(entry.song, 'chat'));
    ctx.waitUntil(prefetchTranslations(env, session, deviceId, entry.lyrics, null));
    return json(entry);
  }

  if (route === 'POST /translate') {
    const { lrclibId, lang } = await readJson<{ lrclibId?: number; lang?: string }>(req);
    if (!Number.isInteger(lrclibId) || !lang?.trim()) throw new HttpError(400, 'lrclibId and lang are required');
    await session.setPrefs({ targetLanguage: lang.trim() });
    return json(await ensureTranslation(env, session, deviceId, lrclibId!, lang.trim()));
  }

  if (route === 'POST /recover') {
    // "Wrong version" from the player: look for another version of the lyrics.
    const { song, excludeIds } = await readJson<{ song?: Song; excludeIds?: number[] }>(req);
    if (!song?.title || !song.durationMs) throw new HttpError(400, 'song is required');
    await limit(session, 'jobs');
    const jobId = await startJob(env, session, {
      kind: 'recovery',
      deviceId,
      jobId: crypto.randomUUID(),
      track: song,
      excludeIds: (excludeIds ?? []).filter(Number.isInteger),
    });
    for (const id of (excludeIds ?? []).filter(Number.isInteger)) ctx.waitUntil(discardPrefetched(env, session, id));
    return json({ status: 'running', jobId });
  }

  const jobMatch = /^\/jobs\/([\w-]+)$/.exec(path);
  if (req.method === 'GET' && jobMatch) {
    const jobId = jobMatch[1];
    const job = await session.getJob(jobId);
    if (!job) throw new HttpError(404, 'Job not found');
    if (job.status !== 'running') return json(job);
    // Only the device that started a Workflow gets its push; anyone else sharing the
    // run (same song and language) picks up the result from the instance here.
    const instance = await instanceStatus(env, jobId);
    const output = instance?.output as JobUpdate | undefined;
    if (instance?.status === 'complete' && output) {
      await session.finishJob({ ...output, jobId });
      return json(await session.getJob(jobId));
    }
    if (instance?.status === 'errored' || instance?.status === 'terminated') {
      await session.finishJob({ type: 'job.update', jobId, kind: job.kind, status: 'failed', error: 'Job failed' });
      return json(await session.getJob(jobId));
    }
    return json(job);
  }

  if (route === 'GET /history') return json({ songs: await session.listSongs() });
  if (route === 'DELETE /history') {
    await session.clearAll();
    return json({ ok: true });
  }
  // Chats used to be stored here; the app imports this once into its on-device threads.
  if (route === 'GET /chat/history') return json({ messages: await session.listMessages() });
  if (route === 'GET /prefs') return json(await session.getPrefs());
  if (route === 'PUT /prefs') {
    const body = await readJson<{ targetLanguage?: string | null; calibrationMs?: number }>(req);
    // The app sends targetLanguage only when the user picks one, so this is an explicit choice.
    const picked = body.targetLanguage?.trim();
    if (picked) await session.recordLanguage(picked);
    return json(
      await session.setPrefs({
        ...(body.targetLanguage !== undefined ? { targetLanguage: body.targetLanguage?.trim() || null } : {}),
        ...(Number.isFinite(body.calibrationMs) ? { calibrationMs: body.calibrationMs } : {}),
      })
    );
  }

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('Unhandled error', e);
      return json({ error: 'Internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
