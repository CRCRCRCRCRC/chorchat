import { after, NextResponse } from "next/server";
import { z } from "zod";
import { messageInclude } from "@/lib/message-query";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";
import { REACTION_EMOJIS } from "@/lib/reactions";

export const runtime = "nodejs";

const reactionSchema = z.object({
  sender: z.enum(["CHEN", "ZUO"]),
  emoji: z.enum(REACTION_EMOJIS)
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = reactionSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const message = await prisma.message.findUnique({
    where: { id },
    select: { id: true, recalledAt: true }
  });

  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  if (message.recalledAt) {
    return NextResponse.json({ error: "Recalled messages cannot be reacted to." }, { status: 409 });
  }

  const reactionKey = {
    messageId: id,
    sender: parsed.data.sender,
    emoji: parsed.data.emoji
  };
  const existingReaction = await prisma.messageReaction.findUnique({
    where: {
      messageId_sender_emoji: reactionKey
    },
    select: { id: true }
  });

  if (existingReaction) {
    await prisma.messageReaction.delete({ where: { id: existingReaction.id } });
  } else {
    await prisma.messageReaction.create({ data: reactionKey });
  }

  const updatedMessage = await prisma.message.findUnique({
    where: { id },
    include: messageInclude
  });

  after(() => notifyMessagesChanged({ type: "reacted", id }));
  return NextResponse.json({ message: updatedMessage });
}
