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
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5">
      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        {(["CHEN", "ZUO"] as const).map((identity) => (
          <button
            key={identity}
            type="button"
            onClick={() => chooseSender(identity)}
            className="h-16 rounded-md border border-line bg-white text-xl font-semibold text-ink shadow-sm transition hover:border-brand hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-brand/20"
          >
            {SENDER_LABEL[identity]}
          </button>
        ))}
      </div>
    </main>
  );
}
