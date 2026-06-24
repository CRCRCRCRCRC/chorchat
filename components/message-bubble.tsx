"use client";

/* eslint-disable @next/next/no-img-element */

import clsx from "clsx";
import { MoreHorizontal, Pin } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { LinkifiedText } from "@/components/linkified-text";
import { LinkPreviewCard } from "@/components/link-preview-card";
import { getFirstUrl } from "@/lib/links";
import { getMessageImageUrls, getReplyPreview } from "@/lib/messages";
import { REACTION_EMOJIS, type ReactionEmoji } from "@/lib/reactions";
import { canEditMessage, formatMessageTime } from "@/lib/time";
import { SENDER_LABEL, type Message, type Sender } from "@/lib/types";

type MessageBubbleProps = {
  message: Message;
  currentSender: Sender;
  isHighlighted: boolean;
  showTimestamp: boolean;
  readReceipt: "read" | "unread" | null;
  onReply: () => void;
  onEdit: () => void;
  onRecall: () => void;
  onTogglePin: () => void;
  onToggleReaction: (emoji: ReactionEmoji) => void;
  onOpenImages: (urls: string[], index?: number) => void;
  onQuoteClick: (messageId: string) => void;
};

type MessageImageGalleryProps = {
  imageUrls: string[];
  isOwn: boolean;
  senderLabel: string;
  onOpenImages: (urls: string[], index?: number) => void;
};

function areStringArraysEqual(first: string[], second: string[]) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function areReactionsEqual(first: Message["reactions"], second: Message["reactions"]) {
  return (
    first.length === second.length &&
    first.every(
      (reaction, index) =>
        reaction.id === second[index]?.id &&
        reaction.sender === second[index]?.sender &&
        reaction.emoji === second[index]?.emoji
    )
  );
}

function areMessageBubblePropsEqual(first: MessageBubbleProps, second: MessageBubbleProps) {
  const firstMessage = first.message;
  const secondMessage = second.message;
  const firstReply = firstMessage.replyTo;
  const secondReply = secondMessage.replyTo;

  return (
    first.currentSender === second.currentSender &&
    first.isHighlighted === second.isHighlighted &&
    first.showTimestamp === second.showTimestamp &&
    first.readReceipt === second.readReceipt &&
    firstMessage.id === secondMessage.id &&
    firstMessage.sender === secondMessage.sender &&
    firstMessage.text === secondMessage.text &&
    firstMessage.imageUrl === secondMessage.imageUrl &&
    areStringArraysEqual(firstMessage.imageUrls ?? [], secondMessage.imageUrls ?? []) &&
    firstMessage.updatedAt === secondMessage.updatedAt &&
    firstMessage.editedAt === secondMessage.editedAt &&
    firstMessage.recalledAt === secondMessage.recalledAt &&
    firstMessage.readAt === secondMessage.readAt &&
    firstMessage.pinnedAt === secondMessage.pinnedAt &&
    firstMessage.pinnedBy === secondMessage.pinnedBy &&
    areReactionsEqual(firstMessage.reactions ?? [], secondMessage.reactions ?? []) &&
    firstMessage.clientStatus === secondMessage.clientStatus &&
    firstMessage.replyToMessageId === secondMessage.replyToMessageId &&
    firstReply?.id === secondReply?.id &&
    firstReply?.sender === secondReply?.sender &&
    firstReply?.text === secondReply?.text &&
    firstReply?.imageUrl === secondReply?.imageUrl &&
    firstReply?.editedAt === secondReply?.editedAt &&
    firstReply?.recalledAt === secondReply?.recalledAt &&
    areStringArraysEqual(firstReply?.imageUrls ?? [], secondReply?.imageUrls ?? [])
  );
}

