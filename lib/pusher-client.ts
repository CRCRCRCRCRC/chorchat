"use client";

import Pusher from "pusher-js";
import { PUSHER_CHANNEL } from "@/lib/realtime";
import { createRealtimeAssembler, REALTIME_CHUNK_EVENT } from "@/lib/realtime-payload";

let sharedPusher: Pusher | null = null;
let sharedChannel: ReturnType<Pusher["subscribe"]> | null = null;
let consumerCount = 0;
let disconnectTimer: number | null = null;
let connecting: Promise<void> | null = null;

async function connect() {
  const response = await fetch("/api/realtime", { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Realtime configuration unavailable.");
  const { config } = await response.json() as { config: { key: string; cluster: string } | null };
  if (!config) return;

  sharedPusher = new Pusher(config.key, {
    cluster: config.cluster,
    forceTLS: true,
    activityTimeout: 30000,
    pongTimeout: 5000,
    channelAuthorization: { endpoint: "/api/pusher/auth", transport: "ajax" }
  });
  sharedChannel = sharedPusher.subscribe(PUSHER_CHANNEL);
  const channel = sharedChannel;
  channel.bind(REALTIME_CHUNK_EVENT, createRealtimeAssembler((event, data) => channel.emit(event, data)));
}

export async function acquireRealtimeChannel() {

  if (disconnectTimer) {
    window.clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  if (!sharedPusher) {
    connecting ??= connect().catch(() => undefined).finally(() => { connecting = null; });
    await connecting;
  }
  if (!sharedPusher || !sharedChannel) return null;
  consumerCount += 1;
  let isReleased = false;

  return {
    pusher: sharedPusher,
    channel: sharedChannel,
    release() {
      if (isReleased) {
        return;
      }

      isReleased = true;
      consumerCount = Math.max(0, consumerCount - 1);

      if (consumerCount > 0) {
        return;
      }

      disconnectTimer = window.setTimeout(() => {
        if (consumerCount === 0 && sharedPusher) {
          sharedPusher.unsubscribe(PUSHER_CHANNEL);
          sharedPusher.disconnect();
          sharedPusher = null;
          sharedChannel = null;
        }

        disconnectTimer = null;
      }, 1000);
    }
  };
}

export function triggerRealtimeClientEvent(eventName: string, payload: Record<string, unknown>) {
  if (!sharedChannel?.subscribed || sharedPusher?.connection.state !== "connected" ||
    new TextEncoder().encode(JSON.stringify(payload)).length > 9000) {
    return false;
  }

  try {
    return sharedChannel.trigger(eventName, payload);
  } catch (error) {
    console.error("Realtime client event failed", error);
    return false;
  }
}

export function isRealtimeSubscribed(lease: NonNullable<Awaited<ReturnType<typeof acquireRealtimeChannel>>>) {
  return lease.pusher.connection.state === "connected" && lease.channel.subscribed;
}

export function reconnectRealtime() {
  // Reacquiring a lease alone keeps the same socket, including a stalled one.
  sharedPusher?.disconnect();
  sharedPusher?.connect();
}
