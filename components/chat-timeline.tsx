import { Fragment } from "react";
import { CallHistoryItem } from "@/components/call-history-item";
import { MessageBubble } from "@/components/message-bubble";
import type { CallHistoryRecord } from "@/lib/call";
import { messageIdentity } from "@/lib/message-sync";
import type { ReactionEmoji } from "@/lib/reactions";
import { getMessageMinuteKey } from "@/lib/time";
import type { Message, Sender } from "@/lib/types";

export type TimelineEntry =
  { kind: "message"; message: Message; at: string } | { kind: "call"; call: CallHistoryRecord; at: string };
const dateLabel = new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", weekday: "short" });

export function ChatTimeline({
  entries,
  sender,
  highlightedId,
  latestOwnId,
  boundary,
  onReply,
  onEdit,
  onRecall,
  onPin,
  onReaction,
  onOpenImages,
  onQuote,
  onRedial
}: {
  entries: TimelineEntry[];
  sender: Sender;
  highlightedId: string | null;
  latestOwnId: string | null;
  boundary: { id: string; count: number } | null;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onRecall: (message: Message) => void;
  onPin: (message: Message) => void;
  onReaction: (message: Message, emoji: ReactionEmoji) => void;
  onOpenImages: (urls: string[], index?: number) => void;
  onQuote: (id: string) => void;
  onRedial: () => void;
}) {
  let previousDay = "";
  let previousMessage: Message | null = null;
  return entries.map((entry) => {
    const date = new Date(entry.at);
    const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const showDate = day !== previousDay;
    previousDay = day;
    const message = entry.kind === "message" ? entry.message : null;
    const showTime = Boolean(
      message &&
      (!previousMessage ||
        getMessageMinuteKey(message.createdAt) !== getMessageMinuteKey(previousMessage.createdAt))
    );
    if (message) previousMessage = message;
    return (
      <Fragment key={entry.kind === "call" ? `call-${entry.call.id}` : `message-${entry.message.id}`}>
        {showDate ? (
          <div className="my-3 flex shrink-0 justify-center text-[11px] font-medium text-slate-400">
            <span>{dateLabel.format(date)}</span>
          </div>
        ) : null}
        {message && messageIdentity(message) === boundary?.id ? (
          <div
            id="unread-divider"
            role="separator"
            aria-label="以下為新訊息"
            className="my-3 flex shrink-0 scroll-mt-6 items-center gap-3"
          >
            <span className="h-px flex-1 bg-blue-200" />
            <span className="shrink-0 text-xs font-medium text-brand">
              以下為新訊息 · {boundary.count} 則
            </span>
            <span className="h-px flex-1 bg-blue-200" />
          </div>
        ) : null}
        {entry.kind === "call" ? (
          <CallHistoryItem call={entry.call} sender={sender} onRedial={onRedial} />
        ) : message ? (
          <MessageBubble
            message={message}
            currentSender={sender}
            isHighlighted={highlightedId === message.id}
            showTimestamp={showTime}
            readReceipt={message.id === latestOwnId ? (message.readAt ? "read" : "unread") : null}
            onReply={() => onReply(message)}
            onEdit={() => onEdit(message)}
            onRecall={() => onRecall(message)}
            onTogglePin={() => onPin(message)}
            onToggleReaction={(emoji) => onReaction(message, emoji)}
            onOpenImages={onOpenImages}
            onQuoteClick={onQuote}
          />
        ) : null}
      </Fragment>
    );
  });
}
