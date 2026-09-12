import { storedMessageId } from "@/lib/message-identity";
import type { Message } from "@/lib/types";

export function sortMessagesByCreatedAt(messages: Message[]) {
  return [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function messageIdentity(message: Message) {
  return message.id.startsWith("optimistic-") ? storedMessageId(message.id, message.sender) : message.id;
}

export function mergeRealtimeMessages(current: Message[], incoming: Message[], replacedClientIds: string[] = []) {
  const replacedIds = new Set(replacedClientIds);
  const byId = new Map(current.filter((message) => !replacedIds.has(message.id)).map((message) => [messageIdentity(message), message]));

  for (const message of incoming) {
    const key = messageIdentity(message);
    const previous = byId.get(key);
    // Late previews and old polling responses must never undo a saved message.
    if (previous && ((!previous.clientStatus && message.clientStatus) ||
      (previous.clientStatus === message.clientStatus && previous.updatedAt > message.updatedAt))) continue;

    const next = {
      ...message,
      imageUrls: message.imageUrls ?? (message.imageUrl ? [message.imageUrl] : []),
      reactions: message.reactions ?? [],
      readAt: message.readAt ?? previous?.readAt ?? null
    };
    byId.set(key, previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }

  const merged = sortMessagesByCreatedAt([...byId.values()]);
  return current.length === merged.length && current.every((message, index) => message === merged[index]) ? current : merged;
}

// Messages are recalled, never hard-deleted; retain events newer than a GET snapshot.
export const mergeLoadedMessages = mergeRealtimeMessages;
