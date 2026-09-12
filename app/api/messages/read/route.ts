import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notifyMessagesChanged } from "@/lib/pusher-server";

export const runtime = "nodejs";

const markReadSchema = z.object({
  sender: z.enum(["CHEN", "ZUO"])
});

export async function POST(request: Request) {
  const parsed = markReadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const readAt = new Date();
  const result = await prisma.message.updateMany({
    where: {
      sender: {
        not: parsed.data.sender
      },
      readAt: null
    },
    data: {
      readAt
    }
  });

  if (result.count > 0) {
    after(() =>
      notifyMessagesChanged({
        type: "read",
        reader: parsed.data.sender,
        readAt: readAt.toISOString()
      })
    );
  }

  return NextResponse.json({
    marked: result.count
  });
}
