"use client";

import { useCallback, useEffect, useRef } from "react";
import { playMessageNotificationSound } from "@/lib/audio-client";

export function useMessageNotificationSound() {
  const pendingRef = useRef<(() => void) | null>(null);

  useEffect(() => () => pendingRef.current?.(), []);

  return useCallback(() => {
    // Coalesce messages arriving in the same frame without postponing that frame.
    if (pendingRef.current) return;

    let firstFrame = 0;
    let secondFrame = 0;

    function cancel() {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      pendingRef.current = null;
    }

    function play() {
      cancel();
      void playMessageNotificationSound();
    }

    function handleVisibilityChange() {
      // Background tabs pause animation frames, but must still receive alerts.
      if (document.hidden) play();
    }

    pendingRef.current = cancel;
    if (document.hidden) {
      play();
      return;
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    // Allow a paint between the committed message/unread UI and the sound.
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(play);
    });
  }, []);
}
