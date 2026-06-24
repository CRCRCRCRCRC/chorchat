import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

const messageInputSchema = z
  .object({
    sender: z.enum(["CHEN", "ZUO"]),
    text: z.string().trim().max(4000).optional(),
    imageUrl: z.string().url().optional(),
    imageUrls: z.array(z.string().url()).max(30).optional(),
    replyToMessageId: z.string().cuid().optional()
  })
  .refine((data) => Boolean(data.text?.trim() || data.imageUrl || data.imageUrls?.length), {
    message: "Message needs text or image."
  });

const createMessageSchema = z.union([
  messageInputSchema,
  z.object({
    messages: z.array(messageInputSchema).min(1).max(10)
  })
]);

const messageInclude = {
  replyTo: {
    select: {
      id: true,
      sender: true,
      text: true,
      imageUrl: true,
      imageUrls: true,
      createdAt: true,
      editedAt: true,
      recalledAt: true
    }
  }
} as const;

type MessageInput = z.infer<typeof messageInputSchema>;

function getMessageInputs(data: z.infer<typeof createMessageSchema>) {
  return "messages" in data ? data.messages : [data];
}

function getImageUrls(message: MessageInput) {
  const urls = message.imageUrls?.length ? message.imageUrls : message.imageUrl ? [message.imageUrl] : [];
  return urls.slice(0, 30);
}

export async function GET() {
  const messages = await prisma.message.findMany({
    orderBy: {
      createdAt: "asc"
    },
    include: messageInclude
  });

  return NextResponse.json({ messages });
}

export async function POST(request: Request) {
  const parsed = createMessageSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const messageInputs = getMessageInputs(parsed.data);
  const replyTargetIds = [
    ...new Set(
      messageInputs
        .map((message) => message.replyToMessageId)
        .filter((replyToMessageId): replyToMessageId is string => Boolean(replyToMessageId))
    )
  ];

  if (replyTargetIds.length > 0) {
    const repliedMessages = await prisma.message.findMany({
      where: {
        id: {
          in: replyTargetIds
        }
      },
      select: { id: true }
    });

    if (repliedMessages.length !== replyTargetIds.length) {
      return NextResponse.json({ error: "Reply target does not exist." }, { status: 400 });
    }
  }

  const messages = await prisma.$transaction(
    messageInputs.map((message: MessageInput) =>
      prisma.message.create({
        data: {
          imageUrls: getImageUrls(message),
          sender: message.sender,
          text: message.text?.trim() || null,
          imageUrl: getImageUrls(message)[0] ?? null,
          replyToMessageId: message.replyToMessageId ?? null
        },
        include: messageInclude
      })
    )
  );

  await notifyMessagesChanged({ type: "created", id: messages[0]?.id });

  if ("messages" in parsed.data) {
    return NextResponse.json({ messages }, { status: 201 });
  }

  return NextResponse.json({ message: messages[0] }, { status: 201 });
}
