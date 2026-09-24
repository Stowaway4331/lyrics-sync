/** A song as the app sees it. `lrclibId` is null when no lyrics were found yet. */
export interface Song {
  lrclibId: number | null;
  acrId: string | null;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
}

export interface Lyrics {
  lrclibId: number;
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
  durationMs: number;
}

/** A song suggested in chat, after it was verified against LRCLIB. */
export interface SongCard extends Song {
  /** For lyric search: "match" = snippet found in the real lyrics, "possible" = song exists only. */
  label: 'match' | 'possible' | null;
}

export type JobKind = 'recovery' | 'translation';
export type JobStatus = 'running' | 'complete' | 'failed';

export interface RecoveryResult {
  song: Song;
  lyrics: Lyrics;
  /** True when no LRCLIB version was within the duration tolerance and the closest one was used. */
  versionMismatch: boolean;
}

export interface TranslationResult {
  lrclibId: number;
  lang: string;
  /** One entry per LRC line, same order as `parseLrcLines` in the app. */
  lines: string[];
}

export interface JobUpdate {
  type: 'job.update';
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  result?: RecoveryResult | TranslationResult;
  error?: string;
}

export type PipelineParams =
  | {
      kind: 'recovery';
      deviceId: string;
      jobId: string;
      track: Song;
      /** LRCLIB ids the user already rejected ("wrong version"). */
      excludeIds: number[];
    }
  | {
      kind: 'translation';
      deviceId: string;
      jobId: string;
      lrclibId: number;
      lang: string;
    };
