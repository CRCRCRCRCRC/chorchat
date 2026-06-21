"use client";

import { useEffect, useState } from "react";
import { ChatRoom } from "@/components/chat-room";
import { unlockAudio } from "@/lib/audio-client";
import { SENDER_LABEL, type Sender, isSender } from "@/lib/types";

const STORAGE_KEY = "chorchat:sender";

export function HomeClient() {
  const [sender, setSender] = useState<Sender | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const savedSender = window.localStorage.getItem(STORAGE_KEY);

    if (isSender(savedSender)) {
      setSender(savedSender);
    }

    setIsHydrated(true);
  }, []);

  function chooseSender(nextSender: Sender) {
    void unlockAudio();
    window.localStorage.setItem(STORAGE_KEY, nextSender);
    setSender(nextSender);
  }

  function clearSender() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSender(null);
  }

  if (!isHydrated) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper px-5">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-brand" />
      </main>
    );
  }

  if (sender) {
    return <ChatRoom sender={sender} onSwitchIdentity={clearSender} />;
  }

  return (
    <main className="min-h-dvh bg-paper px-5 py-8 text-ink">
      <section className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col justify-center gap-10">
        <div className="max-w-3xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-brand">chorchat</p>
          <h1 className="text-4xl font-semibold leading-tight text-ink sm:text-6xl">只給陳與左的即時聊天室</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            選擇身分後進入聊天室。自己的訊息靠右，對方的訊息靠左，文字、圖片、回覆、編輯與收回都會同步更新。
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {(["CHEN", "ZUO"] as const).map((identity) => (
            <button
              key={identity}
              type="button"
              onClick={() => chooseSender(identity)}
              className="group rounded-lg border border-line bg-white p-6 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-brand focus:outline-none focus:ring-4 focus:ring-brand/20"
            >
              <span className="block text-sm font-medium text-slate-500">進入聊天室</span>
              <span className="mt-3 block text-2xl font-semibold text-ink">以{SENDER_LABEL[identity]}的身分進入</span>
              <span className="mt-5 inline-flex rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition group-hover:bg-blue-600">
                開始聊天
              </span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
