"use client";

import { ArrowDown, ArrowDownToLine, ArrowLeft, Images, Pin, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatComposer, type ComposerPayload } from "@/components/chat-composer";
import { ChatToolsDialog, type ChatToolMode } from "@/components/chat-tools-dialog";
import { ImageLightbox } from "@/components/image-lightbox";
import { MessageBubble } from "@/components/message-bubble";
import { VoiceCall } from "@/components/voice-call";
import { unlockAudio } from "@/lib/audio-client";
import { clearBrowserUnreadBadge, updateBrowserUnreadBadge } from "@/lib/browser-badge";
import { formatPresence, usePresence } from "@/lib/presence-client";
import { acquireRealtimeChannel, isRealtimeSubscribed, triggerRealtimeClientEvent } from "@/lib/pusher-client";
import { mergeLoadedMessages, mergeRealtimeMessages, messageIdentity } from "@/lib/message-sync";
import { useMessageNotificationSound } from "@/lib/message-notification-client";
import type { ReactionEmoji } from "@/lib/reactions";
import {
  PUSHER_EVENT_CLIENT_MESSAGE_FAILED,
  PUSHER_EVENT_CLIENT_MESSAGE_PREVIEW,
  PUSHER_EVENT_MESSAGES_CHANGED,
  PUSHER_EVENT_TYPING_CHANGED,
  type ClientMessageFailedEvent,
  type ClientMessagePreviewEvent,
  type MessagesChangedEvent
} from "@/lib/realtime";
import { getMessageMinuteKey } from "@/lib/time";
import { OTHER_SENDER, SENDER_LABEL, type Message, type Sender } from "@/lib/types";

type ChatRoomProps = {
  sender: Sender;
  onSwitchIdentity: () => void;
};

type CreateMessageRequest = {
  sender: Sender;
  clientId: string;
  text?: string;
  imageUrl?: string;
  imageUrls?: string[];
  replyToMessageId?: string;
};

const MESSAGE_FALLBACK_POLLING_INTERVAL_MS = 1500;
const MESSAGE_REALTIME_HEALTH_CHECK_MS = 15000;
const MESSAGE_REALTIME_BACKGROUND_POLLING_INTERVAL_MS = 60000;
const MESSAGE_FALLBACK_BACKGROUND_POLLING_INTERVAL_MS = 5000;
const MAX_SERVER_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1800;
const MAX_PARALLEL_IMAGE_UPLOADS = 3;
const JPEG_QUALITIES = [0.82, 0.74, 0.66, 0.58];
const TYPING_IDLE_MS = 1200;
const TYPING_EXPIRE_MS = 3200;
const CHAT_BOTTOM_THRESHOLD_PX = 48;
const CHAT_JUMP_BUTTON_THRESHOLD_PX = 180;
const AUTO_SCROLL_STORAGE_PREFIX = "chorchat:auto-scroll";

