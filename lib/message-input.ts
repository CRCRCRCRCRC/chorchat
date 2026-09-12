import { z } from "zod";
import type { Message } from "@/lib/types";

export const messageInputSchema = z
  .object({
    sender: z.enum(["CHEN", "ZUO"]),
    clientId: z.string().max(100).regex(/^optimistic-[a-zA-Z0-9-]{8,}$/).optional(),
    text: z.string().trim().max(4000).optional(),
    imageUrl: z.string().url().max(2048).optional(),
    imageUrls: z.array(z.string().url().max(2048)).max(30).optional(),
    replyToMessageId: z.string().cuid().optional()
  })
  .refine((data) => Boolean(data.text?.trim() || data.imageUrl || data.imageUrls?.length), {
    message: "Message needs text or image."
  });

export type MessageInput = z.infer<typeof messageInputSchema>;

export function getImageUrls(message: MessageInput) {
  return message.imageUrls?.length ? message.imageUrls : message.imageUrl ? [message.imageUrl] : [];
}

export function createProvisionalMessage(message: MessageInput): Message | null {
  if (!message.clientId) return null;

  const imageUrls = getImageUrls(message);
  const createdAt = new Date().toISOString();
  return {
    id: message.clientId,
    sender: message.sender,
    text: message.text?.trim() || null,
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    createdAt,
    updatedAt: createdAt,
    editedAt: null,
    recalledAt: null,
    readAt: null,
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: message.replyToMessageId ?? null,
    replyTo: null,
    reactions: [],
    clientStatus: "sending"
  };
}
