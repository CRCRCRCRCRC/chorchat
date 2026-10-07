"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeCallRecords, type CallHistoryRecord } from "@/lib/call";

export function useCallHistory() {
  const [calls, setCalls] = useState<CallHistoryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pendingRef = useRef<Promise<void> | null>(null);
  const mergeRecord = useCallback((record: CallHistoryRecord) => {
    setCalls((current) => mergeCallRecords(current, [record]));
  }, []);
  const refresh = useCallback(() => {
    if (pendingRef.current) return pendingRef.current;
    const request = (async () => {
      try {
        const response = await fetch("/api/calls", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("通話紀錄載入失敗，請重試。");
        const data = (await response.json()) as { calls?: CallHistoryRecord[] };
        setCalls((current) => mergeCallRecords(current, data.calls ?? []));
        setError(null);
      } catch {
        setError("通話紀錄載入失敗，請重試。");
      } finally {
        setLoading(false);
        pendingRef.current = null;
      }
    })();
    pendingRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (!stopped && !document.hidden)
        timer = window.setTimeout(() => {
          void refresh().then(schedule);
        }, 20000);
    };
    const resume = () => {
      window.clearTimeout(timer);
      if (!document.hidden) void refresh().then(schedule);
    };
    void refresh().then(schedule);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);
  return { calls, error, loading, refresh, mergeRecord };
}
