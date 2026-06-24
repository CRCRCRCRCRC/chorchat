"use client";

import { useCallback, useEffect, useState } from "react";
import type { PresenceStatus, Sender } from "@/lib/types";

const PRESENCE_REFRESH_MS = 15_000;

export function usePresence(sender: Sender, otherSender: Sender) {
  const [otherPresence, setOtherPresence] = useState<PresenceStatus>({
    sender: otherSender,
    isOnline: false,
    lastSeenAt: null
  });

  const refreshPresence = useCallback(async () => {
    if (document.visibilityState !== "visible") {
      return;
    }

    await fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender })
    }).catch(() => undefined);

    const response = await fetch("/api/presence", { cache: "no-store" }).catch(() => null);

    if (!response?.ok) {
      return;
    }

    const data = (await response.json()) as { statuses: PresenceStatus[] };
    const nextPresence = data.statuses.find((status) => status.sender === otherSender);

    if (nextPresence) {
      setOtherPresence(nextPresence);
    }
  }, [otherSender, sender]);

  useEffect(() => {
    let timer: number | null = null;
    let isStopped = false;

    const schedule = () => {
      if (timer) {
        window.clearTimeout(timer);
      }

      timer = window.setTimeout(() => {
        void refreshPresence().finally(() => {
          if (!isStopped) {
            schedule();
          }
        });
      }, PRESENCE_REFRESH_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPresence();
      }
    };

    void refreshPresence();
    schedule();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    return () => {
      isStopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);

      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [refreshPresence]);

  return otherPresence;
}

export function formatPresence(status: PresenceStatus) {
  if (status.isOnline) {
    return "在線";
  }

  if (!status.lastSeenAt) {
    return "離線";
  }

  const lastSeenAt = new Date(status.lastSeenAt);
  const isToday = lastSeenAt.toDateString() === new Date().toDateString();
  const formatted = new Intl.DateTimeFormat("zh-TW", {
    ...(isToday ? {} : { month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit"
  }).format(lastSeenAt);

  return `最後上線 ${formatted}`;
}
