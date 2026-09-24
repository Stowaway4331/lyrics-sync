import { DurableObject } from 'cloudflare:workers';
import type { JobKind, JobStatus, JobUpdate, Song, SongCard } from './types';

export interface StoredMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  cards: SongCard[];
  createdAt: number;
}

export interface ArchivedThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: { role: 'user' | 'assistant'; content: string; cards?: SongCard[] }[];
}

export interface HistoryEntry extends Song {
  id: number;
  source: 'listen' | 'chat';
  foundAt: number;
}

export interface Prefs {
  targetLanguage: string | null;
  /** Languages this user picked before, most relevant first. */
  languages: string[];
  calibrationMs: number;
}

export interface JobRecord {
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  result: JobUpdate['result'] | null;
  error: string | null;
}

const HISTORY_LIMIT = 200;
const MESSAGE_LIMIT = 200;

/**
 * One instance per device ID. Holds that user's song history, chat memory,
 * preferences and background jobs in SQLite, and pushes job updates to the
 * app over a hibernatable WebSocket.
 */
export class UserSession extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lrclib_id INTEGER, acr_id TEXT, title TEXT NOT NULL, artist TEXT NOT NULL,
        album TEXT NOT NULL, duration_ms INTEGER NOT NULL, source TEXT NOT NULL, found_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL, content TEXT NOT NULL, cards_json TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
        result_json TEXT, error TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_events (kind TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS archived_threads (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, archived_at INTEGER NOT NULL, messages_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS language_usage (
        lang TEXT PRIMARY KEY, count INTEGER NOT NULL, last_used INTEGER NOT NULL
      );
    `);
  }

  // --- Rate limiting --------------------------------------------------------

  /** Records one event and returns false if the per-window limit is already reached. */
  checkRate(kind: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    this.sql.exec('DELETE FROM rate_events WHERE at < ?', now - windowMs);
    const count = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM rate_events WHERE kind = ?', kind).one().n;
    if (count >= limit) return false;
    this.sql.exec('INSERT INTO rate_events (kind, at) VALUES (?, ?)', kind, now);
    return true;
  }

  // --- History --------------------------------------------------------------

  addSong(song: Song, source: 'listen' | 'chat'): void {
    // Re-finding the same song moves it to the top instead of duplicating it.
    if (song.lrclibId != null) this.sql.exec('DELETE FROM songs WHERE lrclib_id = ?', song.lrclibId);
    else if (song.acrId) this.sql.exec('DELETE FROM songs WHERE acr_id = ?', song.acrId);
    this.sql.exec(
      'INSERT INTO songs (lrclib_id, acr_id, title, artist, album, duration_ms, source, found_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      song.lrclibId,
      song.acrId,
      song.title,
      song.artist,
      song.album,
      song.durationMs,
      source,
      Date.now()
    );
    this.sql.exec(
      'DELETE FROM songs WHERE id NOT IN (SELECT id FROM songs ORDER BY found_at DESC LIMIT ?)',
      HISTORY_LIMIT
    );
  }

  /** Fills in the LRCLIB id once lookup recovery finds lyrics for a recognized song. */
  resolveSong(acrId: string, lrclibId: number): void {
    this.sql.exec('UPDATE songs SET lrclib_id = ? WHERE acr_id = ? AND lrclib_id IS NULL', lrclibId, acrId);
  }

  listSongs(): HistoryEntry[] {
    return this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM songs ORDER BY found_at DESC')
      .toArray()
      .map((r) => ({
        id: r.id as number,
        lrclibId: (r.lrclib_id as number | null) ?? null,
        acrId: (r.acr_id as string | null) ?? null,
        title: r.title as string,
        artist: r.artist as string,
        album: r.album as string,
        durationMs: r.duration_ms as number,
        source: r.source as 'listen' | 'chat',
        foundAt: r.found_at as number,
      }));
  }

  // --- Chat memory ----------------------------------------------------------

  addMessage(role: 'user' | 'assistant', content: string, cards: SongCard[] = []): void {
    this.sql.exec(
      'INSERT INTO messages (role, content, cards_json, created_at) VALUES (?, ?, ?, ?)',
      role,
      content,
      cards.length ? JSON.stringify(cards) : null,
      Date.now()
    );
    this.sql.exec(
      'DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)',
      MESSAGE_LIMIT
    );
  }

  listMessages(limit = MESSAGE_LIMIT): StoredMessage[] {
    return this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM messages ORDER BY id DESC LIMIT ?', limit)
      .toArray()
      .reverse()
      .map((r) => ({
        id: r.id as number,
        role: r.role as 'user' | 'assistant',
        content: r.content as string,
        cards: r.cards_json ? (JSON.parse(r.cards_json as string) as SongCard[]) : [],
        createdAt: r.created_at as number,
      }));
  }

  /** Stores a chat thread the app archived (it deletes its own copy once this succeeds). */
  archiveThread(thread: ArchivedThread): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO archived_threads (id, title, created_at, updated_at, archived_at, messages_json) VALUES (?, ?, ?, ?, ?, ?)',
      thread.id,
      thread.title,
      thread.createdAt,
      thread.updatedAt,
      Date.now(),
      JSON.stringify(thread.messages)
    );
  }

  /** Archived chats, newest first (without their messages). */
  listArchived(): { id: string; title: string; messageCount: number; archivedAt: number }[] {
    return this.sql
      .exec<{ id: string; title: string; archived_at: number; n: number }>(
        'SELECT id, title, archived_at, json_array_length(messages_json) AS n FROM archived_threads ORDER BY archived_at DESC'
      )
      .toArray()
      .map((r) => ({ id: r.id, title: r.title, messageCount: r.n, archivedAt: r.archived_at }));
  }

  clearAll(): void {
    this.sql.exec('DELETE FROM songs');
    this.sql.exec('DELETE FROM messages');
  }

  // --- Preferences ----------------------------------------------------------

  getPrefs(): Prefs {
    const rows = this.sql.exec<{ key: string; value: string }>('SELECT key, value FROM prefs').toArray();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      targetLanguage: map.get('target_language') ?? null,
      languages: this.rankedLanguages(),
      calibrationMs: Number(map.get('calibration_ms') ?? 0),
    };
  }

  /** Counts an explicit language choice (picker or chat), not automatic translations. */
  recordLanguage(lang: string): void {
    this.sql.exec(
      'INSERT INTO language_usage (lang, count, last_used) VALUES (?, 1, ?) ON CONFLICT(lang) DO UPDATE SET count = count + 1, last_used = excluded.last_used',
      lang,
      Date.now()
    );
  }

  /**
   * Languages ranked by relevance: how often each was picked, discounted by how
   * long ago it was last used (a pick loses half its weight after two weeks).
   */
  rankedLanguages(): string[] {
    const now = Date.now();
    return this.sql
      .exec<{ lang: string; count: number; last_used: number }>('SELECT lang, count, last_used FROM language_usage')
      .toArray()
      .map((r) => ({ lang: r.lang, score: r.count / (1 + (now - r.last_used) / (14 * 24 * 3600_000)) }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.lang);
  }

  setPrefs(prefs: Partial<Omit<Prefs, 'languages'>>): Prefs {
    const upsert = (key: string, value: string) =>
      this.sql.exec('INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
    if (prefs.targetLanguage !== undefined) {
      if (prefs.targetLanguage === null) this.sql.exec("DELETE FROM prefs WHERE key = 'target_language'");
      else upsert('target_language', prefs.targetLanguage);
    }
    if (prefs.calibrationMs !== undefined) upsert('calibration_ms', String(Math.round(prefs.calibrationMs)));
    return this.getPrefs();
  }

  // --- Background jobs + push -------------------------------------------------

  startJob(jobId: string, kind: JobKind): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO jobs (job_id, kind, status, updated_at) VALUES (?, ?, ?, ?)',
      jobId,
      kind,
      'running',
      Date.now()
    );
    this.sql.exec('DELETE FROM jobs WHERE updated_at < ?', Date.now() - 7 * 24 * 3600_000);
  }

  getJob(jobId: string): JobRecord | null {
    const row = this.sql
      .exec<Record<string, SqlStorageValue>>('SELECT * FROM jobs WHERE job_id = ?', jobId)
      .toArray()[0];
    if (!row) return null;
    return {
      jobId,
      kind: row.kind as JobKind,
      status: row.status as JobStatus,
      result: row.result_json ? JSON.parse(row.result_json as string) : null,
      error: (row.error as string | null) ?? null,
    };
  }

  /** Called by the Workflow when a job finishes; stores the result and pushes it to open sockets. */
  finishJob(update: JobUpdate): void {
    this.sql.exec(
      'UPDATE jobs SET status = ?, result_json = ?, error = ?, updated_at = ? WHERE job_id = ?',
      update.status,
      update.result ? JSON.stringify(update.result) : null,
      update.error ?? null,
      Date.now(),
      update.jobId
    );
    if (update.kind === 'recovery' && update.status === 'complete' && update.result && 'song' in update.result) {
      const { song } = update.result;
      if (song.acrId && song.lrclibId != null) this.resolveSong(song.acrId, song.lrclibId);
    }
    const payload = JSON.stringify(update);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Socket already closing; the app falls back to polling.
      }
    }
  }

  // --- WebSocket (hibernation API) -------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') ws.send('pong');
  }

  webSocketClose(ws: WebSocket, code: number): void {
    ws.close(code, 'closing');
  }
}
