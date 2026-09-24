import { File, Paths } from 'expo-file-system';

/** Chat threads live in one JSON file in the app's documents folder (kept until the app is removed). */
const chatFile = () => new File(Paths.document, 'chat-threads.json');

export async function readChatFile(): Promise<string | null> {
  const file = chatFile();
  return file.exists ? file.text() : null;
}

export async function writeChatFile(json: string): Promise<void> {
  const file = chatFile();
  if (!file.exists) file.create();
  file.write(json);
}
