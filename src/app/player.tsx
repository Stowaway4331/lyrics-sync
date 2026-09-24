import { router, Stack } from 'expo-router';
import { Languages, MessageCircle, Minus, Plus } from 'lucide-react-native';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';

import { ListenButton } from '@/components/listen-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useRecognizer } from '@/hooks/use-recognizer';
import { useSyncClock } from '@/hooks/use-sync-clock';
import { NUDGE_STEP_MS } from '@/lib/config';
import { parseLrc, plainLines } from '@/lib/lrc';
import { nudge, reportWrongVersion, usePlayerStore } from '@/lib/player-store';
import { formatTime } from '@/lib/sync';
import { cn } from '@/lib/utils';

/** After the user scrolls by hand, auto-scroll waits this long before taking over again. */
const MANUAL_SCROLL_PAUSE_MS = 4000;

const LyricLine = memo(function LyricLine({
  text,
  translation,
  state,
  onLayout,
}: {
  text: string;
  translation?: string;
  state: 'past' | 'current' | 'future' | 'plain';
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const empty = text.trim() === '';
  const showTranslation = !!translation && translation.trim() !== '' && translation.trim() !== text.trim();
  return (
    <View onLayout={onLayout} className={cn('py-2', empty && 'py-1')}>
      <Text
        className={cn(
          state === 'plain' ? 'text-lg leading-7' : 'text-2xl font-semibold leading-8',
          state === 'current' && 'text-foreground',
          state === 'past' && 'text-muted-foreground/60',
          state === 'future' && 'text-muted-foreground'
        )}
        accessibilityState={{ selected: state === 'current' }}>
        {empty ? '♪' : text}
      </Text>
      {showTranslation && (
        <Text className={cn('mt-1 text-base leading-6', state === 'current' ? 'text-foreground/80' : 'text-muted-foreground')}>
          {translation}
        </Text>
      )}
    </View>
  );
});

/** Synced / Plain switch for songs that have timed lyrics. */
function ViewToggle({ plain, onChange }: { plain: boolean; onChange: (plain: boolean) => void }) {
  return (
    <View className="flex-row rounded-full border border-border p-0.5" accessibilityRole="radiogroup">
      {(['Synced', 'Plain'] as const).map((label) => {
        const selected = (label === 'Plain') === plain;
        return (
          <Pressable
            key={label}
            onPress={() => onChange(label === 'Plain')}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            hitSlop={6}
            className={cn('rounded-full px-3 py-1', selected && 'bg-secondary')}>
            <Text className={cn('text-xs font-medium', !selected && 'text-muted-foreground')}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function PlayerScreen() {
  const player = usePlayerStore((s) => s.player);
  const calibrationMs = usePlayerStore((s) => s.prefs.calibrationMs);
  const recognizer = useRecognizer();

  const syncedText = player?.lyrics?.synced ?? null;
  const plainText = player?.lyrics?.plain ?? null;
  const synced = useMemo(() => (syncedText ? parseLrc(syncedText) : null), [syncedText]);
  const plain = useMemo(() => (!synced && plainText ? plainLines(plainText) : null), [synced, plainText]);
  // Plain view: the same lines without timing, highlight or auto-scroll (translations stay aligned).
  const [showPlain, setShowPlain] = useState(false);
  const { index, positionMs } = useSyncClock(
    showPlain ? [] : (synced ?? []),
    player?.sync ?? null,
    player?.nudgeMs ?? 0,
    calibrationMs
  );

  // Auto-scroll keeps the current line about a third of the way down the screen.
  const scrollRef = useRef<ScrollView>(null);
  const lineY = useRef<number[]>([]);
  const [viewportH, setViewportH] = useState(0);
  const manualUntil = useRef(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);
  useEffect(() => {
    if (index < 0 || Date.now() < manualUntil.current) return;
    const y = lineY.current[index];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - viewportH * 0.33), animated: !reduceMotion });
  }, [index, viewportH, reduceMotion]);

  if (!player) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
        <Stack.Screen options={{ title: '' }} />
        <Text className="text-lg font-semibold">Nothing playing</Text>
        <Button onPress={() => router.replace('/')}>
          <Text>Listen to a song</Text>
        </Button>
      </View>
    );
  }

  const { song, lyrics, lyricsStatus, versionMismatch, sync, translation } = player;
  const ended = sync != null && song.durationMs > 0 && positionMs > song.durationMs + 2000;
  const translations = translation?.status === 'complete' ? translation.lines : null;

  const onResync = async () => {
    if (recognizer.phase === 'recording') return recognizer.submit();
    await recognizer.listen();
  };

  let status: string;
  if (lyricsStatus === 'finding') status = 'Finding lyrics…';
  else if (!lyrics) status = 'No lyrics found';
  else if (lyrics.instrumental) status = 'Instrumental';
  else if (!synced) status = 'Lyrics not synced';
  else if (showPlain) status = 'Plain view';
  else if (!sync) status = 'Listen to sync';
  else if (ended) status = 'Song ended';
  else status = `Synced · ${formatTime(positionMs)}`;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: '' }} />

      <View className="gap-1 px-5 pb-3">
        <Text className="text-2xl font-bold tracking-tight" numberOfLines={2}>
          {song.title}
        </Text>
        <Text variant="muted" numberOfLines={1}>
          {[song.artist, song.album].filter(Boolean).join(' · ')}
        </Text>
        <View className="mt-2 flex-row flex-wrap items-center gap-2" accessibilityLiveRegion="polite">
          <Badge variant="secondary">
            <Text>{status}</Text>
          </Badge>
          {translation && (
            <Badge variant="outline">
              <Text>
                {translation.status === 'running'
                  ? `Translating to ${translation.lang}…`
                  : translation.status === 'failed'
                    ? 'Translation failed'
                    : translation.lang}
              </Text>
            </Badge>
          )}
          {versionMismatch && (
            <Badge variant="outline">
              <Text>May be a different version</Text>
            </Badge>
          )}
          {synced && <ViewToggle plain={showPlain} onChange={setShowPlain} />}
          {lyrics && lyricsStatus === 'found' && (
            <Pressable
              onPress={() => reportWrongVersion()}
              accessibilityRole="button"
              hitSlop={8}
              className="px-1 py-1">
              <Text variant="muted" className="underline">
                Wrong version?
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="px-5 pb-[50%]"
        onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
        onScrollBeginDrag={() => (manualUntil.current = Date.now() + MANUAL_SCROLL_PAUSE_MS)}>
        {synced?.map((line, i) => (
          <LyricLine
            key={`${line.timeMs}-${i}`}
            text={line.text}
            translation={translations?.[i]}
            state={showPlain ? 'plain' : !sync ? 'future' : i === index ? 'current' : i < index ? 'past' : 'future'}
            onLayout={(e) => (lineY.current[i] = e.nativeEvent.layout.y)}
          />
        ))}
        {plain?.map((text, i) => (
          <LyricLine key={i} text={text} translation={translations?.[i]} state="plain" />
        ))}
        {!synced && !plain && (
          <View className="items-center gap-2 py-16">
            <Text variant="muted" className="text-center">
              {lyricsStatus === 'finding'
                ? 'Looking for lyrics. They will appear here automatically.'
                : lyrics?.instrumental
                  ? 'This track is instrumental.'
                  : "We couldn't find lyrics for this song. Try chat to search another way."}
            </Text>
          </View>
        )}
      </ScrollView>

      <View className="flex-row items-center justify-between gap-2 border-t border-border px-4 py-3">
        <ListenButton
          size="sm"
          phase={recognizer.phase}
          startedAt={recognizer.startedAt}
          onPress={onResync}
          onCancel={recognizer.cancel}
        />
        <View className="flex-row items-center gap-1">
          {synced && sync && !showPlain && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onPress={() => nudge(-NUDGE_STEP_MS)}
                accessibilityLabel="Move lyrics back half a second">
                <Icon as={Minus} size={18} />
              </Button>
              <Text variant="muted" className="w-12 text-center tabular-nums">
                {player.nudgeMs === 0 ? '0.0s' : `${player.nudgeMs > 0 ? '+' : ''}${(player.nudgeMs / 1000).toFixed(1)}s`}
              </Text>
              <Button
                variant="ghost"
                size="icon"
                onPress={() => nudge(NUDGE_STEP_MS)}
                accessibilityLabel="Move lyrics ahead half a second">
                <Icon as={Plus} size={18} />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            disabled={!lyrics || lyrics.instrumental}
            onPress={() => router.push('/language')}
            accessibilityLabel="Translate lyrics">
            <Icon as={Languages} size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onPress={() => router.push({ pathname: '/chat', params: { about: 'current' } })}
            accessibilityLabel="Ask about this song">
            <Icon as={MessageCircle} size={18} />
          </Button>
        </View>
      </View>
      {recognizer.phase === 'no_match' && (
        <Text variant="muted" className="px-4 pb-3 text-center">
          {"Couldn't hear the song clearly. Try again closer to the speaker."}
        </Text>
      )}
      {recognizer.phase === 'error' && recognizer.error && (
        <Text variant="muted" className="px-4 pb-3 text-center">
          {recognizer.error.message}
        </Text>
      )}
    </View>
  );
}
