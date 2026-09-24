import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowUp, MessagesSquare, SquarePen, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
// Not re-exported publicly by expo-router; re-check this path after SDK upgrades.
import { useBottomTabBarHeight } from 'expo-router/build/react-navigation/bottom-tabs';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { SongRow } from '@/components/song-row';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { streamChat, type ChatMessage, type Song, type SongCard } from '@/lib/api';
import { currentThread, loadChats, saveMessages, startNewChat, useChatStore } from '@/lib/chat-store';
import { applyChatTranslation, getPlayer, openSong, reportWrongVersion } from '@/lib/player-store';
import { usePlaceholderColor } from '@/lib/theme';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'What song goes "hello from the other side"?',
  'Find "Bohemian Rhapsody"',
  'Who wrote "Yesterday"?',
];

function CardList({ cards }: { cards: SongCard[] }) {
  const [opening, setOpening] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const open = async (card: SongCard) => {
    if (card.lrclibId == null) return;
    setOpening(card.lrclibId);
    setFailed(false);
    try {
      await openSong(card.lrclibId, 'chat');
      router.push('/player');
    } catch {
      setFailed(true);
    } finally {
      setOpening(null);
    }
  };
  return (
    <View className="mt-2 overflow-hidden rounded-lg border border-border">
      {cards.map((card, i) => (
        <SongRow
          key={card.lrclibId ?? i}
          title={card.title}
          subtitle={opening === card.lrclibId ? 'Opening…' : card.artist}
          badge={
            card.label === 'match'
              ? { label: 'Lyrics match' }
              : card.label === 'possible'
                ? { label: 'Possible', variant: 'outline' }
                : null
          }
          onPress={() => open(card)}
          className={cn(i > 0 && 'border-t border-border')}
        />
      ))}
      {failed && (
        <Text variant="muted" className="px-4 py-2">
          {"Couldn't open the lyrics. Try again."}
        </Text>
      )}
    </View>
  );
}

/** Shown while the reply is still arriving, so a pause between tokens doesn't look finished. */
function StreamingIndicator({ label }: { label: string | null }) {
  const color = usePlaceholderColor();
  return (
    <View
      className={cn('flex-row items-center gap-2', label ? 'py-1' : 'pt-2')}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Still responding'}>
      <ActivityIndicator size="small" color={color} />
      {label && <Text variant="muted">{label}</Text>}
    </View>
  );
}

/**
 * Height the composer must rise by: the keyboard height on every frame of its
 * animation, minus the tab bar the keyboard slides over.
 */
function useKeyboardSpacer() {
  const tabBarHeight = useBottomTabBarHeight();
  const keyboardHeight = useSharedValue(0);
  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        keyboardHeight.value = Math.max(e.height, 0);
      },
      onEnd: (e) => {
        'worklet';
        keyboardHeight.value = Math.max(e.height, 0);
      },
    },
    []
  );
  return useAnimatedStyle(() => ({ height: Math.max(keyboardHeight.value - tabBarHeight, 0) }), [tabBarHeight]);
}

