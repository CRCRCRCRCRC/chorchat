"use client";

/* eslint-disable @next/next/no-img-element */

import { Check, Download, Image as ImageIcon, Link2, Phone, Pin, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { extractUrls } from "@/lib/links";
import { getMessageImageUrls } from "@/lib/messages";
import { SENDER_LABEL, type Message } from "@/lib/types";
import type { Sender } from "@/lib/types";
import type { CallHistoryRecord } from "@/lib/call";
import { CallHistoryItem } from "@/components/call-history-item";
import { useImageDownload } from "@/lib/image-download-client";
import { MAX_DOWNLOAD_IMAGES } from "@/lib/image-download";

export type ChatToolMode = "search" | "media" | "pinned" | "calls";

type ChatToolsDialogProps = {
  mode: ChatToolMode;
  messages: Message[];
  onClose: () => void;
  onFocusMessage: (messageId: string) => void;
  onOpenImages: (urls: string[], index: number) => void;
  calls: CallHistoryRecord[];
  currentSender: Sender;
  callError: string | null;
  callsLoading: boolean;
  onRefreshCalls: () => void;
  onRedial: () => void;
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
  onOpenImages,
  calls,
  currentSender,
  callError,
  callsLoading,
  onRefreshCalls,
  onRedial
}: ChatToolsDialogProps) {
  const [query, setQuery] = useState("");
  const [mediaTab, setMediaTab] = useState<"images" | "links">("images");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const downloads = useImageDownload();
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
  useEffect(() => {
    const available = new Set(imageItems.map((item) => `${item.message.id}-${item.index}`));
    setSelected((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [imageItems]);

  function toggleSelected(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_DOWNLOAD_IMAGES) next.add(key);
      return next;
    });
  }
  const pinnedMessages = useMemo(
    () =>
      availableMessages
        .filter((message) => message.pinnedAt)
        .sort(
          (first, second) =>
            new Date(second.pinnedAt ?? 0).getTime() - new Date(first.pinnedAt ?? 0).getTime()
        ),
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

  const title =
    mode === "search"
      ? "搜尋訊息"
      : mode === "media"
        ? "照片與連結"
        : mode === "calls"
          ? "通話紀錄"
          : "置頂訊息";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-2 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] min-h-[380px] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-soft"
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
                      <span className="line-clamp-2 break-words text-sm text-ink">
                        {getMessagePreview(message)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}

        {mode === "media" ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-line p-3">
              <button
                type="button"
                onClick={() => setMediaTab("images")}
                className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${
                  mediaTab === "images" ? "bg-brand text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                <ImageIcon size={16} />
                圖片 ({imageItems.length})
              </button>
              <button
                type="button"
                onClick={() => setMediaTab("links")}
                className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${
                  mediaTab === "links" ? "bg-brand text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                <Link2 size={16} />
                連結 ({linkItems.length})
              </button>
              {mediaTab === "images" && imageItems.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelecting((current) => !current);
                    setSelected(new Set());
                  }}
                  className="ml-auto shrink-0 rounded-md px-2 py-2 text-sm font-medium text-brand"
                >
                  {selecting ? "取消選取" : "選取照片"}
                </button>
              ) : null}
            </div>
            {mediaTab === "images" && selecting ? (
              <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-slate-50 px-3 py-2 text-xs">
                <button
                  type="button"
                  className="text-brand"
                  disabled={Boolean(downloads.progress)}
                  onClick={() =>
                    setSelected(
                      selected.size
                        ? new Set()
                        : new Set(
                            imageItems
                              .slice(0, MAX_DOWNLOAD_IMAGES)
                              .map((item) => `${item.message.id}-${item.index}`)
                          )
                    )
                  }
                >
                  {selected.size ? "取消全選" : "全選"}
                </button>
                <span className="text-slate-500">
                  已選 {selected.size} 張
                  {imageItems.length > MAX_DOWNLOAD_IMAGES ? ` · 每次最多 ${MAX_DOWNLOAD_IMAGES} 張` : ""}
                </span>
                <button
                  type="button"
                  disabled={!selected.size || Boolean(downloads.progress)}
                  onClick={() =>
                    void downloads.download(
                      imageItems
                        .filter((item) => selected.has(`${item.message.id}-${item.index}`))
                        .map((item) => item.url)
                    )
                  }
                  className="ml-auto inline-flex h-8 min-w-24 items-center justify-center gap-1.5 rounded-md bg-brand px-3 font-medium text-white disabled:opacity-40"
                >
                  <Download size={14} />
                  下載所選
                </button>
              </div>
            ) : null}
            {downloads.progress || downloads.error || downloads.ready ? (
              <div
                className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs"
                aria-live="polite"
              >
                {downloads.progress ? (
                  <>
                    <span>
                      準備下載 {downloads.progress.completed} / {downloads.progress.total}
                    </span>
                    <button type="button" onClick={downloads.cancel} className="underline">
                      取消下載
                    </button>
                  </>
                ) : downloads.error ? (
                  <span className="text-rose-600">{downloads.error}</span>
                ) : downloads.ready ? (
                  <>
                    <span className="text-emerald-700">檔案已準備好</span>
                    <a
                      href={downloads.ready.url}
                      download={downloads.ready.name}
                      className="text-brand underline"
                    >
                      再次下載
                    </a>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
              {mediaTab === "images" ? (
                imageItems.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
                    {imageItems.map((item, itemIndex) => (
                      <button
                        key={`${item.message.id}-${item.index}`}
                        type="button"
                        onClick={() =>
                          selecting
                            ? toggleSelected(`${item.message.id}-${item.index}`)
                            : onOpenImages(item.urls, item.index)
                        }
                        className={`relative aspect-square overflow-hidden rounded-md bg-slate-100 focus:outline-none focus:ring-4 focus:ring-brand/20 ${selected.has(`${item.message.id}-${item.index}`) ? "ring-2 ring-inset ring-brand" : ""}`}
                        aria-label={
                          selecting
                            ? `選取第 ${itemIndex + 1} 張圖片`
                            : `開啟 ${SENDER_LABEL[item.message.sender]} 傳送的圖片`
                        }
                        aria-pressed={
                          selecting ? selected.has(`${item.message.id}-${item.index}`) : undefined
                        }
                      >
                        <img
                          src={item.url}
                          alt="聊天媒體"
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                        {selecting ? (
                          <span
                            className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-md border ${selected.has(`${item.message.id}-${item.index}`) ? "border-brand bg-brand text-white" : "border-white bg-black/30"}`}
                          >
                            {selected.has(`${item.message.id}-${item.index}`) ? <Check size={13} /> : null}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="py-12 text-center text-sm text-slate-500">沒有圖片</p>
                )
              ) : linkItems.length > 0 ? (
                <div className="space-y-2">
                  {linkItems.map((item, index) => (
                    <div
                      key={`${item.message.id}-${item.url}-${index}`}
                      className="rounded-md border border-line p-3"
                    >
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
                        {SENDER_LABEL[item.message.sender]} · {formatToolTime(item.message.createdAt)} ·
                        查看訊息
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

        {mode === "calls" ? (
          <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            {callError ? (
              <div className="mb-3 flex items-center justify-between gap-3 text-sm text-rose-600">
                <span>{callError}</span>
                <button type="button" onClick={onRefreshCalls} className="shrink-0 underline">
                  重試
                </button>
              </div>
            ) : null}
            {calls.length ? (
              <div className="space-y-3">
                {[...calls].reverse().map((call) => (
                  <div key={call.id}>
                    <p className="mb-1.5 text-xs text-slate-400">{formatToolTime(call.startedAt)}</p>
                    <CallHistoryItem call={call} sender={currentSender} onRedial={onRedial} compact />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-16 text-sm text-slate-400">
                <Phone size={24} strokeWidth={1.5} />
                <p>{callsLoading ? "正在載入通話紀錄" : "還沒有通話紀錄"}</p>
              </div>
            )}
          </div>
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
                    <span className="line-clamp-2 break-words text-sm text-ink">
                      {getMessagePreview(message)}
                    </span>
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
