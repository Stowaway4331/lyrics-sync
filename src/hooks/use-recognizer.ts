import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { useCallback, useRef, useState } from 'react';

import { ApiError, recognize } from '@/lib/api';
import { CLIP_MS } from '@/lib/config';
import { applyRecognition } from '@/lib/player-store';
import { now } from '@/lib/sync';

export type ListenPhase = 'idle' | 'recording' | 'identifying' | 'no_match' | 'error';

// Mono AAC at 96 kbps: a 10 s clip is ~120 KB, far below ACRCloud's 5 MB limit.
const PRESET: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 96_000 };

/**
 * Records a clip, sends it for recognition and applies the result to the
 * player store. `stoppedAt` is taken the moment recording stops, which is what
 * the sync clock runs from.
 */
export function useRecognizer() {
  const recorder = useAudioRecorder(PRESET);
  const [phase, setPhase] = useState<ListenPhase>('idle');
  const [error, setError] = useState<{ message: string; permission?: boolean } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const busy = useRef(false);
  const cancelled = useRef(false);
  /** Ends the recording wait early (submit or cancel). Set only while recording. */
  const stopWaiting = useRef<(() => void) | null>(null);

  const listen = useCallback(async (): Promise<'matched' | 'no_match' | 'error' | 'cancelled'> => {
    if (busy.current) return 'cancelled';
    busy.current = true;
    cancelled.current = false;
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError({ message: 'Microphone access is needed to recognise songs.', permission: true });
        setPhase('error');
        return 'error';
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      const start = now();
      recorder.record();
      setStartedAt(start);
      setPhase('recording');

      // Wait for the full clip, or until the user submits early or cancels. The recorder is
      // stopped exactly once, below.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, CLIP_MS);
        stopWaiting.current = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      stopWaiting.current = null;
      const measured = recorder.getStatus().durationMillis;
      const stoppedAt = now();
      await recorder.stop();
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (cancelled.current) {
        setPhase('idle');
        return 'cancelled';
      }

      setPhase('identifying');
      const uri = recorder.uri;
      if (!uri) throw new Error('Recording failed');
      const result = await recognize(uri, measured > 0 ? measured : stoppedAt - start);
      if (!result.match) {
        setPhase('no_match');
        return 'no_match';
      }
      applyRecognition(result, stoppedAt);
      setPhase('idle');
      return 'matched';
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : 'Recording failed. Please try again.' });
      setPhase('error');
      return 'error';
    } finally {
      busy.current = false;
      setStartedAt(null);
    }
  }, [recorder]);

  /** Stops now and identifies what was recorded so far, whatever its length. */
  const submit = useCallback(() => {
    stopWaiting.current?.();
  }, []);

  /** Stops now and discards the clip. */
  const cancel = useCallback(() => {
    cancelled.current = true;
    stopWaiting.current?.();
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
  }, []);

  return { phase, error, startedAt, listen, submit, cancel, reset };
}
