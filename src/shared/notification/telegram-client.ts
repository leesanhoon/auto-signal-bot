import { createLogger } from "../infra/logger.js";
import type { Notifier } from "../notifier.js";

const logger = createLogger("shared:telegram");

export type InlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type TelegramCommand = {
  command: string;
  description: string;
};

function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables are required",
    );
  }
  return { token, chatId, api: `https://api.telegram.org/bot${token}` };
}

async function postTelegramApi(
  path: string,
  payload: Record<string, unknown>,
  errorPrefix: string,
): Promise<void> {
  const { api } = getTelegramConfig();
  const response = await fetch(`${api}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${errorPrefix} failed: ${body}`);
  }
}

export async function sendPhoto(
  photoBuffer: Buffer,
  caption: string,
): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append(
    "photo",
    new Blob([new Uint8Array(photoBuffer)], { type: "image/png" }),
    "chart.png",
  );
  formData.append("caption", caption.slice(0, 1024));

  const response = await fetch(`${api}/sendPhoto`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram sendPhoto failed: ${error}`);
  }
}

export async function sendDocument(
  fileBuffer: Buffer,
  filename: string,
  caption: string,
): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append(
    "document",
    new Blob([new Uint8Array(fileBuffer)], { type: "application/json" }),
    filename,
  );
  formData.append("caption", caption.slice(0, 1024));

  const response = await fetch(`${api}/sendDocument`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram sendDocument failed: ${error}`);
  }
}

export async function setMyCommands(
  commands: TelegramCommand[],
): Promise<void> {
  await postTelegramApi(
    "setMyCommands",
    { commands },
    "Telegram setMyCommands",
  );
}

export async function setChatMenuButton(): Promise<void> {
  await postTelegramApi(
    "setChatMenuButton",
    { menu_button: { type: "commands" } },
    "Telegram setChatMenuButton",
  );
}

export async function notifyError(
  scope: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await sendMessage(
      `🔴 *Lỗi: ${scope}*\n\n\`\`\`\n${message.slice(0, 3500)}\n\`\`\``,
    );
  } catch (notifyErr) {
    logger.error("Failed to send error notification to Telegram:", notifyErr);
  }
}

export async function sendMessage(
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const response = await fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (body.includes("can't parse entities")) {
      const retry = await fetch(`${api}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
      if (!retry.ok) {
        const retryErr = await retry.text();
        throw new Error(`Telegram sendMessage failed: ${retryErr}`);
      }
      return;
    }
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
}

async function editMessageReplyMarkup(
  replyMarkup: InlineKeyboardMarkup | undefined,
  messageId: number,
): Promise<void> {
  const { chatId, api } = getTelegramConfig();
  const response = await fetch(`${api}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram editMessageReplyMarkup failed: ${body}`);
  }
}

export interface TelegramClient {
  sendMessage(text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void>;
  sendPhoto(photoBuffer: Buffer, caption: string): Promise<void>;
  sendDocument(fileBuffer: Buffer, filename: string, caption: string): Promise<void>;
  setMyCommands(commands: TelegramCommand[]): Promise<void>;
  setChatMenuButton(): Promise<void>;
  notifyError(scope: string, error: unknown): Promise<void>;
  editMessageReplyMarkup(replyMarkup: InlineKeyboardMarkup | undefined, messageId: number): Promise<void>;
}

export const telegramNotifier: Notifier = { sendMessage, sendPhoto, sendDocument };

export function createTelegramClient(): TelegramClient {
  return {
    sendMessage,
    sendPhoto,
    sendDocument,
    setMyCommands,
    setChatMenuButton,
    notifyError,
    editMessageReplyMarkup,
  };
}
