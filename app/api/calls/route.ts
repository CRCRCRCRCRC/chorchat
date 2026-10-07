import { NextResponse } from "next/server";
import { serializeCallRecord } from "@/lib/call-records";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const now = new Date();
  const stale = await prisma.callRecord.findMany({
    where: {
      endedAt: null,
      OR: [
        { status: "ringing", startedAt: { lt: new Date(now.getTime() - 30000) } },
        { status: "connecting", lastActivityAt: { lt: new Date(now.getTime() - 60000) } },
        { status: "active", lastActivityAt: { lt: new Date(now.getTime() - 90000) } }
      ]
    },
    take: 100
  });
  await Promise.all(
    stale.map((record) =>
      prisma.callRecord.updateMany({
        where: { id: record.id, endedAt: null, lastActivityAt: record.lastActivityAt, status: record.status },
        data: {
          status: record.status === "ringing" ? "missed" : "failed",
          endedAt:
            record.status === "ringing" ? new Date(record.startedAt.getTime() + 30000) : record.lastActivityAt
        }
      })
    )
  );
  const calls = await prisma.callRecord.findMany({
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: 100
  });
  return NextResponse.json(
    { calls: calls.reverse().map(serializeCallRecord) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