function MessageImageGallery({ imageUrls, isOwn, senderLabel, onOpenImages }: MessageImageGalleryProps) {
  if (imageUrls.length === 0) {
    return null;
  }

  if (imageUrls.length === 1) {
    return (
      <button
        type="button"
        onClick={() => onOpenImages(imageUrls, 0)}
        className="mb-2 block overflow-hidden rounded-md bg-black/5 focus:outline-none focus:ring-4 focus:ring-brand/20"
        aria-label="開啟圖片預覽"
      >
        <img
          src={imageUrls[0]}
          alt="聊天圖片"
          className="h-[220px] w-[min(70vw,360px)] rounded-md object-contain sm:h-[240px]"
          loading="lazy"
          decoding="async"
        />
      </button>
    );
  }

  const visibleImages = imageUrls.slice(0, 4);
  const galleryClass =
    imageUrls.length === 2
      ? "h-[220px] grid-cols-2 grid-rows-1 sm:h-[240px]"
      : "h-[260px] grid-cols-2 grid-rows-2 sm:h-[300px]";

  return (
    <div className="mb-2">
      <p className={clsx("mb-1 px-1 text-sm", isOwn ? "text-white/90" : "text-slate-600")}>
        {senderLabel}傳送了 {imageUrls.length} 張相片
      </p>
      <div
        className={clsx(
          "grid w-[min(76vw,380px)] gap-1 overflow-hidden rounded-md",
          galleryClass
        )}
      >
        {visibleImages.map((imageUrl, index) => {
          const isLargeFirstImage = imageUrls.length === 3 && index === 0;
          const remainingCount = imageUrls.length - visibleImages.length;
          const showRemainingCount = index === 3 && remainingCount > 0;

          return (
            <button
              key={`${imageUrl}-${index}`}
              type="button"
              onClick={() => onOpenImages(imageUrls, index)}
              className={clsx(
                "relative min-h-0 overflow-hidden bg-black/10 focus:outline-none focus:ring-4 focus:ring-inset focus:ring-brand/30",
                isLargeFirstImage && "row-span-2"
              )}
              aria-label={`開啟第 ${index + 1} 張相片，共 ${imageUrls.length} 張`}
            >
              <img
                src={imageUrl}
                alt={`聊天相片 ${index + 1}`}
                className="h-full w-full object-contain"
                loading="lazy"
                decoding="async"
              />
              {showRemainingCount ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-semibold text-white">
                  +{remainingCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MessageBubbleComponent({
  message,
  currentSender,
  isHighlighted,
  showTimestamp,
  readReceipt,
  onReply,
  onEdit,
  onRecall,
  onTogglePin,
  onToggleReaction,
  onOpenImages,
  onQuoteClick
}: MessageBubbleProps) {
  const isOwn = message.sender === currentSender;
  const isRecalled = Boolean(message.recalledAt);
  const isClientOnly = Boolean(message.clientStatus);
  const editable = isOwn && !isClientOnly && canEditMessage(message.createdAt, message.recalledAt);
  const imageUrls = isRecalled ? [] : getMessageImageUrls(message);
  const hasVisibleContent = !isRecalled && (message.text || imageUrls.length > 0);
  const hasStatus = Boolean(message.editedAt && !isRecalled) || Boolean(message.clientStatus) || Boolean(message.pinnedAt);
  const showMeta = showTimestamp || hasStatus;
  const previewUrl = !isRecalled ? getFirstUrl(message.text) : null;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const reactionGroups = REACTION_EMOJIS.map((emoji) => ({
    emoji,
    reactions: (message.reactions ?? []).filter((reaction) => reaction.emoji === emoji)
  })).filter((group) => group.reactions.length > 0);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  function runAction(action: () => void) {
    setIsMenuOpen(false);
    action();
  }

  return (
    <article
      id={`message-${message.id}`}
      className={clsx(
        "group flex w-full scroll-mt-20 gap-2 transition",
        isOwn ? "justify-end" : "justify-start",
        isHighlighted && "rounded-lg bg-yellow-100/70 py-2"
      )}
    >
      <div className={clsx("flex max-w-[90%] items-end gap-2 sm:max-w-[78%]", isOwn && "flex-row-reverse")}>
        <div className={clsx("flex min-w-0 flex-col gap-1", isOwn ? "items-end" : "items-start")}>
          {showMeta ? (
            <div className={clsx("flex items-center gap-2 text-xs text-slate-500", isOwn && "flex-row-reverse")}>
              {showTimestamp ? <span>{isOwn ? "你" : SENDER_LABEL[message.sender]}</span> : null}
              {showTimestamp ? <span>{formatMessageTime(message.createdAt)}</span> : null}
              {message.editedAt && !isRecalled ? <span>已編輯</span> : null}
              {message.pinnedAt && !isRecalled ? (
                <span className="inline-flex items-center gap-1"><Pin size={11} />已置頂</span>
              ) : null}
              {message.clientStatus === "sending" ? <span>傳送中</span> : null}
              {message.clientStatus === "failed" ? <span className="text-red-600">傳送失敗</span> : null}
            </div>
          ) : null}

          <div
            className={clsx(
              "rounded-lg px-3 py-2 shadow-sm",
              isOwn ? "bg-brand text-white" : "bg-white text-ink",
              message.clientStatus === "sending" && "opacity-75",
              message.clientStatus === "failed" && "border border-red-200 bg-red-50 text-red-700",
              isRecalled && "border border-dashed border-slate-300 bg-transparent text-slate-500 shadow-none"
            )}
          >
            {message.replyTo && !isRecalled ? (
              <button
                type="button"
                onClick={() => onQuoteClick(message.replyTo?.id ?? "")}
                className={clsx(
                  "mb-2 flex w-full min-w-0 items-center gap-2 rounded-md border-l-4 px-2 py-2 text-left text-sm transition",
                  isOwn
                    ? "border-white/70 bg-white/15 text-white hover:bg-white/20"
                    : "border-brand bg-slate-50 text-slate-600 hover:bg-slate-100"
                )}
              >
                {getMessageImageUrls(message.replyTo).length > 0 && !message.replyTo.recalledAt ? (
                  <img
                    src={getMessageImageUrls(message.replyTo)[0]}
                    alt="回覆圖片縮圖"
                    className="h-9 w-9 shrink-0 rounded-md object-contain"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
                <span className="min-w-0 truncate">{getReplyPreview(message.replyTo)}</span>
              </button>
            ) : null}

            {isRecalled ? (
              <p className="text-sm italic">{isOwn ? "你已收回一則訊息" : "對方已收回一則訊息"}</p>
            ) : null}

            <MessageImageGallery
              imageUrls={imageUrls}
              isOwn={isOwn}
              senderLabel={isOwn ? "你" : SENDER_LABEL[message.sender]}
              onOpenImages={onOpenImages}
            />

            {message.text && !isRecalled ? <LinkifiedText text={message.text} isOwn={isOwn} /> : null}

            {previewUrl ? <LinkPreviewCard url={previewUrl} /> : null}

            {!hasVisibleContent && !isRecalled ? <p className="text-sm text-slate-400">空訊息</p> : null}
          </div>
          {!isRecalled && reactionGroups.length > 0 ? (
            <div className={clsx("flex flex-wrap gap-1 px-1", isOwn ? "justify-end" : "justify-start")}>
              {reactionGroups.map(({ emoji, reactions }) => {
                const isSelected = reactions.some((reaction) => reaction.sender === currentSender);
                const reactedBy = reactions.map((reaction) => SENDER_LABEL[reaction.sender]).join("、");

                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onToggleReaction(emoji)}
                    aria-pressed={isSelected}
                    title={reactedBy}
                    className={clsx(
                      "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition",
                      isSelected
                        ? "border-brand bg-blue-50 text-brand"
                        : "border-line bg-white text-slate-700 hover:border-slate-300"
                    )}
                  >
                    <span>{emoji}</span>
                    <span>{reactions.length}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {readReceipt ? (
            <div className={clsx("px-1 text-xs text-slate-500", isOwn ? "text-right" : "text-left")}>
              {readReceipt === "read" ? "已讀" : "未讀"}
            </div>
          ) : null}
        </div>

        {!isClientOnly ? (
          <div
            ref={menuRef}
            className={clsx(
              "relative shrink-0 transition",
              isMenuOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-auto opacity-100 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
            )}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setIsMenuOpen((current) => !current);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-800"
              aria-label="訊息操作"
            >
              <MoreHorizontal size={15} />
            </button>
            {isMenuOpen ? (
              <div
                className={clsx(
                  "absolute bottom-10 z-10 min-w-[216px] rounded-lg border border-line bg-white p-1 text-sm shadow-soft",
                  isOwn ? "right-0" : "left-0"
                )}
                onClick={(event) => event.stopPropagation()}
              >
                {!isRecalled ? (
                  <div className="mb-1 flex items-center justify-between gap-1 border-b border-line px-1 pb-1">
                    {REACTION_EMOJIS.map((emoji) => {
                      const isSelected = (message.reactions ?? []).some(
                        (reaction) => reaction.sender === currentSender && reaction.emoji === emoji
                      );

                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => runAction(() => onToggleReaction(emoji))}
                          aria-label={`回應 ${emoji}`}
                          aria-pressed={isSelected}
                          className={clsx(
                            "inline-flex h-8 w-8 items-center justify-center rounded-md text-base hover:bg-slate-100",
                            isSelected && "bg-blue-50"
                          )}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => runAction(onReply)}
                  className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50"
                >
                  回覆
                </button>
                {!isRecalled ? (
                  <button
                    type="button"
                    onClick={() => runAction(onTogglePin)}
                    className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50"
                  >
                    {message.pinnedAt ? "取消置頂" : "置頂"}
                  </button>
                ) : null}
                {editable ? (
                  <button
                    type="button"
                    onClick={() => runAction(onEdit)}
                    className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50"
                  >
                    編輯
                  </button>
                ) : null}
                {isOwn && !isRecalled ? (
                  <button
                    type="button"
                    onClick={() => runAction(onRecall)}
                    className="block w-full rounded-md px-3 py-2 text-left text-red-600 hover:bg-red-50"
                  >
                    收回
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const MessageBubble = memo(MessageBubbleComponent, areMessageBubblePropsEqual);
