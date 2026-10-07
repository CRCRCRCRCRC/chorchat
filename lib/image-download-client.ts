"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareImageDownload } from "@/lib/image-download";

export function useImageDownload() {
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<{ url: string; name: string } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setProgress(null);
  }, []);
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );
  const download = useCallback(async (urls: string[]) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setProgress({ completed: 0, total: new Set(urls).size });
    setError(null);
    setReady(null);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    try {
      const result = await prepareImageDownload(urls, controller.signal, (completed, total) => {
        if (controllerRef.current === controller) setProgress({ completed, total });
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      setReady({ url, name: result.name });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (downloadError) {
      if (!controller.signal.aborted)
        setError(downloadError instanceof Error ? downloadError.message : "圖片下載失敗，請重試。");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setProgress(null);
      }
    }
  }, []);
  return { download, progress, error, ready, cancel };
}
