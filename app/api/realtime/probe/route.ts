import { NextResponse } from "next/server";
import { z } from "zod";
import { triggerRealtimeEvent } from "@/lib/pusher-server";
import { PUSHER_EVENT_PROBE } from "@/lib/realtime";

export const runtime = "nodejs";

const probeSchema = z.object({ token: z.string().uuid() }).strict();

// Verify the actual server-to-browser path without reading or writing chat data.
export async function POST(request: Request) {
  const parsed = probeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid probe." }, { status: 400 });

  try {
    const published = await triggerRealtimeEvent(PUSHER_EVENT_PROBE, { token: parsed.data.token });
    return NextResponse.json({ published }, { status: published ? 200 : 503 });
  } catch {
    return NextResponse.json({ error: "Probe publish failed." }, { status: 502 });
  }
}
