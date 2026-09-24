import { useEffect, useState } from 'react';

import { lineIndexAt, type LrcLine } from '@/lib/lrc';
import { now, songPosition, type SyncState } from '@/lib/sync';

/**
 * Tracks which lyric line is playing. Re-renders only when the line changes
 * or the displayed second ticks over, not every frame.
 */
export function useSyncClock(
  lines: LrcLine[],
  sync: SyncState | null,
  nudgeMs: number,
  calibrationMs: number
) {
  const [state, setState] = useState({ index: -1, second: 0 });

  const active = sync != null && lines.length > 0;

  useEffect(() => {
    if (!sync || lines.length === 0) return;
    let frame = 0;
    const tick = () => {
      // Paused: position frozen at the pause moment, and no further frames.
      const position = songPosition(sync, sync.pausedAt ?? now(), nudgeMs, calibrationMs);
      const index = lineIndexAt(lines, position);
      const second = Math.floor(position / 1000);
      setState((s) => (s.index === index && s.second === second ? s : { index, second }));
      if (sync.pausedAt == null) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [lines, sync, nudgeMs, calibrationMs]);

  return active ? { index: state.index, positionMs: state.second * 1000 } : { index: -1, positionMs: 0 };
}
