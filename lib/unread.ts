import { messageIdentity } from "@/lib/message-sync";
import type { Message, Sender } from "@/lib/types";

export function firstUnreadIdentity(messages: Message[], sender: Sender) {
  const first = messages.find(
    (message) =>
      message.sender !== sender && !message.readAt && !message.recalledAt && message.clientStatus !== "failed"
  );
  return first ? messageIdentity(first) : null;
}

export function unreadBoundary(messages: Message[], sender: Sender, anchor: string | null) {
  if (!anchor) return null;
  const start = messages.findIndex((message) => messageIdentity(message) === anchor);
  if (start < 0) return null;
  const incoming = messages
    .slice(start)
    .filter(
      (message) => message.sender !== sender && !message.recalledAt && message.clientStatus !== "failed"
    );
  return incoming.length ? { id: messageIdentity(incoming[0]), count: incoming.length } : null;
}
