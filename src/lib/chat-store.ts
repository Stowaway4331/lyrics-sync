import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';

import * as api from './api';
import type { ChatMessage } from './api';
import { readChatFile, writeChatFile } from './chat-storage';

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

interface ChatFile {
  version: 1;
  /** Server-side chat history (before chats moved to the device) was imported once. */
  imported: boolean;
  threads: ChatThread[];
}

interface State {
  loaded: boolean;
  threads: ChatThread[];
  /** Thread shown in the chat screen; null = a new, empty chat. */
  currentId: string | null;
}

let state: State = { loaded: false, threads: [], currentId: null };
let imported = false;
const subscribers = new Set<() => void>();

function set(update: (s: State) => State) {
  state = update(state);
  subscribers.forEach((fn) => fn());
}

export function useChatStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => select(state),
    () => select(state)
  );
}

// Writes are chained so a slow write can never overwrite a newer one.
let writing = Promise.resolve();
function persist() {
  const file: ChatFile = { version: 1, imported, threads: state.threads };
  const json = JSON.stringify(file);
  writing = writing.then(() => writeChatFile(json)).catch(() => {});
}

const byRecent = (a: ChatThread, b: ChatThread) => b.updatedAt - a.updatedAt;

function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.content.trim() ?? 'New chat';
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

/** Loads threads from the device; the first time, imports the chat history the server used to keep. */
export async function loadChats() {
  if (state.loaded) return;
  let threads: ChatThread[] = [];
  try {
    const raw = await readChatFile();
    if (raw) {
      const file = JSON.parse(raw) as ChatFile;
      threads = file.threads ?? [];
      imported = file.imported === true;
    }
  } catch {
    // Corrupt file: start empty rather than failing the chat screen.
  }

  if (!imported) {
    try {
      const legacy = await api.getChatHistory();
      if (legacy.length) {
        const at = Date.now();
        threads = [...threads, { id: Crypto.randomUUID(), title: titleFrom(legacy), createdAt: at, updatedAt: at, messages: legacy }];
      }
      imported = true;
    } catch {
      // Offline: try again next launch.
    }
  }

  threads.sort(byRecent);
  set((s) => ({ ...s, loaded: true, threads, currentId: s.currentId ?? threads[0]?.id ?? null }));
  persist();
}

export const currentThread = () => state.threads.find((t) => t.id === state.currentId) ?? null;

export function startNewChat() {
  set((s) => ({ ...s, currentId: null }));
}

export function openThread(id: string) {
  set((s) => ({ ...s, currentId: id }));
}

/**
 * Saves a thread's messages. With no thread yet (a new chat), creates one and
 * makes it current. Returns the thread id.
 */
export function saveMessages(threadId: string | null, messages: ChatMessage[]): string | null {
  if (!threadId && messages.length === 0) return null;
  const at = Date.now();
  const id = threadId ?? Crypto.randomUUID();
  set((s) => {
    const existing = s.threads.find((t) => t.id === id);
    const thread: ChatThread = existing
      ? { ...existing, messages, updatedAt: at, title: existing.title === 'New chat' ? titleFrom(messages) : existing.title }
      : { id, title: titleFrom(messages), createdAt: at, updatedAt: at, messages };
    return { ...s, threads: [thread, ...s.threads.filter((t) => t.id !== id)], currentId: s.currentId ?? id };
  });
  persist();
  return id;
}
