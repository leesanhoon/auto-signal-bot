import { createTelegramClient } from "./notification/telegram-client.js";

export interface Notifier {
  sendMessage(text: string): Promise<void>;
  sendPhoto(photoBuffer: Buffer, caption: string): Promise<void>;
  sendDocument(fileBuffer: Buffer, filename: string, caption: string): Promise<void>;
}

export function createTelegramNotifier(): Notifier {
  const client = createTelegramClient();
  return {
    sendMessage: client.sendMessage,
    sendPhoto: client.sendPhoto,
    sendDocument: client.sendDocument,
  };
}
