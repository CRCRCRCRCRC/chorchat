"use client";

import Pusher from "pusher-js";
import { PUSHER_CHANNEL } from "@/lib/realtime";

let sharedPusher: Pusher | null = null;
let sharedChannel: ReturnType<Pusher["subscribe"]> | null = null;
let consumerCount = 0;
let disconnectTimer: number | null = null;

export function acquireRealtimeChannel() {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!key || !cluster) {
    return null;
  }

  if (disconnectTimer) {
    window.clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }

  sharedPusher ??= new Pusher(key, { cluster });
  sharedChannel ??= sharedPusher.subscribe(PUSHER_CHANNEL);
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