export default function ChatScreen() {
  const { about } = useLocalSearchParams<{ about?: string }>();
  const currentId = useChatStore((s) => s.currentId);
  const loaded = useChatStore((s) => s.loaded);
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  // Mirror of `messages` so the stream's end can save the final state.
  const messagesRef = useRef<ChatMessage[]>([]);
  const setMessages = useCallback((fn: (m: ChatMessage[]) => ChatMessage[]) => {
    messagesRef.current = fn(messagesRef.current);
    setMessagesState(messagesRef.current);
  }, []);
  const threadRef = useRef<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [aboutSong, setAboutSong] = useState<Song | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const keyboardSpacer = useKeyboardSpacer();

  useEffect(() => {
    void loadChats();
  }, []);

  // Show the current thread (after loading, "New chat" or picking one from the list).
  useEffect(() => {
    if (!loaded || threadRef.current === currentId) return;
    threadRef.current = currentId;
    setMessages(() => currentThread()?.messages ?? []);
  }, [loaded, currentId, setMessages]);

  // Opened from the player: questions like "translate this" refer to that song.
  useEffect(() => {
    if (about === 'current') setAboutSong(getPlayer()?.song ?? null);
  }, [about]);

  const updateLast = useCallback(
    (fn: (m: ChatMessage) => ChatMessage) => {
      setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
    },
    [setMessages]
  );

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || sending) return;
    setInput('');
    setSending(true);
    const stamp = Date.now();
    const history = messagesRef.current;
    setMessages((m) => [...m, { id: `u${stamp}`, role: 'user', content: message, cards: [] }]);
    // Saved right away so the question survives the app closing mid-reply.
    const threadId = saveMessages(threadRef.current, messagesRef.current);
    threadRef.current = threadId;
    setMessages((m) => [...m, { id: `a${stamp}`, role: 'assistant', content: '', cards: [] }]);
    try {
      await streamChat(message, aboutSong, history, (event) => {
        switch (event.type) {
          case 'status':
            setStatus(event.text);
            break;
          case 'token':
            setStatus(null);
            updateLast((m) => ({ ...m, content: m.content + event.text }));
            break;
          case 'cards':
            updateLast((m) => ({ ...m, cards: event.cards }));
            break;
          case 'action':
            if (event.action === 'translate') void applyChatTranslation(event.lang, event.jobId, event.lines);
            else void reportWrongVersion(event.jobId);
            break;
          case 'error':
            updateLast((m) => (m.content ? m : { ...m, content: event.message }));
            break;
        }
      });
    } catch (e) {
      updateLast((m) => ({ ...m, content: e instanceof Error ? e.message : 'Something went wrong.' }));
    } finally {
      setSending(false);
      setStatus(null);
      // Only save into the thread this reply belongs to (the user may have switched meanwhile).
      if (threadRef.current === threadId) saveMessages(threadId, messagesRef.current);
    }
  };

  const onNewChat = () => {
    if (sending) return;
    startNewChat();
  };

  // Enter sends on web; Shift+Enter adds a new line.
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean }>) => {
    if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    // With Android edge-to-edge the window no longer resizes for the keyboard, so a spacer
    // under the composer grows with the keyboard (frame by frame) and pushes it up.
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerRight: () => (
            <View className="mr-2 flex-row">
              <Button
                variant="ghost"
                size="icon"
                onPress={() => router.push('/threads')}
                accessibilityLabel="Chat history">
                <Icon as={MessagesSquare} size={20} />
              </Button>
              <Button variant="ghost" size="icon" onPress={onNewChat} disabled={sending} accessibilityLabel="New chat">
                <Icon as={SquarePen} size={20} />
              </Button>
            </View>
          ),
        }}
      />
      <View className="flex-1">
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerClassName="gap-4 p-4 grow"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          // The list shrinks when the keyboard opens; keep the latest message in view.
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View className="flex-1 justify-center gap-3">
              <Text className="text-lg font-semibold">Find a song or ask about music</Text>
              <Text variant="muted">
                Type a title, a few lines you remember, or a music question. Answers can be wrong, so check the results.
              </Text>
              <View className="mt-2 gap-2">
                {SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => send(s)}
                    accessibilityRole="button"
                    className="rounded-lg border border-border px-4 py-3 active:bg-accent">
                    <Text>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item, index }) =>
            item.role === 'user' ? (
              <View className="max-w-[85%] self-end rounded-2xl bg-primary px-4 py-2">
                <Text className="text-primary-foreground">{item.content}</Text>
              </View>
            ) : (
              <View className="max-w-[95%]">
                {item.content ? <Text className="leading-6">{item.content}</Text> : null}
                {item.cards.length > 0 && <CardList cards={item.cards} />}
                {sending && index === messages.length - 1 && (
                  <StreamingIndicator label={item.content ? null : (status ?? 'Thinking…')} />
                )}
              </View>
            )
          }
        />

        <View className="gap-2 border-t border-border px-4 py-3">
          {aboutSong && (
            <View className="flex-row items-center gap-2 self-start rounded-full bg-secondary py-1 pl-3 pr-1">
              <Text className="text-sm" numberOfLines={1}>
                About: {aboutSong.title}
              </Text>
              <Pressable
                onPress={() => setAboutSong(null)}
                accessibilityRole="button"
                accessibilityLabel="Stop asking about this song"
                hitSlop={10}
                className="rounded-full p-1 active:bg-accent">
                <Icon as={X} size={14} />
              </Pressable>
            </View>
          )}
          <View className="flex-row items-end gap-2">
            <Textarea
              value={input}
              onChangeText={setInput}
              onKeyPress={onKeyPress}
              placeholder={aboutSong ? 'Ask about this song, e.g. "translate to Spanish"' : 'Song title, lyrics, or a question'}
              accessibilityLabel="Message"
              className="max-h-32 min-h-11 flex-1"
              numberOfLines={1}
            />
            <Button
              size="icon"
              className="h-11 w-11 rounded-full"
              disabled={sending || !input.trim()}
              onPress={() => send()}
              accessibilityLabel="Send">
              <Icon as={ArrowUp} size={18} className="text-primary-foreground" />
            </Button>
          </View>
        </View>
      </View>
      <Animated.View style={keyboardSpacer} />
    </View>
  );
}
