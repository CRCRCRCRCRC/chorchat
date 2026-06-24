import Pusher from "pusher";
import { PUSHER_CHANNEL, PUSHER_EVENT_MESSAGES_CHANGED } from "@/lib/realtime";

let pusherServer: Pusher | null = null;

function getPusherServer() {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER ?? process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    return null;
  }

  pusherServer ??= new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true
  });

  return pusherServer;
}

export async function notifyMessagesChanged(payload: {
  type: "created" | "edited" | "recalled" | "read" | "reacted" | "pinned";
  id?: string;
}) {
  try {
    await triggerRealtimeEvent(PUSHER_EVENT_MESSAGES_CHANGED, payload);
  } catch (error) {
    console.error("Message realtime notification failed", error);
  }
}

export async function triggerRealtimeEvent(eventName: string, payload: Record<string, unknown>) {
  const pusher = getPusherServer();

  if (!pusher) {
    return false;
  }

  await pusher.trigger(PUSHER_CHANNEL, eventName, {
    ...payload,
    at: new Date().toISOString()
  });

  return true;
}
