import { after, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCallRecordUpdate, serializeCallRecord } from "@/lib/call-records";
import type { CallSignal } from "@/lib/call";
import { PUSHER_EVENT_CALL_SIGNAL, PUSHER_EVENT_CALLS_CHANGED } from "@/lib/realtime";
import { triggerRealtimeEvent } from "@/lib/pusher-server";

export const runtime = "nodejs";

const callSignalSchema = z.object({
  type: z.enum([
    "call-request",
    "call-accept",
    "call-reject",
    "call-connected",
    "call-heartbeat",
    "offer",
    "answer",
    "ice-candidate",
    "hangup"
  ]),
  callId: z.string().min(8).max(120),
  from: z.enum(["CHEN", "ZUO"]),
  to: z.enum(["CHEN", "ZUO"]),
  payload: z
    .object({ reason: z.enum(["missed", "declined", "cancelled", "failed"]).optional() })
    .passthrough()
    .optional()
});

const getCallSignalsSchema = z.object({
  to: z.enum(["CHEN", "ZUO"]),
  since: z.string().datetime().optional()
});

function toJsonPayload(payload: unknown) {
  if (payload === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

function serializeSignal(signal: {
  id: string;
  type: string;
  callId: string;
  from: "CHEN" | "ZUO";
  to: "CHEN" | "ZUO";
  payload: Prisma.JsonValue | null;
  createdAt: Date;
}) {
  return {
    id: signal.id,
    type: signal.type,
    callId: signal.callId,
    from: signal.from,
    to: signal.to,
    payload: signal.payload ?? undefined,
    createdAt: signal.createdAt.toISOString()
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = getCallSignalsSchema.safeParse({
    to: searchParams.get("to"),
    since: searchParams.get("since") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const since = parsed.data.since ? new Date(parsed.data.since) : new Date(Date.now() - 10_000);
  const signals = await prisma.callSignal.findMany({
    where: {
      to: parsed.data.to,
      createdAt: {
        gt: since
      }
    },
    orderBy: {
      createdAt: "asc"
    },
    take: 100
  });

  const records = signals.length
    ? await prisma.callRecord.findMany({
        where: { id: { in: [...new Set(signals.map((signal) => signal.callId))] } }
      })
    : [];
  const byId = new Map(records.map((record) => [record.id, serializeCallRecord(record)]));
  return NextResponse.json(
    {
      signals: signals.map((signal) => ({ ...serializeSignal(signal), record: byId.get(signal.callId) }))
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const parsed = callSignalSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.from === parsed.data.to) {
    return NextResponse.json({ error: "Caller and recipient must be different." }, { status: 400 });
  }

  const payload = toJsonPayload(parsed.data.payload);
  const { type, callId, from, to } = parsed.data;
  const result = await prisma.$transaction(async (tx) => {
    if (type === "call-request") {
      await tx.callRecord.upsert({
        where: { id: callId },
        update: {},
        create: { id: callId, caller: from, callee: to }
      });
    }
    // Serialize opposing hangups and answers so a completed record cannot reopen.
    await tx.$queryRaw`SELECT id FROM call_records WHERE id = ${callId} FOR UPDATE`;
    const record = await tx.callRecord.findUnique({ where: { id: callId } });
    if (!record) return null;
    const validParticipants =
      (record.caller === from && record.callee === to) || (record.callee === from && record.caller === to);
    if (
      !validParticipants ||
      (type === "call-request" && record.caller !== from) ||
      (["call-accept", "call-reject"].includes(type) && record.callee !== from)
    )
      return null;
    if (record.endedAt) return { record, signal: null, changed: false };
    const update = getCallRecordUpdate(record, parsed.data as CallSignal, new Date());
    const nextRecord = update ? await tx.callRecord.update({ where: { id: callId }, data: update }) : record;
    const signal = await tx.callSignal.create({
      data: { type, callId, from, to, ...(payload === undefined ? {} : { payload }) }
    });
    return { record: nextRecord, signal, changed: type === "call-request" || Boolean(update) };
  });
  if (!result)
    return NextResponse.json({ error: "Call not found or invalid participants." }, { status: 400 });
  const record = serializeCallRecord(result.record);
  if (!result.signal) return NextResponse.json({ ok: true, record });
  const serializedSignal = { ...serializeSignal(result.signal), record };
  let didTrigger = false;

  try {
    if (type !== "call-heartbeat")
      didTrigger = await triggerRealtimeEvent(PUSHER_EVENT_CALL_SIGNAL, serializedSignal);
  } catch (error) {
    console.error("Call signal failed", error);
  }

  if (result.changed && type !== "call-heartbeat") {
    after(async () => {
      await triggerRealtimeEvent(PUSHER_EVENT_CALLS_CHANGED, { record }).catch(() => undefined);
    });
  }
  if (Math.random() < 0.03) {
    after(() =>
      prisma.callSignal
        .deleteMany({
          where: {
            createdAt: {
              lt: new Date(Date.now() - 60 * 60 * 1000)
            }
          }
        })
        .catch((error) => console.error("Old call signal cleanup failed", error))
    );
  }

  return NextResponse.json({ ok: true, realtime: didTrigger, signal: serializedSignal, record });
}
