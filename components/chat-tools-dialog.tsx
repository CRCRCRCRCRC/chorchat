"use client";

/* eslint-disable @next/next/no-img-element */

import { Image as ImageIcon, Link2, Pin, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { extractUrls } from "@/lib/links";
import { getMessageImageUrls } from "@/lib/messages";
import { SENDER_LABEL, type Message } from "@/lib/types";

export type ChatToolMode = "search" | "media" | "pinned";

type ChatToolsDialogProps = {
  mode: ChatToolMode;
  messages: Message[];
  onClose: () => void;
  onFocusMessage: (messageId: string) => void;
  onOpenImages: (urls: string[], index: number) => void;
};

function formatToolTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getMessagePreview(message: Message) {
  if (message.text?.trim()) {
    return message.text.trim();
  }

  const imageCount = getMessageImageUrls(message).length;
  return imageCount > 0 ? `${imageCount} 張圖片` : "訊息";
}

export function ChatToolsDialog({
  mode,
  messages,
  onClose,
  onFocusMessage,
  onOpenImages
}: ChatToolsDialogProps) {
  const [query, setQuery] = useState("");
  const [mediaTab, setMediaTab] = useState<"images" | "links">("images");
  const availableMessages = useMemo(
    () => messages.filter((message) => !message.recalledAt && !message.clientStatus),
    [messages]
  );
  const searchResults = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");

    if (!normalizedQuery) {
      return [];
    }

    return availableMessages
      .filter((message) => message.text?.toLocaleLowerCase("zh-TW").includes(normalizedQuery))
      .slice(-100)
      .reverse();
  }, [availableMessages, query]);
  const imageItems = useMemo(
    () =>
      availableMessages
        .flatMap((message) =>
          getMessageImageUrls(message).map((url, index, urls) => ({ message, url, index, urls }))
        )
        .reverse(),
    [availableMessages]
  );
  const linkItems = useMemo(
    () =>
      availableMessages
        .flatMap((message) => extractUrls(message.text).map((url) => ({ message, url })))
        .reverse(),
    [availableMessages]
  );
  const pinnedMessages = useMemo(
    () =>
      availableMessages
        .filter((message) => message.pinnedAt)
        .sort((first, second) => new Date(second.pinnedAt ?? 0).getTime() - new Date(first.pinnedAt ?? 0).getTime()),
    [availableMessages]
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function focusMessage(messageId: string) {
    onClose();
    window.requestAnimationFrame(() => onFocusMessage(messageId));
  }

  const title = mode === "search" ? "搜尋訊息" : mode === "media" ? "媒體資料庫" : "置頂訊息";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-soft"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-ink"
            aria-label="關閉"
          >
            <X size={19} />
          </button>
        </header>

        {mode === "search" ? (
          <>
            <div className="border-b border-line p-3">
              <label className="flex items-center gap-2 rounded-md border border-line bg-slate-50 px-3 focus-within:border-brand focus-within:bg-white focus-within:ring-4 focus-within:ring-brand/10">
                <Search size={18} className="shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜尋文字訊息"
                  className="h-11 min-w-0 flex-1 bg-transparent outline-none"
                />
              </label>
            </div>
            <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
              {!query.trim() ? (
                <p className="py-12 text-center text-sm text-slate-500">輸入關鍵字開始搜尋</p>
              ) : searchResults.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-500">找不到相關訊息</p>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((message) => (
                    <button
                      key={message.id}
                      type="button"
                      onClick={() => focusMessage(message.id)}
                      className="block w-full rounded-md border border-line px-3 py-3 text-left hover:border-brand hover:bg-slate-50"
                    >
                      <span className="mb-1 flex items-center justify-between gap-3 text-xs text-slate-500">
                        <span>{SENDER_LABEL[message.sender]}</span>
                        <span>{formatToolTime(message.createdAt)}</span>
                      </span>
                      <span className="line-clamp-2 break-words text-sm text-ink">{getMessagePreview(message)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}

        {mode === "media" ? (
          <>
            <div className="flex shrink-0 gap-2 border-b border-line p-3">
              <button
                type="button"
                onClick={() => setMediaTab("images")}
                className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${
                  mediaTab === "images" ? "bg-brand text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                <ImageIcon size={16} />圖片 ({imageItems.length})
              </button>
              <button
                type="button"
                onClick={() => setMediaTab("links")}
                className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${
                  mediaTab === "links" ? "bg-brand text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                <Link2 size={16} />連結 ({linkItems.length})
              </button>
            </div>
            <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
              {mediaTab === "images" ? (
                imageItems.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
                    {imageItems.map((item) => (
                      <button
                        key={`${item.message.id}-${item.index}`}
                        type="button"
                        onClick={() => onOpenImages(item.urls, item.index)}
                        className="aspect-square overflow-hidden rounded-md bg-slate-100 focus:outline-none focus:ring-4 focus:ring-brand/20"
                        aria-label={`開啟 ${SENDER_LABEL[item.message.sender]} 傳送的圖片`}
                      >
                        <img src={item.url} alt="聊天媒體" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="py-12 text-center text-sm text-slate-500">沒有圖片</p>
                )
              ) : linkItems.length > 0 ? (
                <div className="space-y-2">
                  {linkItems.map((item, index) => (
                    <div key={`${item.message.id}-${item.url}-${index}`} className="rounded-md border border-line p-3">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all text-sm font-medium text-brand underline underline-offset-2"
                      >
                        {item.url}
                      </a>
                      <button
                        type="button"
                        onClick={() => focusMessage(item.message.id)}
                        className="mt-2 text-xs text-slate-500 hover:text-brand"
                      >
                        {SENDER_LABEL[item.message.sender]} · {formatToolTime(item.message.createdAt)} · 查看訊息
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-slate-500">沒有連結</p>
              )}
            </div>
          </>
        ) : null}

        {mode === "pinned" ? (
          <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            {pinnedMessages.length > 0 ? (
              <div className="space-y-2">
                {pinnedMessages.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => focusMessage(message.id)}
                    className="block w-full rounded-md border border-line px-3 py-3 text-left hover:border-brand hover:bg-slate-50"
                  >
                    <span className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                      <Pin size={13} className="text-brand" />
                      <span>{SENDER_LABEL[message.pinnedBy ?? message.sender]} 置頂</span>
                      <span className="ml-auto">{formatToolTime(message.pinnedAt ?? message.createdAt)}</span>
                    </span>
                    <span className="line-clamp-2 break-words text-sm text-ink">{getMessagePreview(message)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-slate-500">沒有置頂訊息</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
