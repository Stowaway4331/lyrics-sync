const KEY = 'lyrics-sync.chat-threads';

/** Chat threads live in this browser's localStorage. */
export async function readChatFile(): Promise<string | null> {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null; // storage blocked (private mode): chats last only this session
  }
}

export async function writeChatFile(json: string): Promise<void> {
  try {
    window.localStorage.setItem(KEY, json);
  } catch {}
}
