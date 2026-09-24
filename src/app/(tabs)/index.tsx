import { router } from 'expo-router';
import { Linking, View } from 'react-native';

import { ListenButton } from '@/components/listen-button';
import { SongRow } from '@/components/song-row';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useRecognizer } from '@/hooks/use-recognizer';
import { CLIP_MS } from '@/lib/config';
import { usePlayerStore } from '@/lib/player-store';

export default function ListenScreen() {
  const { phase, error, startedAt, listen, submit, cancel, reset } = useRecognizer();
  const current = usePlayerStore((s) => s.player?.song ?? null);

  const onPress = async () => {
    if (phase === 'recording') return submit();
    const outcome = await listen();
    if (outcome === 'matched') router.push('/player');
  };

  const heading = {
    idle: 'Tap to listen',
    recording: 'Listening…',
    identifying: 'Identifying…',
    no_match: "Couldn't recognise this song",
    error: 'Something went wrong',
  }[phase];

  const hint = {
    idle: `Hold your phone near the music. It takes about ${Math.round(CLIP_MS / 1000)} seconds.`,
    recording: 'Keep the music playing. Tap the button to identify now.',
    identifying: 'Finding the song and its lyrics.',
    no_match: 'Try again closer to the speaker, or search by lyrics in chat.',
    error: error?.message ?? 'Please try again.',
  }[phase];

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center gap-8 px-6">
        <ListenButton phase={phase} startedAt={startedAt} onPress={onPress} onCancel={cancel} />
        <View className="items-center gap-2" accessibilityLiveRegion="polite">
          <Text className="text-center text-xl font-semibold">{heading}</Text>
          <Text variant="muted" className="max-w-xs text-center">
            {hint}
          </Text>
        </View>

        {(phase === 'no_match' || phase === 'error') && (
          <View className="flex-row gap-2">
            {error?.permission ? (
              <Button variant="outline" onPress={() => Linking.openSettings()}>
                <Text>Open settings</Text>
              </Button>
            ) : (
              <Button variant="outline" onPress={reset}>
                <Text>Dismiss</Text>
              </Button>
            )}
            {phase === 'no_match' && (
              <Button variant="outline" onPress={() => router.push('/chat')}>
                <Text>Search in chat</Text>
              </Button>
            )}
          </View>
        )}
      </View>

      {current && phase === 'idle' && (
        <View className="border-t border-border">
          <SongRow
            title={current.title}
            subtitle={`Now showing · ${current.artist}`}
            onPress={() => router.push('/player')}
          />
        </View>
      )}
    </View>
  );
}
