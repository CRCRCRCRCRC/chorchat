import { NextResponse } from "next/server";
import { authorizePusherChannel } from "@/lib/pusher-server";
import { PUSHER_CHANNEL } from "@/lib/realtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const socketId = formData.get("socket_id");
  const channelName = formData.get("channel_name");

  if (typeof socketId !== "string" || typeof channelName !== "string") {
    return NextResponse.json({ error: "Invalid Pusher authorization request." }, { status: 400 });
  }

  if (channelName !== PUSHER_CHANNEL) {
    return NextResponse.json({ error: "Channel is not allowed." }, { status: 403 });
  }

  const authorization = authorizePusherChannel(socketId, channelName);

  if (!authorization) {
    return NextResponse.json({ error: "Pusher is not configured." }, { status: 503 });
  }

  return NextResponse.json(authorization);
}
