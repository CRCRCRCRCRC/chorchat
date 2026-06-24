"use client";

import { ArrowDown, ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatComposer, type ComposerPayload } from "@/components/chat-composer";
import { ImageLightbox } from "@/components/image-lightbox";
import { MessageBubble } from "@/components/message-bubble";
import { VoiceCall } from "@/components/voice-call";
import { playMessageNotificationSound, unlockAudio } from "@/lib/audio-client";
import { clearBrowserUnreadBadge, updateBrowserUnreadBadge } from "@/lib/browser-badge";
import { acquireRealtimeChannel } from "@/lib/pusher-client";
import { PUSHER_EVENT_MESSAGES_CHANGED, PUSHER_EVENT_TYPING_CHANGED } from "@/lib/realtime";
import { getMessageMinuteKey } from "@/lib/time";
import { OTHER_SENDER, SENDER_LABEL, type Message, type Sender } from "@/lib/types";

type ChatRoomProps = {
  sender: Sender;
  onSwitchIdentity: () => void;
};

type CreateMessageRequest = {
  sender: Sender;
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

function sortMessagesByCreatedAt(messages: Message[]) {
  return [...messages].sort((first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime());
}

function areMessagesEquivalent(first: Message[], second: Message[]) {
  return (
    first.length === second.length &&
    first.every((message, index) => {
      const nextMessage = second[index];

      return (
        message.id === nextMessage?.id &&
        message.updatedAt === nextMessage.updatedAt &&
        message.readAt === nextMessage.readAt &&
        message.clientStatus === nextMessage.clientStatus
      );
    })
  );
}

function mergeLoadedMessages(currentMessages: Message[], loadedMessages: Message[]) {
  const loadedIds = new Set(loadedMessages.map((message) => message.id));
  const pendingMessages = currentMessages.filter(
    (message) => message.clientStatus && message.id.startsWith("optimistic-") && !loadedIds.has(message.id)
  );

  const mergedMessages = sortMessagesByCreatedAt([...loadedMessages, ...pendingMessages]);
  return areMessagesEquivalent(currentMessages, mergedMessages) ? currentMessages : mergedMessages;
}

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
  const typingStopTimerRef = useRef<number | null>(null);
  const otherTypingTimerRef = useRef<number | null>(null);
  const readSyncRef = useRef(false);
  const hasSentTypingRef = useRef(false);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedMessageTrackingRef = useRef(false);

  const otherSender = OTHER_SENDER[sender];

  const loadMessages = useCallback(async () => {
    if (loadMessagesPromiseRef.current) {
      return loadMessagesPromiseRef.current;
    }

    const request = (async () => {
      const response = await fetch("/api/messages", {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("無法載入訊息");
      }

      const data = (await response.json()) as { messages: Message[] };
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

    function getPollingDelay() {
      if (document.hidden) {
        return realtimeConnectedRef.current
          ? MESSAGE_REALTIME_BACKGROUND_POLLING_INTERVAL_MS
          : MESSAGE_FALLBACK_BACKGROUND_POLLING_INTERVAL_MS;
      }

      return realtimeConnectedRef.current ? MESSAGE_REALTIME_HEALTH_CHECK_MS : MESSAGE_FALLBACK_POLLING_INTERVAL_MS;
    }

    function schedulePoll(delay = getPollingDelay()) {
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

    const realtimeLease = acquireRealtimeChannel();

    if (!realtimeLease) {
      realtimeConnectedRef.current = false;
      schedulePoll();

      return () => {
        isStopped = true;
        document.removeEventListener("visibilitychange", handleVisibilityChange);

        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      };
    }

    const { pusher, channel } = realtimeLease;
    realtimeConnectedRef.current = pusher.connection.state === "connected";
    const handleStateChange = ({ current }: { current: string }) => {
      const isConnected = current === "connected";
      const wasConnected = realtimeConnectedRef.current;
      realtimeConnectedRef.current = isConnected;

      if (wasConnected !== isConnected) {
        schedulePoll(isConnected ? MESSAGE_REALTIME_HEALTH_CHECK_MS : 0);
      }
    };
    const handleMessagesChanged = () => {
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

    pusher.connection.bind("state_change", handleStateChange);
    channel.bind(PUSHER_EVENT_MESSAGES_CHANGED, handleMessagesChanged);
    channel.bind(PUSHER_EVENT_TYPING_CHANGED, handleTypingChanged);
    schedulePoll();

    return () => {
      isStopped = true;
      realtimeConnectedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (otherTypingTimerRef.current) {
        window.clearTimeout(otherTypingTimerRef.current);
      }
      pusher.connection.unbind("state_change", handleStateChange);
      channel.unbind(PUSHER_EVENT_MESSAGES_CHANGED, handleMessagesChanged);
      channel.unbind(PUSHER_EVENT_TYPING_CHANGED, handleTypingChanged);
      realtimeLease.release();
    };
  }, [loadMessages, sender]);

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
    const stopInitialSettling = () => mutationObserver.disconnect();
    const jumpToBottom = () => {
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

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const persistedMessages = messages.filter((message) => !message.clientStatus);
    const knownMessageIds = knownMessageIdsRef.current;

    if (!hasInitializedMessageTrackingRef.current) {
      persistedMessages.forEach((message) => knownMessageIds.add(message.id));
      hasInitializedMessageTrackingRef.current = true;
      return;
    }

    let newIncomingMessageCount = 0;

    persistedMessages.forEach((message) => {
      if (knownMessageIds.has(message.id)) {
        return;
      }

      knownMessageIds.add(message.id);

      if (message.sender !== sender && !message.recalledAt) {
        newIncomingMessageCount += 1;
      }
    });

    if (newIncomingMessageCount === 0) {
      return;
    }

    const scrollContainer = chatScrollRef.current;
    if (isProgrammaticScrollRef.current && scrollContainer) {
      scrollContainer.scrollTo({ top: scrollContainer.scrollTop, behavior: "auto" });
    }
    stopProgrammaticScrollTracking();
    void playMessageNotificationSound();
    unreadBelowCountRef.current += newIncomingMessageCount;
    setUnreadBelowCount(unreadBelowCountRef.current);
    setIsAwayFromBottom(true);

    if (!isPageActive) {
      setUnreadCount((currentCount) => currentCount + newIncomingMessageCount);
    }
  }, [isLoading, isPageActive, messages, sender, stopProgrammaticScrollTracking]);

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
      sortMessagesByCreatedAt([
        ...currentMessages.filter((message) => message.id !== tempId && message.id !== data.message.id),
        data.message
      ])
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
        replyToMessageId: replyTarget?.id ?? null,
        replyTo: replyTarget ? toReplyMessage(replyTarget) : null,
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
        replyToMessageId: imageReplyTarget?.id ?? null,
        replyTo: imageReplyTarget ? toReplyMessage(imageReplyTarget) : null,
        clientStatus: "sending"
      });
    }

    startProgrammaticScrollTracking(1400);
    setMessages((currentMessages) => sortMessagesByCreatedAt([...currentMessages, ...optimisticMessages]));
    window.requestAnimationFrame(() => scrollToLatest("smooth"));
    setReplyTo(null);

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
          text,
          replyToMessageId: replyTarget?.id
        });
      } catch (sendError) {
        markOptimisticMessageFailed(textTempId);
        firstError = sendError;
      }
    }

    if (imageTempId) {
      const uploadResult = await imageUploadTask;

      if (uploadResult.error) {
        markOptimisticMessageFailed(imageTempId);
        firstError ??= uploadResult.error;
      } else {
        try {
          await persistOptimisticMessage(
            imageTempId,
            {
              sender,
              imageUrl: uploadResult.urls[0],
              imageUrls: uploadResult.urls,
              replyToMessageId: textTempId ? undefined : replyTarget?.id
            },
            localImageUrls.length
          );
        } catch (sendError) {
          markOptimisticMessageFailed(imageTempId);
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

  function handleStartEdit(message: Message) {
    setReplyTo(null);
    setEditing(message);
  }

  return (
    <main className="flex h-dvh flex-col bg-paper text-ink">
      <header className="border-b border-line bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
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
            <p className="truncate text-xs text-slate-500">
              你是 {SENDER_LABEL[sender]}，正在與 {SENDER_LABEL[otherSender]} 對話
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
        {isLoading ? (
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

      <ImageLightbox
        imageUrls={lightboxImages?.urls ?? []}
        initialIndex={lightboxImages?.index ?? 0}
        onClose={() => setLightboxImages(null)}
      />
    </main>
  );
}
