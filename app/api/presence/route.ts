import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const presenceSchema = z.object({
  sender: z.enum(["CHEN", "ZUO"])
});

const ONLINE_WINDOW_MS = 45_000;

export async function GET() {
  const rows = await prisma.presence.findMany();
  const rowBySender = new Map(rows.map((row) => [row.sender, row]));
  const now = Date.now();
  const statuses = (["CHEN", "ZUO"] as const).map((sender) => {
    const row = rowBySender.get(sender);

    return {
      sender,
      isOnline: Boolean(row && now - row.lastSeenAt.getTime() <= ONLINE_WINDOW_MS),
      lastSeenAt: row?.lastSeenAt ?? null
    };
  });

  return NextResponse.json({ statuses });
}

export async function POST(request: Request) {
  const parsed = presenceSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const presence = await prisma.presence.upsert({
    where: { sender: parsed.data.sender },
    create: { sender: parsed.data.sender },
    update: { lastSeenAt: new Date() }
  });

  return NextResponse.json({ presence });
}
