import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { SongRow } from '@/components/song-row';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { clearHistory, getHistory, type HistoryEntry } from '@/lib/api';
import { openSong } from '@/lib/player-store';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function HistoryScreen() {
  const [songs, setSongs] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setSongs(await getHistory());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load history');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => setConfirmClear(false);
    }, [load])
  );

  // Two-step clear instead of a dialog: the first tap arms it for a few seconds.
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const onClear = async () => {
    if (!confirmClear) return setConfirmClear(true);
    setConfirmClear(false);
    try {
      await clearHistory();
      setSongs([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear history');
    }
  };

  const open = async (entry: HistoryEntry) => {
    if (entry.lrclibId == null) return;
    setOpening(entry.id);
    try {
      await openSong(entry.lrclibId);
      router.push('/player');
    } catch {
      setError("Couldn't open the lyrics. Try again.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerRight: () =>
            songs && songs.length > 0 ? (
              <Button variant="ghost" size="sm" onPress={onClear} className="mr-2">
                <Text className={confirmClear ? 'text-destructive' : undefined}>
                  {confirmClear ? 'Tap to confirm' : 'Clear'}
                </Text>
              </Button>
            ) : null,
        }}
      />
      {error && (
        <Text variant="muted" className="px-4 py-2" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      <FlatList
        data={songs ?? []}
        keyExtractor={(s) => String(s.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ItemSeparatorComponent={() => <View className="ml-4 h-px bg-border" />}
        renderItem={({ item }) => (
          <SongRow
            title={item.title}
            subtitle={
              opening === item.id
                ? 'Opening…'
                : `${item.artist} · ${item.source === 'chat' ? 'Chat' : 'Heard'} ${dateFormat.format(item.foundAt)}`
            }
            badge={item.lrclibId == null ? { label: 'No lyrics', variant: 'outline' } : null}
            disabled={item.lrclibId == null}
            onPress={() => open(item)}
          />
        )}
        ListEmptyComponent={
          songs ? (
            <View className="items-center gap-2 px-6 py-24">
              <Text className="font-semibold">No songs yet</Text>
              <Text variant="muted" className="text-center">
                Songs you recognise or find in chat show up here.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
