import { Loader, Mic, Square, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { ListenPhase } from '@/hooks/use-recognizer';
import { CLIP_MS } from '@/lib/config';
import { now } from '@/lib/sync';
import { cn } from '@/lib/utils';

/** Seconds left in the current recording, updated a few times a second. */
function useCountdown(startedAt: number | null) {
  const [left, setLeft] = useState(CLIP_MS);
  useEffect(() => {
    if (startedAt == null) return;
    const update = () => setLeft(Math.max(0, CLIP_MS - (now() - startedAt)));
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [startedAt]);
  return left;
}

export function ListenButton({
  phase,
  startedAt,
  onPress,
  onCancel,
  size = 'lg',
}: {
  phase: ListenPhase;
  startedAt: number | null;
  /** Starts listening; while recording, submits the clip recorded so far. */
  onPress: () => void;
  /** Discards the clip being recorded. */
  onCancel: () => void;
  size?: 'lg' | 'sm';
}) {
  const left = useCountdown(startedAt);
  const recording = phase === 'recording';
  const identifying = phase === 'identifying';
  const label = recording ? 'Identify now' : identifying ? 'Identifying song' : 'Listen';

  if (size === 'sm') {
    return (
      <View className="flex-row items-center gap-1">
        <Pressable
          onPress={onPress}
          disabled={identifying}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Sync now' : 'Resync to the music'}
          className={cn(
            'h-11 flex-row items-center gap-2 rounded-full border border-border px-4 active:bg-accent',
            identifying && 'opacity-60'
          )}>
          <Icon as={recording ? Square : identifying ? Loader : Mic} size={16} />
          <Text className="text-sm font-medium">
            {recording ? `${Math.ceil(left / 1000)}s` : identifying ? 'Syncing…' : 'Resync'}
          </Text>
        </Pressable>
        {recording && (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel resync"
            className="h-11 w-11 items-center justify-center rounded-full active:bg-accent">
            <Icon as={X} size={18} className="text-muted-foreground" />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View className="items-center gap-4">
      <Pressable
        onPress={onPress}
        disabled={identifying}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: identifying || recording }}
        className={cn(
          'h-40 w-40 items-center justify-center rounded-full bg-primary active:opacity-90',
          identifying && 'opacity-60'
        )}>
        <Icon as={recording ? Square : identifying ? Loader : Mic} size={48} className="text-primary-foreground" />
      </Pressable>
      {recording && (
        <>
          <View className="h-1 w-40 overflow-hidden rounded-full bg-muted" accessibilityElementsHidden>
            <View className="h-full bg-foreground" style={{ width: `${(1 - left / CLIP_MS) * 100}%` }} />
          </View>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            className="h-11 flex-row items-center gap-1.5 rounded-full px-4 active:bg-accent">
            <Icon as={X} size={16} className="text-muted-foreground" />
            <Text className="text-sm font-medium text-muted-foreground">Cancel</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
