export type Sender = "CHEN" | "ZUO";

export type Message = {
  id: string;
  sender: Sender;
  text: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  recalledAt: string | null;
  readAt: string | null;
  pinnedAt: string | null;
  pinnedBy: Sender | null;
  replyToMessageId: string | null;
  replyTo?: ReplyMessage | null;
  reactions: MessageReaction[];
  clientStatus?: "sending" | "failed";
};

export type MessageReaction = {
  id: string;
  sender: Sender;
  emoji: string;
  createdAt: string;
};

export type PresenceStatus = {
  sender: Sender;
  isOnline: boolean;
  lastSeenAt: string | null;
};

export type ReplyMessage = {
  id: string;
  sender: Sender;
  text: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  createdAt: string;
  editedAt: string | null;
  recalledAt: string | null;
};

export const SENDER_LABEL: Record<Sender, string> = {
  CHEN: "陳",
  ZUO: "左"
};

export const OTHER_SENDER: Record<Sender, Sender> = {
  CHEN: "ZUO",
  ZUO: "CHEN"
};

export function isSender(value: unknown): value is Sender {
  return value === "CHEN" || value === "ZUO";
}
