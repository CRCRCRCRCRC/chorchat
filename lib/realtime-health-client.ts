"use client";

import { isRealtimeSubscribed, reconnectRealtime, type acquireRealtimeChannel } from "@/lib/pusher-client";
import { PUSHER_EVENT_PROBE } from "@/lib/realtime";

export type RealtimeHealth = {
  state: "checking" | "healthy" | "degraded";
  reason: "disconnected" | "publish-failed" | "receive-timeout" | null;
  roundTripMs: number | null;
};

type Lease = NonNullable<Awaited<ReturnType<typeof acquireRealtimeChannel>>>;

export function monitorRealtimeHealth(lease: Lease, onChange: (health: RealtimeHealth) => void) {
  let stopped = false;
  let timer: number | undefined;
  let deadline: number | undefined;
  let controller: AbortController | null = null;
  let token: string | null = null;
  let startedAt = 0;
  let nextReconnectAt = 0;
  let state: RealtimeHealth["state"] = "checking";

  function clearPending() {
    token = null;
    window.clearTimeout(deadline);
    controller?.abort();
    controller = null;
  }

  function schedule(delay: number) {
    window.clearTimeout(timer);
    if (!stopped && !document.hidden) timer = window.setTimeout(check, delay);
  }

  function finish(health: RealtimeHealth) {
    clearPending();
    if (stopped) return;
    state = health.state;
    onChange(health);
    schedule(health.state === "healthy" ? 20000 : 5000);

    // Only a successful publish with no matching incoming event proves a broken receive path.
    if (health.reason === "receive-timeout" && performance.now() >= nextReconnectAt) {
      nextReconnectAt = performance.now() + 10000;
      reconnectRealtime();
    }
  }

  function check() {
    if (stopped || token || document.hidden) return;
    if (!isRealtimeSubscribed(lease)) {
      finish({ state: "degraded", reason: "disconnected", roundTripMs: null });
      return;
    }
    if (state !== "healthy") onChange({ state: "checking", reason: null, roundTripMs: null });
    const probeToken = crypto.randomUUID();
    token = probeToken;
    startedAt = performance.now();
    controller = new AbortController();
    deadline = window.setTimeout(() => finish({ state: "degraded", reason: "publish-failed", roundTripMs: null }), 5000);

    void fetch("/api/realtime/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: probeToken }),
      signal: controller.signal
    }).then((response) => {
      if (stopped || token !== probeToken) return;
      if (!response.ok) {
        finish({ state: "degraded", reason: "publish-failed", roundTripMs: null });
        return;
      }
      window.clearTimeout(deadline);
      deadline = window.setTimeout(() => finish({ state: "degraded", reason: "receive-timeout", roundTripMs: null }), 1500);
    }).catch(() => {
      if (!stopped && token === probeToken) finish({ state: "degraded", reason: "publish-failed", roundTripMs: null });
    });
  }

  function handleProbe(event: { token?: string }) {
    if (token && event?.token === token) {
      finish({ state: "healthy", reason: null, roundTripMs: Math.round(performance.now() - startedAt) });
    }
  }

  function handleConnectionChange() {
    if (!isRealtimeSubscribed(lease)) {
      finish({ state: "degraded", reason: "disconnected", roundTripMs: null });
    } else {
      check();
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearPending();
      window.clearTimeout(timer);
    } else {
      check();
    }
  }

  lease.channel.bind(PUSHER_EVENT_PROBE, handleProbe);
  lease.channel.bind("pusher:subscription_succeeded", handleConnectionChange);
  lease.pusher.connection.bind("state_change", handleConnectionChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("online", handleConnectionChange);
  check();

  return {
    check,
    stop() {
      stopped = true;
      clearPending();
      window.clearTimeout(timer);
      lease.channel.unbind(PUSHER_EVENT_PROBE, handleProbe);
      lease.channel.unbind("pusher:subscription_succeeded", handleConnectionChange);
      lease.pusher.connection.unbind("state_change", handleConnectionChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleConnectionChange);
    }
  };
}
