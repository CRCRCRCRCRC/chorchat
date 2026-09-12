import { after, NextResponse } from "next/server";
import { z } from "zod";
import { storedMessageId } from "@/lib/message-identity";
import { getImageUrls, messageInputSchema, type MessageInput } from "@/lib/message-input";
import { messageInclude } from "@/lib/message-query";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

const createMessageSchema = z.union([
  messageInputSchema,
  z.object({
    messages: z.array(messageInputSchema).min(1).max(10)
  })
]);

function getMessageInputs(data: z.infer<typeof createMessageSchema>) {
  return "messages" in data ? data.messages : [data];
}

function createStoredMessage(message: MessageInput, createdAt: Date) {
  const imageUrls = getImageUrls(message);

  return prisma.message.create({
    data: {
      id: message.clientId ? storedMessageId(message.clientId, message.sender) : undefined,
      createdAt,
      imageUrls,
      sender: message.sender,
      text: message.text?.trim() || null,
      imageUrl: imageUrls[0] ?? null,
      replyToMessageId: message.replyToMessageId ?? null
    },
    include: messageInclude
  });
}

export async function GET() {
  const messages = await prisma.message.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: messageInclude
  });

  return NextResponse.json({ messages });
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  const receivedAt = Date.now();
  const parsed = createMessageSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const messageInputs = getMessageInputs(parsed.data);
  const clientIds = messageInputs
    .map((message) => message.clientId)
    .filter((clientId): clientId is string => Boolean(clientId));
  const replyTargetIds = [
    ...new Set(
      messageInputs
        .map((message) => message.replyToMessageId)
        .filter((replyToMessageId): replyToMessageId is string => Boolean(replyToMessageId))
    )
  ];

  let messages: Awaited<ReturnType<typeof createStoredMessage>>[];

  try {
    if (replyTargetIds.length > 0) {
      const repliedMessages = await prisma.message.findMany({
        where: { id: { in: replyTargetIds } },
        select: { id: true }
      });

      if (repliedMessages.length !== replyTargetIds.length) {
        after(() => notifyMessagesChanged({ type: "failed", clientIds }));
        return NextResponse.json({ error: "Reply target does not exist." }, { status: 400 });
      }
    }

    messages = messageInputs.length === 1
      ? [await createStoredMessage(messageInputs[0], new Date(receivedAt))]
      : await prisma.$transaction(messageInputs.map((message, index) =>
          createStoredMessage(message, new Date(receivedAt + index))
        ));
  } catch (error) {
    if (clientIds.length > 0) {
      after(() => notifyMessagesChanged({ type: "failed", clientIds }));
    }

    throw error;
  }

  after(() =>
    notifyMessagesChanged({
      type: "created",
      id: messages[0]?.id,
      clientId: clientIds.length === 1 ? clientIds[0] : undefined,
      clientIds: clientIds.length > 1 ? clientIds : undefined,
      message: messages.length === 1 ? messages[0] : undefined,
      messages: messages.length > 1 ? messages : undefined
    })
  );

  return NextResponse.json("messages" in parsed.data ? { messages } : { message: messages[0] }, {
    status: 201,
    headers: { "Server-Timing": `persist;dur=${(performance.now() - startedAt).toFixed(1)}` }
  });
}
