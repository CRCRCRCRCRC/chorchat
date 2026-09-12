import type { Message, Sender } from "@/lib/types";

export const PUSHER_CHANNEL = "private-chorchat-main";
export const PUSHER_EVENT_MESSAGES_CHANGED = "messages:changed";
export const PUSHER_EVENT_TYPING_CHANGED = "typing:changed";
export const PUSHER_EVENT_CALL_SIGNAL = "call:signal";
export const PUSHER_EVENT_CLIENT_MESSAGE_PREVIEW = "client-message-preview";
export const PUSHER_EVENT_CLIENT_MESSAGE_FAILED = "client-message-failed";

export type ClientMessagePreviewEvent = {
  messages: Message[];
};

export type ClientMessageFailedEvent = {
  clientIds: string[];
};

export type MessagesChangedEvent = {
  type: "created" | "edited" | "recalled" | "read" | "reacted" | "pinned" | "failed";
  id?: string;
  clientId?: string;
  clientIds?: string[];
  message?: Message;
  messages?: Message[];
  reader?: Sender;
  readAt?: string;
  at?: string;
};
