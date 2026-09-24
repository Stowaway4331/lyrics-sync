import type { Song } from './types';

export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

export const CHAT_SYSTEM_PROMPT = `You are the music assistant inside Lyrics Sync, a lyrics app.
The user will either provide a song title, song lyrics, or ask trivia about music. Answer the questions appropriately.

- Song title: identify the song and artist they mean. If it is ambiguous, list the most likely matches.
- Song lyrics: the user is trying to find a song from lines they remember. The lines may be misheard or incomplete. Suggest up to 3 songs, most likely first. Never invent a song; if you are not reasonably sure, say so.
- Music trivia: answer briefly and accurately. If you are unsure, say so rather than guess.
- If a current song is provided, questions like "translate this" or "wrong version" refer to it.
- Do not reproduce full song lyrics in your replies; quote at most two lines.
- Keep replies short and conversational. Politely decline requests unrelated to music.`;

/** Runs the model in JSON mode and parses the result, retrying once with the error. */
async function runJson<T>(
  ai: Ai,
  messages: Message[],
  schema: object,
  validate: (value: unknown) => T,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<T> {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs: Message[] =
      attempt === 0
        ? messages
        : [...messages, { role: 'user', content: `Your previous answer was invalid (${lastError}). Reply again with valid JSON only.` }];
    const out = await ai.run(MODEL, {
      messages: msgs,
      response_format: { type: 'json_schema', json_schema: schema },
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 512,
    });
    try {
      const raw = typeof out === 'object' && out !== null && 'response' in out ? out.response : out;
      // In JSON mode Workers AI may hand back an already-parsed object.
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return validate(value);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`LLM returned invalid JSON: ${lastError}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Lookup recovery
// ---------------------------------------------------------------------------

export interface CleanQuery {
  title: string;
  artist: string;
}

/** Turns messy recognition metadata into the plain title/artist a lyrics site would use. */
export function cleanQuery(ai: Ai, track: Song): Promise<CleanQuery> {
  return runJson(
    ai,
    [
      {
        role: 'system',
        content:
          'You normalise music metadata for a lyrics search. Return the song title and main artist exactly as a lyrics database would list them: remove remaster/live/edit/version tags, featured artists, and track numbers. Do not translate names.',
      },
      {
        role: 'user',
        content: JSON.stringify({ title: track.title, artist: track.artist, album: track.album }),
      },
    ],
    {
      type: 'object',
      properties: { title: { type: 'string' }, artist: { type: 'string' } },
      required: ['title', 'artist'],
    },
    (v) => {
      if (!isObject(v) || typeof v.title !== 'string' || typeof v.artist !== 'string' || !v.title.trim())
        throw new Error('expected { title, artist }');
      return { title: v.title.trim(), artist: v.artist.trim() };
    }
  );
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

const TRANSLATE_CHUNK = 40;

/**
 * Translates lyric lines one-to-one. Timing never goes through the model: the
 * caller keeps timestamps and pairs them with the returned lines by index.
 */
export async function translateLines(ai: Ai, lines: string[], lang: string): Promise<string[]> {
  const out: string[] = [];
  for (let start = 0; start < lines.length; start += TRANSLATE_CHUNK) {
    const chunk = lines.slice(start, start + TRANSLATE_CHUNK);
    const numbered = chunk.map((text, i) => ({ i, text }));
    const translated = await runJson(
      ai,
      [
        {
          role: 'system',
          content: `You translate song lyrics into ${lang}, line by line. Return exactly one translation per input line, in the same order, in "translations". Keep empty lines empty. If a line is already in ${lang}, return it unchanged. Keep the meaning natural; do not add notes.`,
        },
        { role: 'user', content: JSON.stringify(numbered) },
      ],
      {
        type: 'object',
        properties: { translations: { type: 'array', items: { type: 'string' } } },
        required: ['translations'],
      },
      (v) => {
        if (!isObject(v) || !Array.isArray(v.translations)) throw new Error('expected { translations: [] }');
        if (v.translations.length !== chunk.length)
          throw new Error(`expected ${chunk.length} lines, got ${v.translations.length}`);
        return v.translations.map((t, i) => (chunk[i].trim() === '' ? '' : String(t)));
      },
      { temperature: 0.2, maxTokens: 3000 }
    );
    out.push(...translated);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatIntent = 'title' | 'lyrics' | 'trivia' | 'song_action' | 'other';

export interface ChatRoute {
  intent: ChatIntent;
  candidates: { title: string; artist: string }[];
  action: 'translate' | 'wrong_version' | null;
  language: string | null;
  /** For "lyrics": just the remembered lines, without "what's the song that goes...". */
  snippet: string | null;
}

const INTENTS: ChatIntent[] = ['title', 'lyrics', 'trivia', 'song_action', 'other'];

export function routeChat(
  ai: Ai,
  message: string,
  history: Message[],
  currentSong: Song | null
): Promise<ChatRoute> {
  const context = currentSong
    ? `Current song on screen: "${currentSong.title}" by ${currentSong.artist}.`
    : 'No song is on screen.';
  return runJson(
    ai,
    [
      {
        role: 'system',
        content: `Classify the user's latest message for a music app. ${context}
intent:
- "title": they name a song (or artist + song) they want.
- "lyrics": they quote lines they remember and want the song. Put up to 3 likely songs in candidates, most likely first. Only include songs you are reasonably sure exist. Put only the quoted lyric words in snippet.
- "trivia": a general music question.
- "song_action": about the current song. action "translate" (set language to the target language name in English, e.g. "Spanish") or "wrong_version" (the lyrics are for a different version).
- "other": anything else.
For "title", put the song they mean in candidates (up to 3 if ambiguous).
Always fill candidates for "title" and "lyrics" (an empty list only if you have no idea). Use an empty list for other intents. Use "none" for action and "" for language and snippet when they don't apply.`,
      },
      ...history.slice(-6),
      { role: 'user', content: message },
    ],
    {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: INTENTS },
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, artist: { type: 'string' } },
            required: ['title', 'artist'],
          },
        },
        action: { type: 'string', enum: ['translate', 'wrong_version', 'none'] },
        language: { type: 'string' },
        snippet: { type: 'string' },
      },
      required: ['intent', 'candidates', 'action', 'language', 'snippet'],
    },
    (v) => {
      if (!isObject(v) || !INTENTS.includes(v.intent as ChatIntent)) throw new Error('bad intent');
      const candidates = Array.isArray(v.candidates)
        ? v.candidates
            .filter(
              (c): c is { title: string; artist: string } =>
                isObject(c) && typeof c.title === 'string' && typeof c.artist === 'string' && !!c.title.trim()
            )
            .slice(0, 3)
        : [];
      const action = v.action === 'translate' || v.action === 'wrong_version' ? v.action : null;
      const language = typeof v.language === 'string' && v.language.trim() ? v.language.trim() : null;
      // Llama sometimes leaves stray quotes/commas at the edges of the snippet.
      const snippet =
        typeof v.snippet === 'string' ? v.snippet.replace(/^[s"'“”‘’,.]+|[s"'“”‘’,.]+$/g, '') || null : null;
      return { intent: v.intent as ChatIntent, candidates, action, language, snippet };
    },
    { temperature: 0 }
  );
}

/**
 * Streams the chat reply as plain text chunks. Workers AI streams SSE lines
 * of the form `data: {"response":"..."}` ending with `data: [DONE]`.
 */
export async function* streamReply(ai: Ai, messages: Message[]): AsyncGenerator<string> {
  const stream = (await ai.run(MODEL, {
    messages,
    stream: true,
    temperature: 0.6,
    max_tokens: 700,
  })) as unknown as ReadableStream<Uint8Array>;

  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data) as { response?: string };
        if (parsed.response) yield parsed.response;
      } catch {
        // Ignore keep-alives and partial frames.
      }
    }
  }
}

export type { Message };
