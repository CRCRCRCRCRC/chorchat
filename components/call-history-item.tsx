import { ArrowDownLeft, ArrowUpRight, Phone, PhoneMissed, RotateCcw } from "lucide-react";
import { formatCallDuration, type CallHistoryRecord } from "@/lib/call";
import { formatMessageTime } from "@/lib/time";
import type { Sender } from "@/lib/types";

export function CallHistoryItem({
  call,
  sender,
  onRedial,
  compact = false
}: {
  call: CallHistoryRecord;
  sender: Sender;
  onRedial: () => void;
  compact?: boolean;
}) {
  const outgoing = call.caller === sender;
  const missed = call.status === "missed" || call.status === "failed";
  const duration = formatCallDuration(call);
  const labels = {
    ringing: outgoing ? "正在撥號" : "來電中",
    connecting: "語音連線中",
    active: "通話中",
    completed: "語音通話",
    missed: outgoing ? "對方未接聽" : "未接來電",
    declined: outgoing ? "對方已拒接" : "已拒接來電",
    cancelled: outgoing ? "已取消通話" : "來電已取消",
    failed: "通話連線中斷"
  };
  const Icon = missed ? PhoneMissed : Phone;
  return (
    <div id={`call-${call.id}`} className={compact ? "w-full" : "my-2 flex w-full shrink-0 justify-center"}>
      <button
        type="button"
        onClick={onRedial}
        disabled={!call.endedAt}
        aria-label={`${labels[call.status]}${duration ? ` ${duration}` : ""}${call.endedAt ? "，回撥" : ""}`}
        className={`flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-left transition hover:border-slate-300 disabled:cursor-default ${compact ? "w-full" : "w-full max-w-[300px]"}`}
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${missed ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"}`}
        >
          <Icon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-medium ${missed ? "text-rose-600" : "text-ink"}`}>
            {labels[call.status]}
            {duration ? ` · ${duration}` : ""}
          </span>
          <span className="mt-1 flex items-center gap-1 text-xs text-slate-400">
            {outgoing ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
            {outgoing ? "撥出" : "來電"} · {formatMessageTime(call.startedAt)}
          </span>
        </span>
        {call.endedAt ? <RotateCcw size={14} className="shrink-0 text-slate-400" /> : null}
      </button>
    </div>
  );
}
