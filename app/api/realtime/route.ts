import { NextResponse } from "next/server";
import { createProvisionalMessage, messageInputSchema } from "@/lib/message-input";
import { getRealtimeConfig, triggerRealtimeEvent } from "@/lib/pusher-server";
import { PUSHER_EVENT_MESSAGES_CHANGED } from "@/lib/realtime";

export const runtime = "nodejs";

export function GET() {
  const config = getRealtimeConfig();
  return NextResponse.json({ config }, { headers: { "Cache-Control": "no-store" } });
}

// This path deliberately has no Prisma dependency: a cold database cannot delay delivery.
export async function POST(request: Request) {
  const parsed = messageInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.clientId) {
    return NextResponse.json({ error: "Invalid message preview." }, { status: 400 });
  }

  const startedAt = performance.now();
  try {
    const delivered = await triggerRealtimeEvent(PUSHER_EVENT_MESSAGES_CHANGED, {
      type: "created",
      message: createProvisionalMessage(parsed.data)
    });
    return NextResponse.json({ published: delivered }, {
      status: delivered ? 200 : 503,
      headers: { "Server-Timing": `publish;dur=${(performance.now() - startedAt).toFixed(1)}` }
    });
  } catch {
    console.error("Realtime publish failed; check the Pusher credentials and cluster.");
    return NextResponse.json({ error: "Realtime publish failed." }, { status: 502 });
  }
}
