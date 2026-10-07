"use client";

import {
  ArrowDownToLine,
  ArrowLeft,
  ChevronRight,
  Images,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Pin,
  RefreshCw,
  Search
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatToolMode } from "@/components/chat-tools-dialog";
import { SENDER_LABEL, type Sender } from "@/lib/types";

type ChatChromeProps = {
  sender: Sender;
  otherSender: Sender;
  presence: string;
  online: boolean;
  pinnedCount: number;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onOpenTool: (tool: ChatToolMode) => void;
  onSwitchIdentity: () => void;
  onRefresh: () => void;
  voiceCall: ReactNode;
  diagnostics: ReactNode;
};

function Avatar({ sender, small = false }: { sender: Sender; small?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-semibold ${small ? "h-9 w-9 text-base" : "h-11 w-11 text-lg"} ${sender === "CHEN" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}
    >
      {SENDER_LABEL[sender]}
    </span>
  );
}

export function ChatSidebar(props: ChatChromeProps) {
  const tools = [
    { mode: "calls", label: "通話紀錄", Icon: Phone },
    { mode: "media", label: "照片與連結", Icon: Images },
    { mode: "pinned", label: "置頂訊息", Icon: Pin }
  ] as const;
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-white px-4 py-6 lg:flex">
      <div className="mb-10 flex items-center gap-2.5 px-2">
        <MessageCircle size={24} className="text-brand" />
        <span className="text-xl font-semibold">chorchat</span>
      </div>
      <p className="mb-3 px-3 text-xs font-medium text-slate-400">對話</p>
      <div className="mb-7 flex items-center gap-3 rounded-lg bg-blue-50/70 px-3 py-3">
        <Avatar sender={props.otherSender} small />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{SENDER_LABEL[props.otherSender]}</p>
          <p className="mt-1 truncate text-xs text-slate-500">{props.presence}</p>
        </div>
        <ChevronRight size={14} className="ml-auto text-brand" />
      </div>
      <nav aria-label="聊天室工具" className="space-y-1">
        {tools.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => props.onOpenTool(mode)}
            className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-ink"
          >
            <Icon size={18} />
            {label}
            {mode === "pinned" && props.pinnedCount > 0 ? (
              <span className="ml-auto text-xs text-brand">{props.pinnedCount}</span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="mt-auto space-y-4 pt-8">
        <button
          type="button"
          onClick={props.onToggleAutoScroll}
          aria-pressed={props.autoScroll}
          aria-label={`新訊息自動滑到底：${props.autoScroll ? "已開啟" : "已關閉"}`}
          className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-500 hover:bg-slate-50"
        >
          <ArrowDownToLine size={17} />
          自動滑到底
          <span
            className={`ml-auto h-2 w-2 rounded-full ${props.autoScroll ? "bg-emerald-500" : "bg-slate-300"}`}
          />
        </button>
        <div className="flex items-center gap-3 border-t border-line px-2 pt-4">
          <Avatar sender={props.sender} small />
          <span className="text-sm font-medium">{SENDER_LABEL[props.sender]}</span>
          <button
            type="button"
            onClick={props.onSwitchIdentity}
            className="ml-auto rounded-md px-2 py-2 text-xs text-slate-500 hover:bg-slate-50"
            aria-label="換身分"
          >
            換身分
          </button>
        </div>
      </div>
    </aside>
  );
}

export function ChatHeader(props: ChatChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  return (
    <header className="z-30 shrink-0 border-b border-line bg-white">
      <div className="flex h-[76px] items-center gap-3 px-3 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={props.onSwitchIdentity}
          aria-label="換身分"
          className="inline-flex h-9 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 lg:hidden"
        >
          <ArrowLeft size={19} />
        </button>
        <Avatar sender={props.otherSender} />
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">
            {SENDER_LABEL[props.otherSender]}
            <span className="ml-2 hidden text-xs font-normal text-slate-400 min-[360px]:inline lg:hidden">
              chorchat
            </span>
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${props.online ? "bg-emerald-500" : "bg-slate-300"}`}
            />
            <span className="truncate">{props.presence}</span>
          </p>
        </div>
        {props.voiceCall}
        <button
          type="button"
          onClick={() => props.onOpenTool("search")}
          aria-label="搜尋訊息"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
        >
          <Search size={19} />
        </button>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            aria-label="更多選項"
            aria-expanded={menuOpen}
            className="inline-flex h-10 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
          >
            <MoreHorizontal size={20} />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-12 max-h-[70dvh] w-[min(330px,calc(100vw-24px))] overflow-y-auto rounded-lg border border-line bg-white p-2 shadow-soft">
              <button
                type="button"
                onClick={() => {
                  props.onRefresh();
                  setMenuOpen(false);
                }}
                className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm text-slate-600 hover:bg-slate-50"
              >
                <RefreshCw size={16} />
                重新整理
              </button>
              {props.diagnostics}
            </div>
          ) : null}
        </div>
      </div>
      <nav aria-label="聊天室工具" className="grid grid-cols-4 gap-1 px-3 pb-2 lg:hidden">
        <button
          type="button"
          onClick={() => props.onOpenTool("media")}
          className="flex h-9 items-center justify-center gap-1.5 rounded-md text-xs text-slate-500 hover:bg-slate-50"
        >
          <Images size={15} />
          照片
        </button>
        <button
          type="button"
          onClick={() => props.onOpenTool("calls")}
          className="flex h-9 items-center justify-center gap-1.5 rounded-md text-xs text-slate-500 hover:bg-slate-50"
        >
          <Phone size={15} />
          通話紀錄
        </button>
        <button
          type="button"
          onClick={() => props.onOpenTool("pinned")}
          className="flex h-9 items-center justify-center gap-1.5 rounded-md text-xs text-slate-500 hover:bg-slate-50"
        >
          <Pin size={15} />
          置頂{props.pinnedCount ? ` ${props.pinnedCount}` : ""}
        </button>
        <button
          type="button"
          onClick={props.onToggleAutoScroll}
          aria-pressed={props.autoScroll}
          aria-label={`新訊息自動滑到底：${props.autoScroll ? "已開啟" : "已關閉"}`}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-md text-xs ${props.autoScroll ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-slate-50"}`}
        >
          <ArrowDownToLine size={15} />
          自動{props.autoScroll ? "開" : "關"}
        </button>
      </nav>
    </header>
  );
}
