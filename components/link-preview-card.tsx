"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";

type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

type LinkPreviewCardProps = {
  url: string | null;
};

const MAX_PREVIEW_CACHE_SIZE = 100;
const previewCache = new Map<string, Promise<LinkPreview | null>>();

function getCachedPreview(url: string) {
  const cachedPreview = previewCache.get(url);

  if (cachedPreview) {
    return cachedPreview;
  }

  const previewRequest = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
    cache: "force-cache"
  })
    .then((response) => {
      if (!response.ok) {
        return null;
      }

      return response.json() as Promise<LinkPreview>;
    })
    .catch(() => null);

  previewCache.set(url, previewRequest);

  if (previewCache.size > MAX_PREVIEW_CACHE_SIZE) {
    const oldestUrl = previewCache.keys().next().value;

    if (oldestUrl) {
      previewCache.delete(oldestUrl);
    }
  }

  return previewRequest;
}

export function LinkPreviewCard({ url }: LinkPreviewCardProps) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [visibleUrl, setVisibleUrl] = useState<string | null>(null);
  const placeholderRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!url) {
      return;
    }

    const placeholder = placeholderRef.current;

    if (!placeholder || !("IntersectionObserver" in window)) {
      setVisibleUrl(url);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleUrl(url);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" }
    );

    observer.observe(placeholder);
    return () => observer.disconnect();
  }, [url]);

  useEffect(() => {
    if (!url || visibleUrl !== url) {
      setPreview(null);
      setIsUnavailable(false);
      return;
    }

    const previewUrl = url;
    let isMounted = true;

    async function loadPreview() {
      setPreview(null);
      setIsUnavailable(false);

      const data = await getCachedPreview(previewUrl);

      if (!isMounted) {
        return;
      }

      if (data) {
        setPreview(data);
        return;
      }

      setPreview(null);
      setIsUnavailable(true);
    }

    void loadPreview();

    return () => {
      isMounted = false;
    };
  }, [url, visibleUrl]);

  if (!url || isUnavailable) {
    return null;
  }

  if (visibleUrl !== url || !preview) {
    return <span ref={placeholderRef} className="mt-2 block h-px w-full" aria-hidden="true" />;
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noreferrer"
      className="mt-2 block w-[min(70vw,420px)] overflow-hidden rounded-lg bg-white text-ink shadow-sm transition hover:brightness-95"
    >
      {preview.image ? (
        <img
          src={preview.image}
          alt=""
          className="h-40 w-full bg-black object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <div className="space-y-1 p-3">
        {preview.title ? <p className="line-clamp-2 text-sm font-semibold leading-5">{preview.title}</p> : null}
        {preview.description ? <p className="line-clamp-2 text-xs leading-5 text-slate-600">{preview.description}</p> : null}
        {preview.siteName ? <p className="truncate text-xs uppercase tracking-wide text-slate-500">{preview.siteName}</p> : null}
      </div>
    </a>
  );
}
