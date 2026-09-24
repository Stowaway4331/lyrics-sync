/** Monotonic milliseconds, unaffected by the device clock being changed. */
export const now = () => performance.now();

/**
 * Current song position. `offsetAtStopMs` is where the song was when
 * recording stopped (from ACRCloud); the clock runs from that moment, so
 * upload and processing time don't affect accuracy.
 */
export function songPosition(
  sync: { offsetAtStopMs: number; stoppedAt: number },
  at: number,
  nudgeMs: number,
  calibrationMs: number
): number {
  return sync.offsetAtStopMs + (at - sync.stoppedAt) + nudgeMs + calibrationMs;
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
