type SoundSnapshot = {
  latestText: string | null;
  latestInView: boolean;
  unreadLabel: string | null;
  scrollTop: number;
};

declare global {
  interface Window {
    notificationProbe: {
      sounds: SoundSnapshot[];
      holdFrames: boolean;
      releaseFrames: () => void;
    };
  }
}

// Record notification starts without relying on autoplay permissions or real speakers.
export function installNotificationProbe() {
  const requestFrame = window.requestAnimationFrame.bind(window);
  const cancelFrame = window.cancelAnimationFrame.bind(window);
  const heldFrames = new Map<number, FrameRequestCallback>();
  let nextId = -1;
  const probe = window.notificationProbe = {
    sounds: [] as SoundSnapshot[],
    holdFrames: false,
    releaseFrames() {
      probe.holdFrames = false;
      heldFrames.forEach((callback) => requestFrame(callback));
      heldFrames.clear();
    }
  };
  window.requestAnimationFrame = (callback) => {
    if (!probe.holdFrames) return requestFrame(callback);
    const id = nextId--;
    heldFrames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (id < 0) heldFrames.delete(id);
    else cancelFrame(id);
  };

  class TestAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    createOscillator() {
      let frequency = 0;
      return {
        type: "sine",
        frequency: { setValueAtTime(value: number) { frequency = value; } },
        connect() {},
        stop() {},
        start() {
          if (frequency !== 880) return;
          const latest = document.querySelector("article[id^='message-']:last-of-type");
          const scroller = latest?.closest("section");
          const messageRect = latest?.getBoundingClientRect();
          const scrollRect = scroller?.getBoundingClientRect();
          const unread = [...document.querySelectorAll("button[aria-label]")]
            .find((button) => button.getAttribute("aria-label")?.includes("\u5247\u672a\u8b80\u8a0a\u606f"));
          probe.sounds.push({
            latestText: latest?.textContent ?? null,
            latestInView: Boolean(messageRect && scrollRect && messageRect.top >= scrollRect.top && messageRect.bottom <= scrollRect.bottom),
            unreadLabel: unread?.getAttribute("aria-label") ?? null,
            scrollTop: scroller?.scrollTop ?? 0
          });
        }
      };
    }
  }
  Object.defineProperty(window, "AudioContext", { value: TestAudioContext });
}
