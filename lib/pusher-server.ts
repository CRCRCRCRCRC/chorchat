import Pusher from "pusher";
import { Agent } from "node:https";
import { encodeRealtimePayload } from "@/lib/realtime-payload";
import { PUSHER_CHANNEL, PUSHER_EVENT_MESSAGES_CHANGED } from "@/lib/realtime";

let pusherServer: Pusher | null = null;

export function getRealtimeConfig() {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY?.trim();
  const cluster = (process.env.PUSHER_CLUSTER || process.env.NEXT_PUBLIC_PUSHER_CLUSTER)?.trim();
  return key && cluster && process.env.PUSHER_APP_ID && process.env.PUSHER_SECRET ? { key, cluster } : null;
}

function getPusherServer() {
  const appId = process.env.PUSHER_APP_ID;
  const secret = process.env.PUSHER_SECRET;
  const config = getRealtimeConfig();

  if (!appId || !secret || !config) {
    return null;
  }

  pusherServer ??= new Pusher({
    appId,
    key: config.key,
    secret,
    cluster: config.cluster,
    useTLS: true,
    timeout: 2500,
    agent: new Agent({ keepAlive: true })
  });

  return pusherServer;
}

export function authorizePusherChannel(socketId: string, channelName: string) {
  const pusher = getPusherServer();
  return pusher?.authorizeChannel(socketId, channelName) ?? null;
}

export async function notifyMessagesChanged(payload: {
  type: "created" | "edited" | "recalled" | "read" | "reacted" | "pinned" | "failed";
  id?: string;
  clientId?: string;
  clientIds?: string[];
  message?: unknown;
  messages?: unknown[];
  reader?: "CHEN" | "ZUO";
  readAt?: string;
}) {
  try {
    await triggerRealtimeEvent(PUSHER_EVENT_MESSAGES_CHANGED, payload);
  } catch (error) {
    console.error("Message realtime notification failed", error instanceof Error ? error.message : "Unknown error");
  }
}

export async function triggerRealtimeEvent(eventName: string, payload: Record<string, unknown>) {
  const pusher = getPusherServer();

  if (!pusher) {
    return false;
  }

  const event = {
    ...payload,
    at: new Date().toISOString()
  };
  const parts = encodeRealtimePayload(eventName, event);
  if (parts.length === 1) {
    await pusher.trigger(PUSHER_CHANNEL, parts[0].name, parts[0].data);
  } else {
    const batches = [];
    for (let offset = 0; offset < parts.length; offset += 10) {
      batches.push(pusher.triggerBatch(parts.slice(offset, offset + 10).map((part) => ({
        channel: PUSHER_CHANNEL, name: part.name, data: part.data
      }))));
    }
    await Promise.all(batches);
  }

  return true;
}
