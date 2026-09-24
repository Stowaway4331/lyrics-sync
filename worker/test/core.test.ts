import { describe, expect, it } from 'vitest';
import { lineIndexAt, parseLrc } from '../../src/lib/lrc';
import { offsetAtStop, type AcrMusic } from '../src/acrcloud';
import type { LrclibTrack } from '../src/lrclib';
import { basicCleanTitle, pickByDuration, primaryArtist, snippetScore, SNIPPET_MATCH_THRESHOLD } from '../src/match';

describe('parseLrc', () => {
  it('parses timestamps in several formats and sorts by time', () => {
    const lines = parseLrc('[ar:Adele]\n[00:12.50]Second\n[00:01]First\n[01:02.345]Third');
    expect(lines).toEqual([
      { timeMs: 1000, text: 'First' },
      { timeMs: 12500, text: 'Second' },
      { timeMs: 62345, text: 'Third' },
    ]);
  });

  it('expands lines with several time tags', () => {
    const lines = parseLrc('[00:10.00][00:30.00]Chorus');
    expect(lines.map((l) => l.timeMs)).toEqual([10000, 30000]);
  });

  it('applies the offset tag and keeps empty lines as gaps', () => {
    const lines = parseLrc('[offset:+500]\n[00:02.00]Hello\n[00:05.00]');
    expect(lines).toEqual([
      { timeMs: 1500, text: 'Hello' },
      { timeMs: 4500, text: '' },
    ]);
  });

  it('finds the current line', () => {
    const lines = parseLrc('[00:01.00]a\n[00:05.00]b\n[00:09.00]c');
    expect(lineIndexAt(lines, 500)).toBe(-1);
    expect(lineIndexAt(lines, 1000)).toBe(0);
    expect(lineIndexAt(lines, 8999)).toBe(1);
    expect(lineIndexAt(lines, 60_000)).toBe(2);
  });
});

describe('offsetAtStop', () => {
  const music: AcrMusic = { acrid: 'x', title: 't', db_end_time_offset_ms: 60_000, sample_end_time_offset_ms: 9000, play_offset_ms: 59_500 };

  it('adds the audio recorded after the matched part', () => {
    expect(offsetAtStop(music, 10_000)).toBe(61_000);
  });

  it('falls back to play_offset_ms', () => {
    expect(offsetAtStop({ acrid: 'x', title: 't', play_offset_ms: 42_000 }, 10_000)).toBe(42_000);
  });
});

const track = (id: number, duration: number, synced = true): LrclibTrack => ({
  id,
  trackName: 'Song',
  artistName: 'Artist',
  albumName: 'Album',
  duration,
  instrumental: false,
  plainLyrics: 'la la',
  syncedLyrics: synced ? '[00:01.00]la la' : null,
});

describe('pickByDuration', () => {
  it('prefers a synced version within tolerance', () => {
    const pick = pickByDuration([track(1, 200, false), track(2, 201.5), track(3, 240)], 200);
    expect(pick?.track.id).toBe(2);
    expect(pick?.withinTolerance).toBe(true);
  });

  it('returns the closest version, flagged, when none is within tolerance', () => {
    const pick = pickByDuration([track(1, 230), track(2, 210)], 200);
    expect(pick?.track.id).toBe(2);
    expect(pick?.withinTolerance).toBe(false);
  });

  it('skips excluded ids', () => {
    expect(pickByDuration([track(1, 200)], 200, [1])).toBeNull();
  });
});

describe('title cleanup', () => {
  it('drops version and featuring tags', () => {
    expect(basicCleanTitle('Hello (feat. Someone)')).toBe('Hello');
    expect(basicCleanTitle('Yesterday - Remastered 2009')).toBe('Yesterday');
    expect(basicCleanTitle('Song [Live at Wembley]')).toBe('Song');
    expect(basicCleanTitle('Plain Title')).toBe('Plain Title');
  });

  it('takes the first artist', () => {
    expect(primaryArtist('Calvin Harris, Dua Lipa')).toBe('Calvin Harris');
    expect(primaryArtist('Simon & Garfunkel')).toBe('Simon');
  });
});

describe('snippetScore', () => {
  const lyrics = "Hello from the other side\nI must've called a thousand times\nTo tell you I'm sorry";

  it('scores an exact snippet as a match', () => {
    expect(snippetScore('hello from the other side', lyrics)).toBe(1);
  });

  it('tolerates a misheard word', () => {
    expect(snippetScore('i must have called a thousand times', lyrics)).toBeGreaterThanOrEqual(SNIPPET_MATCH_THRESHOLD);
  });

  it('scores unrelated text low', () => {
    expect(snippetScore('we will rock you', lyrics)).toBeLessThan(SNIPPET_MATCH_THRESHOLD);
  });
});
