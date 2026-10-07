"use client";

/* eslint-disable @next/next/no-img-element */

import { ChevronLeft, ChevronRight, Download, Files, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useImageDownload } from "@/lib/image-download-client";

type ImageLightboxProps = {
  imageUrls: string[];
  initialIndex?: number;
  onClose: () => void;
};

export function ImageLightbox({ imageUrls, initialIndex = 0, onClose }: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const safeImageUrls = useMemo(() => imageUrls.filter(Boolean), [imageUrls]);
  const hasMultipleImages = safeImageUrls.length > 1;
  const imageUrl = safeImageUrls[currentIndex] ?? null;
  const downloads = useImageDownload();

  useEffect(() => {
    setCurrentIndex(Math.min(Math.max(initialIndex, 0), Math.max(safeImageUrls.length - 1, 0)));
  }, [initialIndex, safeImageUrls.length]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }

      if (event.key === "ArrowLeft") {
        setCurrentIndex((index) => Math.max(0, index - 1));
      }

      if (event.key === "ArrowRight") {
        setCurrentIndex((index) => Math.min(safeImageUrls.length - 1, index + 1));
      }
    }

    if (imageUrl) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageUrl, onClose, safeImageUrls.length]);

  if (!imageUrl) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="圖片預覽"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4"
      onClick={onClose}
    >
      <header
        className="absolute inset-x-0 top-0 flex h-16 items-center justify-between gap-3 px-4 text-white sm:px-6"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm font-medium">
          相片{" "}
          <span className="ml-2 text-white/50">
            {currentIndex + 1} / {safeImageUrls.length}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={Boolean(downloads.progress)}
            onClick={() => void downloads.download([imageUrl])}
            aria-label="下載這張圖片"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-white/10 px-3 text-sm hover:bg-white/20 disabled:opacity-40"
          >
            <Download size={18} />
            <span className="hidden sm:inline">下載這張</span>
          </button>
          {hasMultipleImages ? (
            <button
              type="button"
              disabled={Boolean(downloads.progress)}
              onClick={() => void downloads.download(safeImageUrls)}
              aria-label="下載整組圖片"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-white/10 px-3 text-sm hover:bg-white/20 disabled:opacity-40"
            >
              <Files size={18} />
              <span className="hidden sm:inline">整組下載</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="關閉圖片預覽"
          >
            <X size={22} />
          </button>
        </div>
      </header>

      {hasMultipleImages && currentIndex > 0 ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setCurrentIndex((index) => Math.max(0, index - 1));
          }}
          className="absolute left-2 top-1/2 z-10 inline-flex h-11 w-9 -translate-y-1/2 items-center justify-center rounded-md bg-black/50 text-white transition hover:bg-white/20 sm:left-6"
          aria-label="上一張"
        >
          <ChevronLeft size={24} />
        </button>
      ) : null}

      <img
        src={imageUrl}
        alt="圖片放大預覽"
        className="max-h-[calc(100dvh-180px)] max-w-[92vw] object-contain"
        onClick={(event) => event.stopPropagation()}
      />

      {hasMultipleImages && currentIndex < safeImageUrls.length - 1 ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setCurrentIndex((index) => Math.min(safeImageUrls.length - 1, index + 1));
          }}
          className="absolute right-2 top-1/2 z-10 inline-flex h-11 w-9 -translate-y-1/2 items-center justify-center rounded-md bg-black/50 text-white transition hover:bg-white/20 sm:right-6"
          aria-label="下一張"
        >
          <ChevronRight size={24} />
        </button>
      ) : null}
      <footer
        className="absolute inset-x-4 bottom-4 flex flex-col items-center gap-3 text-sm text-white/70"
        onClick={(event) => event.stopPropagation()}
      >
        {hasMultipleImages ? (
          <div className="flex max-w-full gap-1.5 overflow-x-auto">
            {safeImageUrls.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => setCurrentIndex(index)}
                aria-label={`預覽第 ${index + 1} 張圖片`}
                aria-pressed={index === currentIndex}
                className={`h-10 w-10 shrink-0 overflow-hidden rounded-md border-2 ${index === currentIndex ? "border-white" : "border-transparent opacity-50"}`}
              >
                <img src={url} alt="相片縮圖" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="min-h-5 text-center text-xs" aria-live="polite">
          {downloads.progress ? (
            <span>
              準備下載 {downloads.progress.completed} / {downloads.progress.total}
              <button type="button" onClick={downloads.cancel} className="ml-3 underline">
                取消下載
              </button>
            </span>
          ) : downloads.error ? (
            <span className="text-rose-300">{downloads.error}</span>
          ) : downloads.ready ? (
            <span>
              檔案已準備好 ·{" "}
              <a href={downloads.ready.url} download={downloads.ready.name} className="text-white underline">
                再次下載
              </a>
            </span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
