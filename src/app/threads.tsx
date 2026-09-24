import { router } from 'expo-router';
import { SquarePen, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { archiveThread, openThread, startNewChat, useChatStore } from '@/lib/chat-store';
import { usePlaceholderColor } from '@/lib/theme';
import { cn } from '@/lib/utils';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Chats saved on this device, most recent first. */
export default function ThreadsScreen() {
  const threads = useChatStore((s) => s.threads);
  const currentId = useChatStore((s) => s.currentId);
  const spinnerColor = usePlaceholderColor();
  // Two-step archive: the first tap arms the row for a few seconds, the second archives it.
  const [armed, setArmed] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const onArchive = async (id: string) => {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    setArchiving(id);
    setError(null);
    try {
      await archiveThread(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't archive the chat. It's still on this device.");
    } finally {
      setArchiving(null);
    }
  };

  const open = (id: string | null) => {
    if (id) openThread(id);
    else startNewChat();
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={threads}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <>
            {error && (
              <Text variant="muted" className="px-4 pt-3" accessibilityLiveRegion="polite">
                {error}
              </Text>
            )}
            <Pressable
              onPress={() => open(null)}
              accessibilityRole="button"
              className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-accent">
              <Icon as={SquarePen} size={18} />
              <Text className="font-medium">New chat</Text>
            </Pressable>
          </>
        }
        ItemSeparatorComponent={() => <View className="ml-4 h-px bg-border" />}
        renderItem={({ item }) => (
          <View className={cn('flex-row items-center', item.id === currentId && 'bg-secondary')}>
            <Pressable
              onPress={() => open(item.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: item.id === currentId }}
              className="min-h-14 flex-1 justify-center gap-0.5 py-3 pl-4 active:bg-accent">
              <Text className="font-medium" numberOfLines={1}>
                {item.title}
              </Text>
              <Text variant="muted" numberOfLines={1}>
                {`${item.messages.length} messages · ${dateFormat.format(item.updatedAt)}`}
              </Text>
            </Pressable>
            {archiving === item.id ? (
              <View className="h-14 w-14 items-center justify-center">
                <ActivityIndicator size="small" color={spinnerColor} />
              </View>
            ) : (
              <Pressable
                onPress={() => onArchive(item.id)}
                disabled={archiving != null}
                accessibilityRole="button"
                accessibilityLabel={armed === item.id ? 'Confirm archive' : 'Archive chat'}
                accessibilityHint="Moves this chat off the device to your archive"
                className={cn('h-14 flex-row items-center justify-center gap-1 px-4 active:bg-accent', armed === item.id && 'px-3')}>
                <Icon as={Trash2} size={18} className={armed === item.id ? 'text-destructive' : 'text-muted-foreground'} />
                {armed === item.id && <Text className="text-sm font-medium text-destructive">Archive</Text>}
              </Pressable>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center gap-2 px-6 py-16">
            <Text className="font-semibold">No chats yet</Text>
            <Text variant="muted" className="text-center">
              Your chats are saved on this device. Archived chats move to your account on the server.
            </Text>
          </View>
        }
      />
    </View>
  );
}
