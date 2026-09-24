// Shared with the Worker (worker/src imports this file), so keep it free of
// React Native imports.

export interface LrcLine {
  timeMs: number;
  text: string;
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]/im;

/**
 * Parses LRC text into lines sorted by time. A line with several time tags
 * ("[00:12.00][01:30.00]Chorus") produces one entry per tag. Metadata tags
 * such as [ar:...] are ignored; [offset:ms] is applied (positive = earlier).
 */
export function parseLrc(lrc: string): LrcLine[] {
  const offsetMatch = OFFSET_TAG.exec(lrc);
  const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
  const lines: LrcLine[] = [];

  for (const raw of lrc.split(/\r?\n/)) {
    const times: number[] = [];
    TIME_TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    while ((match = TIME_TAG.exec(raw)) !== null) {
      // Only leading tags count; a tag in the middle of the text is part of the text.
      if (match.index !== lastEnd) break;
      const [, min, sec, frac = '0'] = match;
      const fracMs = Number(frac.padEnd(3, '0').slice(0, 3));
      times.push(Number(min) * 60_000 + Number(sec) * 1000 + fracMs);
      lastEnd = match.index + match[0].length;
    }
    if (times.length === 0) continue;
    const text = raw.slice(lastEnd).trim();
    for (const t of times) lines.push({ timeMs: Math.max(0, t - offset), text });
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Index of the line playing at `positionMs`, or -1 before the first line. */
export function lineIndexAt(lines: LrcLine[], positionMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= positionMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Plain lyrics as display lines (no timing). */
export function plainLines(plain: string): string[] {
  return plain.split(/\r?\n/).map((l) => l.trim());
}
