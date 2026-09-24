import { router } from 'expo-router';
import { SquarePen } from 'lucide-react-native';
import { FlatList, Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { openThread, startNewChat, useChatStore } from '@/lib/chat-store';
import { cn } from '@/lib/utils';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Chats saved on this device, most recent first. */
export default function ThreadsScreen() {
  const threads = useChatStore((s) => s.threads);
  const currentId = useChatStore((s) => s.currentId);

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
          <Pressable
            onPress={() => open(null)}
            accessibilityRole="button"
            className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-accent">
            <Icon as={SquarePen} size={18} />
            <Text className="font-medium">New chat</Text>
          </Pressable>
        }
        ItemSeparatorComponent={() => <View className="ml-4 h-px bg-border" />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: item.id === currentId }}
            className={cn('min-h-14 justify-center gap-0.5 px-4 py-3 active:bg-accent', item.id === currentId && 'bg-secondary')}>
            <Text className="font-medium" numberOfLines={1}>
              {item.title}
            </Text>
            <Text variant="muted" numberOfLines={1}>
              {`${item.messages.length} messages · ${dateFormat.format(item.updatedAt)}`}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View className="items-center gap-2 px-6 py-16">
            <Text className="font-semibold">No chats yet</Text>
            <Text variant="muted" className="text-center">
              Your chats are saved on this device.
            </Text>
          </View>
        }
      />
    </View>
  );
}
