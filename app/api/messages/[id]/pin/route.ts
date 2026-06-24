import { after, NextResponse } from "next/server";
import { z } from "zod";
import { messageInclude } from "@/lib/message-query";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

const pinSchema = z.object({
  sender: z.enum(["CHEN", "ZUO"]),
  pinned: z.boolean()
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = pinSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existingMessage = await prisma.message.findUnique({
    where: { id },
    select: { id: true, recalledAt: true }
  });

  if (!existingMessage) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  if (parsed.data.pinned && existingMessage.recalledAt) {
    return NextResponse.json({ error: "Recalled messages cannot be pinned." }, { status: 409 });
  }

  const message = await prisma.message.update({
    where: { id },
    data: parsed.data.pinned
      ? { pinnedAt: new Date(), pinnedBy: parsed.data.sender }
      : { pinnedAt: null, pinnedBy: null },
    include: messageInclude
  });

  after(() => notifyMessagesChanged({ type: "pinned", id }));
  return NextResponse.json({ message });
}