function getOptimisticId() {
  if (globalThis.crypto?.randomUUID) {
    return `optimistic-${globalThis.crypto.randomUUID()}`;
  }

  return `optimistic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toReplyMessage(message: Message): Message["replyTo"] {
  return {
    id: message.id,
    sender: message.sender,
    text: message.text,
    imageUrl: message.imageUrl,
    imageUrls: message.imageUrls ?? [],
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    recalledAt: message.recalledAt
  };
}

function formatFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function readImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("無法讀取圖片。"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("圖片壓縮失敗。"));
        }
      },
      "image/jpeg",
      quality
    );
  });
}

async function compressImage(file: File) {
  if (file.size <= MAX_SERVER_UPLOAD_BYTES) {
    return file;
  }

  if (file.type === "image/gif") {
    throw new Error(`GIF 圖片太大，目前請使用 ${formatFileSize(MAX_SERVER_UPLOAD_BYTES)} 以下的圖片。`);
  }

  const image = await readImage(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("瀏覽器無法壓縮圖片。");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of JPEG_QUALITIES) {
    const blob = await canvasToBlob(canvas, quality);

    if (blob.size <= MAX_SERVER_UPLOAD_BYTES) {
      return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
        type: "image/jpeg",
        lastModified: Date.now()
      });
    }
  }

  throw new Error(`圖片太大，壓縮後仍超過 ${formatFileSize(MAX_SERVER_UPLOAD_BYTES)}。`);
}

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>
) {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export function ChatRoom({ sender, onSwitchIdentity }: ChatRoomProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [lightboxImages, setLightboxImages] = useState<{ urls: string[]; index: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [isPageActive, setIsPageActive] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadBelowCount, setUnreadBelowCount] = useState(0);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const [activeTool, setActiveTool] = useState<ChatToolMode | null>(null);
  const [autoScrollOnIncoming, setAutoScrollOnIncoming] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "ready" | "fallback">("connecting");
  const [realtimeAttempt, setRealtimeAttempt] = useState(0);
  const [relayError, setRelayError] = useState(false);
  const chatScrollRef = useRef<HTMLElement | null>(null);
  const hasInitialScrolledRef = useRef(false);
  const latestRenderedMessageIdRef = useRef<string | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const unreadBelowCountRef = useRef(0);
  const loadMessagesPromiseRef = useRef<Promise<void> | null>(null);
  const optimisticImageUrlsRef = useRef<Map<string, string>>(new Map());
  const realtimeConnectedRef = useRef(false);
  const locallySentIdsRef = useRef(new Set<string>());
  const failedPreviewIdsRef = useRef(new Set<string>());
  const typingStopTimerRef = useRef<number | null>(null);
  const otherTypingTimerRef = useRef<number | null>(null);
  const readSyncRef = useRef(false);
  const hasSentTypingRef = useRef(false);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedMessageTrackingRef = useRef(false);

  const otherSender = OTHER_SENDER[sender];
  const otherPresence = usePresence(sender, otherSender);
  const notifyMessage = useMessageNotificationSound();
  const pinnedMessageCount = useMemo(
    () => messages.filter((message) => message.pinnedAt && !message.recalledAt && !message.clientStatus).length,
    [messages]
  );

  useEffect(() => {
    setAutoScrollOnIncoming(window.localStorage.getItem(`${AUTO_SCROLL_STORAGE_PREFIX}:${sender}`) === "true");
  }, [sender]);

  function toggleAutoScrollOnIncoming() {
    setAutoScrollOnIncoming((currentValue) => {
      const nextValue = !currentValue;
      window.localStorage.setItem(`${AUTO_SCROLL_STORAGE_PREFIX}:${sender}`, String(nextValue));
      return nextValue;
    });
  }

  const loadMessages = useCallback(async () => {
    if (loadMessagesPromiseRef.current) {
      return loadMessagesPromiseRef.current;
    }

    const request = (async () => {
      const response = await fetch("/api/messages", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        throw new Error("無法載入訊息");
      }

      const data = (await response.json()) as { messages: Message[] };
      if (!hasInitializedMessageTrackingRef.current) {
        data.messages.forEach((message) => knownMessageIdsRef.current.add(messageIdentity(message)));
        hasInitializedMessageTrackingRef.current = true;
      }
      setMessages((currentMessages) => mergeLoadedMessages(currentMessages, data.messages));
    })();

    loadMessagesPromiseRef.current = request;

    try {
      await request;
    } finally {
      if (loadMessagesPromiseRef.current === request) {
        loadMessagesPromiseRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        await loadMessages();
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "無法載入訊息");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void init();

    return () => {
      isMounted = false;
    };
  }, [loadMessages, sender]);

  useEffect(() => {
    function updatePageActivity() {
      const isActive = document.visibilityState === "visible" && document.hasFocus();
      setIsPageActive(isActive);

      if (isActive) {
        setUnreadCount(0);
        void unlockAudio();
        void loadMessages().catch(() => undefined);
      }
    }

    updatePageActivity();
    document.addEventListener("visibilitychange", updatePageActivity);
    window.addEventListener("focus", updatePageActivity);
    window.addEventListener("blur", updatePageActivity);

    return () => {
      document.removeEventListener("visibilitychange", updatePageActivity);
      window.removeEventListener("focus", updatePageActivity);
      window.removeEventListener("blur", updatePageActivity);
    };
  }, [loadMessages]);

  useEffect(() => {
    updateBrowserUnreadBadge(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    return () => clearBrowserUnreadBadge();
  }, []);

  useEffect(() => {
    let timeoutId: number | null = null;
    let isStopped = false;
    let cleanupChannel: (() => void) | undefined;
    let retryTimer: number | undefined;

    function getPollingDelay() {
      if (document.hidden) {
        return realtimeConnectedRef.current
          ? MESSAGE_REALTIME_BACKGROUND_POLLING_INTERVAL_MS
          : MESSAGE_FALLBACK_BACKGROUND_POLLING_INTERVAL_MS;
      }

      return realtimeConnectedRef.current ? MESSAGE_REALTIME_HEALTH_CHECK_MS : MESSAGE_FALLBACK_POLLING_INTERVAL_MS;
    }

    function schedulePoll(delay = getPollingDelay()) {
      if (isStopped) return;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        void loadMessages()
          .catch(() => undefined)
          .finally(() => {
            if (!isStopped) {
              schedulePoll();
            }
          });
      }, delay);
    }

    function handleVisibilityChange() {
      schedulePoll();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    schedulePoll();
    setRealtimeStatus("connecting");
    void acquireRealtimeChannel().then((realtimeLease) => {
      if (isStopped) {
        realtimeLease?.release();
        return;
      }

      if (!realtimeLease) {
        realtimeConnectedRef.current = false;
        setRealtimeStatus("fallback");
        schedulePoll();
        retryTimer = window.setTimeout(() => setRealtimeAttempt((attempt) => attempt + 1), 5000);
        return;
      }

      const { pusher, channel } = realtimeLease;
      const handleStateChange = () => {
        const isConnected = isRealtimeSubscribed(realtimeLease);
        const wasConnected = realtimeConnectedRef.current;
        realtimeConnectedRef.current = isConnected;
        setRealtimeStatus(isConnected ? "ready" : "connecting");
        if (isConnected) window.clearTimeout(retryTimer);

        if (wasConnected !== isConnected) {
          schedulePoll(0);
        }
      };
      const handleSubscriptionError = () => {
        realtimeConnectedRef.current = false;
        setRealtimeStatus("fallback");
        schedulePoll(0);
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          if (pusher.connection.state !== "connected") return;
          channel.unsubscribe();
          channel.subscribe();
        }, 5000);
      };
      const handleFailedIds = (ids: string[]) => {
        const failedClientIds = new Set(ids);
        ids.forEach((id) => failedPreviewIdsRef.current.add(id));
        while (failedPreviewIdsRef.current.size > 500) {
          failedPreviewIdsRef.current.delete(failedPreviewIdsRef.current.values().next().value!);
        }
        setMessages((current) => current.flatMap((message) => {
          if (!failedClientIds.has(message.id)) return [message];
          return message.sender === sender ? [{ ...message, clientStatus: "failed" as const }] : [];
        }));
      };
      const handleMessagesChanged = (event: MessagesChangedEvent) => {
        if (event.type === "failed") {
          handleFailedIds(event.clientIds ?? (event.clientId ? [event.clientId] : []));
          return;
        }

        if (event.type === "read" && event.reader && event.readAt) {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.sender !== event.reader && !message.clientStatus
                ? { ...message, readAt: message.readAt ?? event.readAt ?? null }
                : message
            )
          );
          return;
        }

        const realtimeMessages = (event.messages ?? (event.message ? [event.message] : []))
          .filter((message) => !message.clientStatus || !failedPreviewIdsRef.current.has(message.id));

        if (realtimeMessages.length > 0) {
          if (event.type === "created") {
            // Multiple devices can use the same identity; only suppress this tab's own preview.
            const incomingMessages = realtimeMessages.filter((message) =>
              !locallySentIdsRef.current.has(messageIdentity(message)) || !message.clientStatus
            );

            if (incomingMessages.length > 0) {
              const replacedClientIds = event.clientIds ?? (event.clientId ? [event.clientId] : []);

              setMessages((currentMessages) =>
                mergeRealtimeMessages(currentMessages, incomingMessages, replacedClientIds)
              );
            }

            return;
          }

          setMessages((currentMessages) => mergeRealtimeMessages(currentMessages, realtimeMessages));
          return;
        }

        void loadMessages().catch(() => undefined);
      };
      const handleTypingChanged = (event: { sender: Sender; isTyping: boolean }) => {
        if (event.sender === sender) {
          return;
        }

        if (otherTypingTimerRef.current) {
          window.clearTimeout(otherTypingTimerRef.current);
          otherTypingTimerRef.current = null;
        }

        setIsOtherTyping(event.isTyping);

        if (event.isTyping) {
          otherTypingTimerRef.current = window.setTimeout(() => setIsOtherTyping(false), TYPING_EXPIRE_MS);
        }
      };
      const handleClientMessagePreview = (event: ClientMessagePreviewEvent) => {
        const incomingMessages = event.messages.filter((message) =>
          !locallySentIdsRef.current.has(messageIdentity(message)) && !failedPreviewIdsRef.current.has(message.id)
        );

        if (incomingMessages.length > 0) {
          setMessages((currentMessages) => mergeRealtimeMessages(currentMessages, incomingMessages));
        }
      };
      const handleClientMessageFailed = (event: ClientMessageFailedEvent) => {
        handleFailedIds(event.clientIds);
      };

      pusher.connection.bind("state_change", handleStateChange);
      channel.bind("pusher:subscription_succeeded", handleStateChange);
      channel.bind("pusher:subscription_error", handleSubscriptionError);
      channel.bind(PUSHER_EVENT_MESSAGES_CHANGED, handleMessagesChanged);
      channel.bind(PUSHER_EVENT_TYPING_CHANGED, handleTypingChanged);
      channel.bind(PUSHER_EVENT_CLIENT_MESSAGE_PREVIEW, handleClientMessagePreview);
      channel.bind(PUSHER_EVENT_CLIENT_MESSAGE_FAILED, handleClientMessageFailed);
      handleStateChange();
      if (pusher.connection.state === "connected" && !channel.subscribed && !channel.subscriptionPending) {
        channel.subscribe();
      }

      cleanupChannel = () => {
        realtimeConnectedRef.current = false;
        if (otherTypingTimerRef.current) {
          window.clearTimeout(otherTypingTimerRef.current);
        }
        pusher.connection.unbind("state_change", handleStateChange);
        channel.unbind("pusher:subscription_succeeded", handleStateChange);
        channel.unbind("pusher:subscription_error", handleSubscriptionError);
        channel.unbind(PUSHER_EVENT_MESSAGES_CHANGED, handleMessagesChanged);
        channel.unbind(PUSHER_EVENT_TYPING_CHANGED, handleTypingChanged);
        channel.unbind(PUSHER_EVENT_CLIENT_MESSAGE_PREVIEW, handleClientMessagePreview);
        channel.unbind(PUSHER_EVENT_CLIENT_MESSAGE_FAILED, handleClientMessageFailed);
        realtimeLease.release();
      };
    });

    return () => {
      isStopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timeoutId) window.clearTimeout(timeoutId);
      window.clearTimeout(retryTimer);
      cleanupChannel?.();
    };
  }, [loadMessages, sender, realtimeAttempt]);

  useEffect(() => {
    const optimisticImageUrls = optimisticImageUrlsRef.current;

    return () => {
      optimisticImageUrls.forEach((url) => URL.revokeObjectURL(url));
      optimisticImageUrls.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      const typingStopTimer = typingStopTimerRef.current;
      const otherTypingTimer = otherTypingTimerRef.current;

      if (typingStopTimer) {
        window.clearTimeout(typingStopTimer);
      }
      if (otherTypingTimer) {
        window.clearTimeout(otherTypingTimer);
      }
    };
  }, []);

  const clearUnreadBelow = useCallback(() => {
    unreadBelowCountRef.current = 0;
    setUnreadBelowCount(0);
  }, []);

  const stopProgrammaticScrollTracking = useCallback(() => {
    isProgrammaticScrollRef.current = false;

    if (programmaticScrollTimerRef.current) {
      window.clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = null;
    }
  }, []);

  const startProgrammaticScrollTracking = useCallback(
    (timeoutMs: number) => {
      stopProgrammaticScrollTracking();
      isProgrammaticScrollRef.current = true;
      programmaticScrollTimerRef.current = window.setTimeout(stopProgrammaticScrollTracking, timeoutMs);
    },
    [stopProgrammaticScrollTracking]
  );

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const scrollContainer = chatScrollRef.current;

      if (!scrollContainer) {
        return;
      }

      startProgrammaticScrollTracking(behavior === "smooth" ? 1200 : 100);
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior
      });
      setIsAwayFromBottom(false);
      clearUnreadBelow();
    },
    [clearUnreadBelow, startProgrammaticScrollTracking]
  );

  const handleChatScroll = useCallback(() => {
    if (scrollAnimationFrameRef.current) {
      return;
    }

    scrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
      scrollAnimationFrameRef.current = null;
      const scrollContainer = chatScrollRef.current;

      if (!scrollContainer) {
        return;
      }

      const distanceFromBottom =
        scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;

      if (isProgrammaticScrollRef.current) {
        if (distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX) {
          stopProgrammaticScrollTracking();
        }
        return;
      }

      if (distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX) {
        setIsAwayFromBottom(false);
        clearUnreadBelow();
      } else if (distanceFromBottom >= CHAT_JUMP_BUTTON_THRESHOLD_PX) {
        setIsAwayFromBottom(true);
      }
    });
  }, [clearUnreadBelow, stopProgrammaticScrollTracking]);

  useLayoutEffect(() => {
    latestRenderedMessageIdRef.current = messages.at(-1)?.id ?? null;
  }, [messages]);

  useLayoutEffect(() => {
    if (isLoading || hasInitialScrolledRef.current) {
      return;
    }

    hasInitialScrolledRef.current = true;
    const scrollContainer = chatScrollRef.current;
    const initialLatestMessageId = latestRenderedMessageIdRef.current;
    let isSettling = true;
    const stopInitialSettling = () => {
      isSettling = false;
      mutationObserver.disconnect();
    };
    const jumpToBottom = () => {
      if (!isSettling) return;
      if (latestRenderedMessageIdRef.current !== initialLatestMessageId) {
        stopInitialSettling();
        return;
      }

      scrollToLatest("auto");
    };
    const mutationObserver = new MutationObserver(jumpToBottom);

    if (scrollContainer) {
      mutationObserver.observe(scrollContainer, { childList: true, subtree: true });
      scrollContainer.addEventListener("wheel", stopInitialSettling, { once: true });
      scrollContainer.addEventListener("touchstart", stopInitialSettling, { once: true });
    }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      jumpToBottom();
      secondFrame = window.requestAnimationFrame(jumpToBottom);
    });
    const settleTimer = window.setTimeout(jumpToBottom, 300);
    const observerTimer = window.setTimeout(stopInitialSettling, 1500);

    return () => {
      mutationObserver.disconnect();
      scrollContainer?.removeEventListener("wheel", stopInitialSettling);
      scrollContainer?.removeEventListener("touchstart", stopInitialSettling);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
      window.clearTimeout(observerTimer);
    };
  }, [isLoading, scrollToLatest]);

  useEffect(() => {
    return () => {
      if (scrollAnimationFrameRef.current) {
        window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
      stopProgrammaticScrollTracking();
    };
  }, [stopProgrammaticScrollTracking]);

  const editingLabel = useMemo(() => {
    if (!editing) {
      return null;
    }

    return editing.text || ((editing.imageUrls?.length ?? 0) > 0 || editing.imageUrl ? "圖片訊息" : "訊息");
  }, [editing]);

  const latestOwnReadableMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (message.sender === sender && !message.clientStatus && !message.recalledAt) {
        return message.id;
      }
    }

    return null;
  }, [messages, sender]);

  useLayoutEffect(() => {
    const visibleMessages = messages.filter((message) => message.clientStatus !== "failed");
    const knownMessageIds = knownMessageIdsRef.current;
    let newIncomingMessageCount = 0;
    let newSyncedOwnMessageCount = 0;

    visibleMessages.forEach((message) => {
      if (knownMessageIds.has(messageIdentity(message))) {
        return;
      }

      knownMessageIds.add(messageIdentity(message));

      if (message.sender !== sender && !message.recalledAt) {
        newIncomingMessageCount += 1;
      } else if (!locallySentIdsRef.current.has(messageIdentity(message)) && !message.recalledAt) {
        newSyncedOwnMessageCount += 1;
      }
    });

    if (newIncomingMessageCount === 0) {
      if (newSyncedOwnMessageCount > 0) {
        if (autoScrollOnIncoming) scrollToLatest("instant");
        else setIsAwayFromBottom(true);
      }
      return;
    }

    if (autoScrollOnIncoming) {
      scrollToLatest("instant");
    } else {
      const scrollContainer = chatScrollRef.current;
      if (isProgrammaticScrollRef.current && scrollContainer) {
        scrollContainer.scrollTo({ top: scrollContainer.scrollTop, behavior: "auto" });
      }
      stopProgrammaticScrollTracking();
      unreadBelowCountRef.current += newIncomingMessageCount;
      setUnreadBelowCount(unreadBelowCountRef.current);
      setIsAwayFromBottom(true);
    }

    if (!isPageActive) {
      setUnreadCount((currentCount) => currentCount + newIncomingMessageCount);
    }

    notifyMessage();
  }, [
    autoScrollOnIncoming,
    isPageActive,
    messages,
    notifyMessage,
    scrollToLatest,
    sender,
    stopProgrammaticScrollTracking
  ]);

  useEffect(() => {
    if (!isPageActive || isAwayFromBottom || unreadBelowCountRef.current > 0) {
      return;
    }

    const hasUnreadIncomingMessages = messages.some(
      (message) => message.sender !== sender && !message.readAt && !message.clientStatus
    );

    if (!hasUnreadIncomingMessages) {
      return;
    }

    const readAt = new Date().toISOString();
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.sender !== sender && !message.readAt && !message.clientStatus
          ? {
              ...message,
              readAt
            }
          : message
      )
    );

    if (readSyncRef.current) {
      return;
    }

    readSyncRef.current = true;

    void fetch("/api/messages/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sender })
    })
      .then((response) => {
        if (response.ok) {
          void loadMessages().catch(() => undefined);
        }
      })
      .finally(() => {
        readSyncRef.current = false;
      });
  }, [isAwayFromBottom, isPageActive, loadMessages, messages, sender]);

  function focusMessage(messageId: string) {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    setHighlightedId(messageId);
    window.setTimeout(() => setHighlightedId((current) => (current === messageId ? null : current)), 1400);
  }

  async function uploadImage(file: File) {
    const uploadFile = await compressImage(file);
    const formData = new FormData();
    formData.append("file", uploadFile);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, "圖片上傳失敗"));
    }

    const data = (await response.json()) as { url: string };
    return data.url;
  }

  async function persistOptimisticMessage(
    tempId: string,
    requestBody: CreateMessageRequest,
    localImageCount = 0
  ) {
    // Publish independently: neither DB startup nor an unrelated Pusher setting may gate delivery.
    void fetch("/api/realtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(5000)
    }).then((response) => setRelayError(!response.ok)).catch(() => setRelayError(true));

    const response = await fetch("/api/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, "訊息送出失敗"));
    }

    const data = (await response.json()) as { message: Message };

    for (let index = 0; index < localImageCount; index += 1) {
      const optimisticImageUrl = optimisticImageUrlsRef.current.get(`${tempId}-${index}`);

      if (optimisticImageUrl) {
        URL.revokeObjectURL(optimisticImageUrl);
        optimisticImageUrlsRef.current.delete(`${tempId}-${index}`);
      }
    }

    setMessages((currentMessages) =>
      mergeRealtimeMessages(currentMessages, [data.message], [tempId])
    );
  }

  function markOptimisticMessageFailed(tempId: string) {
    setMessages((currentMessages) =>
      currentMessages.map((message) => (message.id === tempId ? { ...message, clientStatus: "failed" } : message))
    );
  }

  const sendTypingState = useCallback(
    async (isTyping: boolean) => {
      await fetch("/api/typing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sender,
          isTyping
        })
      }).catch(() => undefined);
    },
    [sender]
  );

  const handleTypingActivity = useCallback(
    (isTyping: boolean) => {
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }

      if (!isTyping) {
        if (hasSentTypingRef.current) {
          hasSentTypingRef.current = false;
          void sendTypingState(false);
        }
        return;
      }

      if (!hasSentTypingRef.current) {
        hasSentTypingRef.current = true;
        void sendTypingState(true);
      }

      typingStopTimerRef.current = window.setTimeout(() => {
        if (hasSentTypingRef.current) {
          hasSentTypingRef.current = false;
          void sendTypingState(false);
        }
      }, TYPING_IDLE_MS);
    },
    [sendTypingState]
  );

  async function handleSubmit(payload: ComposerPayload) {
    handleTypingActivity(false);
    setError(null);

    if (editing) {
      const editingMessage = editing;
      const editedAt = new Date().toISOString();
      setIsSending(true);

      try {
        setEditing(null);
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === editingMessage.id
              ? {
                  ...message,
                  text: payload.text,
                  updatedAt: editedAt,
                  editedAt
                }
              : message
          )
        );

        const response = await fetch(`/api/messages/${editingMessage.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sender,
            text: payload.text
          })
        });

        if (!response.ok) {
          setMessages((currentMessages) =>
            currentMessages.map((message) => (message.id === editingMessage.id ? editingMessage : message))
          );
          throw new Error("編輯失敗，可能已超過 15 分鐘");
        }

        const data = (await response.json()) as { message: Message };
        setMessages((currentMessages) =>
          currentMessages.map((message) => (message.id === editingMessage.id ? data.message : message))
        );
        void loadMessages().catch(() => undefined);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "操作失敗");
      } finally {
        setIsSending(false);
      }

      return;
    }

    const text = payload.text.trim();
    const imageFiles = payload.files;
    const replyTarget = replyTo;
    const createdAt = Date.now();
    const optimisticMessages: Message[] = [];
    const textTempId = text ? getOptimisticId() : null;
    const imageTempId = imageFiles.length > 0 ? getOptimisticId() : null;
    let localImageUrls: string[] = [];

    if (textTempId) {
      optimisticMessages.push({
        id: textTempId,
        sender,
        text,
        imageUrl: null,
        imageUrls: [],
        createdAt: new Date(createdAt).toISOString(),
        updatedAt: new Date(createdAt).toISOString(),
        editedAt: null,
        recalledAt: null,
        readAt: null,
        pinnedAt: null,
        pinnedBy: null,
        replyToMessageId: replyTarget?.id ?? null,
        replyTo: replyTarget ? toReplyMessage(replyTarget) : null,
        reactions: [],
        clientStatus: "sending"
      });
    }

    if (imageTempId) {
      localImageUrls = imageFiles.map((file, index) => {
        const localImageUrl = URL.createObjectURL(file);
        optimisticImageUrlsRef.current.set(`${imageTempId}-${index}`, localImageUrl);
        return localImageUrl;
      });
      const imageCreatedAt = createdAt + (textTempId ? 1 : 0);
      const imageReplyTarget = textTempId ? null : replyTarget;

      optimisticMessages.push({
        id: imageTempId,
        sender,
        text: null,
        imageUrl: localImageUrls[0] ?? null,
        imageUrls: localImageUrls,
        createdAt: new Date(imageCreatedAt).toISOString(),
        updatedAt: new Date(imageCreatedAt).toISOString(),
        editedAt: null,
        recalledAt: null,
        readAt: null,
        pinnedAt: null,
        pinnedBy: null,
        replyToMessageId: imageReplyTarget?.id ?? null,
        replyTo: imageReplyTarget ? toReplyMessage(imageReplyTarget) : null,
        reactions: [],
        clientStatus: "sending"
      });
    }

    startProgrammaticScrollTracking(1400);
    optimisticMessages.forEach((message) => locallySentIdsRef.current.add(messageIdentity(message)));
    setMessages((currentMessages) => [...currentMessages, ...optimisticMessages]);
    window.requestAnimationFrame(() => scrollToLatest("smooth"));
    setReplyTo(null);

    const instantTextMessages = optimisticMessages.filter((message) => Boolean(message.text));
    if (instantTextMessages.length > 0) {
      triggerRealtimeClientEvent(PUSHER_EVENT_CLIENT_MESSAGE_PREVIEW, {
        messages: instantTextMessages
      });
    }

    const imageUploadTask: Promise<{ urls: string[]; error: unknown | null }> =
      imageFiles.length > 0
        ? mapWithConcurrency(imageFiles, MAX_PARALLEL_IMAGE_UPLOADS, (file) => uploadImage(file)).then(
            (urls) => ({ urls, error: null }),
            (error: unknown) => ({ urls: [], error })
          )
        : Promise.resolve({ urls: [], error: null });
    let firstError: unknown = null;

    if (textTempId) {
      try {
        await persistOptimisticMessage(textTempId, {
          sender,
          clientId: textTempId,
          text,
          replyToMessageId: replyTarget?.id
        });
      } catch (sendError) {
        markOptimisticMessageFailed(textTempId);
        triggerRealtimeClientEvent(PUSHER_EVENT_CLIENT_MESSAGE_FAILED, { clientIds: [textTempId] });
        firstError = sendError;
      }
    }

    if (imageTempId) {
      const uploadResult = await imageUploadTask;

      if (uploadResult.error) {
        markOptimisticMessageFailed(imageTempId);
        triggerRealtimeClientEvent(PUSHER_EVENT_CLIENT_MESSAGE_FAILED, { clientIds: [imageTempId] });
        firstError ??= uploadResult.error;
      } else {
        triggerRealtimeClientEvent(PUSHER_EVENT_CLIENT_MESSAGE_PREVIEW, {
          messages: [
            {
              ...optimisticMessages.find((message) => message.id === imageTempId),
              id: imageTempId,
              sender,
              text: null,
              imageUrl: uploadResult.urls[0] ?? null,
              imageUrls: uploadResult.urls,
              createdAt: new Date(createdAt + (textTempId ? 1 : 0)).toISOString(),
              updatedAt: new Date(createdAt + (textTempId ? 1 : 0)).toISOString(),
              editedAt: null,
              recalledAt: null,
              readAt: null,
              pinnedAt: null,
              pinnedBy: null,
              replyToMessageId: textTempId ? null : replyTarget?.id ?? null,
              replyTo: textTempId ? null : replyTarget ? toReplyMessage(replyTarget) : null,
              reactions: [],
              clientStatus: "sending"
            }
          ]
        });

        try {
          await persistOptimisticMessage(
            imageTempId,
            {
              sender,
              clientId: imageTempId,
              imageUrl: uploadResult.urls[0],
              imageUrls: uploadResult.urls,
              replyToMessageId: textTempId ? undefined : replyTarget?.id
            },
            localImageUrls.length
          );
        } catch (sendError) {
          markOptimisticMessageFailed(imageTempId);
          triggerRealtimeClientEvent(PUSHER_EVENT_CLIENT_MESSAGE_FAILED, { clientIds: [imageTempId] });
          firstError ??= sendError;
        }
      }
    }

    if (firstError) {
      setError(firstError instanceof Error ? firstError.message : "訊息送出失敗");
    }
  }

  async function handleRecall(message: Message) {
    setError(null);

    try {
      const response = await fetch(`/api/messages/${message.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sender })
      });

      if (!response.ok) {
        throw new Error("收回失敗");
      }

      setEditing((currentEditing) => (currentEditing?.id === message.id ? null : currentEditing));

      await loadMessages();
    } catch (recallError) {
      setError(recallError instanceof Error ? recallError.message : "收回失敗");
    }
  }

  async function handleToggleReaction(message: Message, emoji: ReactionEmoji) {
    setError(null);
    const existingReaction = message.reactions.find(
      (reaction) => reaction.sender === sender && reaction.emoji === emoji
    );
    const optimisticReactions = existingReaction
      ? message.reactions.filter((reaction) => reaction.id !== existingReaction.id)
      : [
          ...message.reactions,
          {
            id: `optimistic-reaction-${sender}-${emoji}`,
            sender,
            emoji,
            createdAt: new Date().toISOString()
          }
        ];

    setMessages((currentMessages) =>
      currentMessages.map((currentMessage) =>
        currentMessage.id === message.id ? { ...currentMessage, reactions: optimisticReactions } : currentMessage
      )
    );

    try {
      const response = await fetch(`/api/messages/${message.id}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender, emoji })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "表情回應失敗"));
      }

      const data = (await response.json()) as { message: Message };
      setMessages((currentMessages) =>
        currentMessages.map((currentMessage) => (currentMessage.id === message.id ? data.message : currentMessage))
      );
    } catch (reactionError) {
      setError(reactionError instanceof Error ? reactionError.message : "表情回應失敗");
      void loadMessages().catch(() => undefined);
    }
  }

  async function handleTogglePin(message: Message) {
    setError(null);
    const shouldPin = !message.pinnedAt;
    const optimisticPinnedAt = shouldPin ? new Date().toISOString() : null;

    setMessages((currentMessages) =>
      currentMessages.map((currentMessage) =>
        currentMessage.id === message.id
          ? {
              ...currentMessage,
              pinnedAt: optimisticPinnedAt,
              pinnedBy: shouldPin ? sender : null
            }
          : currentMessage
      )
    );

    try {
      const response = await fetch(`/api/messages/${message.id}/pin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender, pinned: shouldPin })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "置頂操作失敗"));
      }

      const data = (await response.json()) as { message: Message };
      setMessages((currentMessages) =>
        currentMessages.map((currentMessage) => (currentMessage.id === message.id ? data.message : currentMessage))
      );
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : "置頂操作失敗");
      void loadMessages().catch(() => undefined);
    }
  }

  function handleStartEdit(message: Message) {
    setReplyTo(null);
    setEditing(message);
  }

  return (
    <main className="flex h-dvh flex-col bg-paper text-ink">
      {realtimeStatus !== "ready" || relayError ? (
        <div role="status" className="flex shrink-0 items-center justify-center gap-3 bg-amber-50 px-3 py-1 text-xs text-amber-900">
          <span>{relayError ? "即時傳送暫時失敗，訊息仍會儲存並同步" : realtimeStatus === "connecting" ? "正在連接聊天室…" : "即時連線中斷，正在重新連線"}</span>
          <button type="button" className="shrink-0 underline" onClick={() => { setRelayError(false); setRealtimeAttempt((attempt) => attempt + 1); }}>重新連線</button>
        </div>
      ) : null}
      <header className="border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            onClick={onSwitchIdentity}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-brand/20"
          >
            <ArrowLeft size={17} />
            換身分
          </button>

          <div className="min-w-0 text-center">
            <h1 className="truncate text-lg font-semibold">chorchat</h1>
            <p className="flex items-center justify-center gap-1.5 truncate text-xs text-slate-500">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${otherPresence.isOnline ? "bg-emerald-500" : "bg-slate-300"}`}
              />
              <span className="truncate">
                {SENDER_LABEL[otherSender]} · {formatPresence(otherPresence)}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <VoiceCall sender={sender} recipient={otherSender} />
            <button
              type="button"
              onClick={() => void loadMessages()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-brand/20"
              aria-label="重新整理"
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
        <nav className="border-t border-line/80 px-3 py-2" aria-label="聊天室工具">
          <div className="mx-auto grid max-w-5xl grid-cols-4 gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setActiveTool("search")}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-ink"
            >
              <Search size={16} />搜尋
            </button>
            <button
              type="button"
              onClick={() => setActiveTool("media")}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-ink"
            >
              <Images size={16} />媒體
            </button>
            <button
              type="button"
              onClick={() => setActiveTool("pinned")}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-ink"
            >
              <Pin size={16} />置頂
              {pinnedMessageCount > 0 ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-md bg-blue-50 px-1 text-xs text-brand">
                  {pinnedMessageCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={toggleAutoScrollOnIncoming}
              aria-pressed={autoScrollOnIncoming}
              aria-label={`新訊息自動滑到底：${autoScrollOnIncoming ? "已開啟" : "已關閉"}`}
              className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition ${
                autoScrollOnIncoming
                  ? "bg-blue-50 text-brand"
                  : "text-slate-600 hover:bg-slate-100 hover:text-ink"
              }`}
            >
              <ArrowDownToLine size={16} />自動{autoScrollOnIncoming ? "開" : "關"}
            </button>
          </div>
        </nav>
      </header>

      <section
        ref={chatScrollRef}
        onScroll={handleChatScroll}
        onWheel={stopProgrammaticScrollTracking}
        onTouchStart={stopProgrammaticScrollTracking}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            stopProgrammaticScrollTracking();
          }
        }}
        className="chat-scrollbar mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-y-auto px-3 py-5 sm:px-5"
      >
        {isLoading && messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-brand" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm leading-7 text-slate-500">
            還沒有訊息。傳送第一則文字或圖片開始對話。
          </div>
        ) : (
          messages.map((message, index) => {
            const previousMessage = messages[index - 1];
            const showTimestamp =
              !previousMessage || getMessageMinuteKey(previousMessage.createdAt) !== getMessageMinuteKey(message.createdAt);

            return (
              <MessageBubble
                key={message.id}
                message={message}
                currentSender={sender}
                isHighlighted={highlightedId === message.id}
                showTimestamp={showTimestamp}
                readReceipt={
                  message.id === latestOwnReadableMessageId && message.sender === sender
                    ? message.readAt
                      ? "read"
                      : "unread"
                    : null
                }
                onReply={() => {
                  setEditing(null);
                  setReplyTo(message);
                }}
                onEdit={() => handleStartEdit(message)}
                onRecall={() => void handleRecall(message)}
                onTogglePin={() => void handleTogglePin(message)}
                onToggleReaction={(emoji) => void handleToggleReaction(message, emoji)}
                onOpenImages={(urls, index = 0) => setLightboxImages({ urls, index })}
                onQuoteClick={focusMessage}
              />
            );
          })
        )}
        {isOtherTyping ? (
          <div className="flex justify-start px-1 text-sm text-slate-500">
            {SENDER_LABEL[otherSender]} 正在輸入...
          </div>
        ) : null}
      </section>

      {isAwayFromBottom || unreadBelowCount > 0 ? (
        <button
          type="button"
          onClick={() => scrollToLatest("smooth")}
          className="fixed bottom-24 left-1/2 z-30 inline-flex h-10 -translate-x-1/2 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 shadow-soft transition hover:border-brand hover:text-brand focus:outline-none focus:ring-4 focus:ring-brand/20"
          aria-label={unreadBelowCount > 0 ? `${unreadBelowCount} 則未讀訊息，回到最新訊息` : "回到最新訊息"}
        >
          <ArrowDown size={16} />
          {unreadBelowCount > 0 ? `${unreadBelowCount} 則未讀訊息` : "回到最新訊息"}
        </button>
      ) : null}

      {error ? (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-center text-sm text-red-700">{error}</div>
      ) : null}

      <ChatComposer
        isSending={isSending}
        replyTo={replyTo}
        editing={editing}
        editingLabel={editingLabel}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        onTypingActivity={handleTypingActivity}
        onSubmit={handleSubmit}
      />

      {activeTool ? (
        <ChatToolsDialog
          mode={activeTool}
          messages={messages}
          onClose={() => setActiveTool(null)}
          onFocusMessage={focusMessage}
          onOpenImages={(urls, index) => setLightboxImages({ urls, index })}
        />
      ) : null}

      <ImageLightbox
        imageUrls={lightboxImages?.urls ?? []}
        initialIndex={lightboxImages?.index ?? 0}
        onClose={() => setLightboxImages(null)}
      />
    </main>
  );
}
