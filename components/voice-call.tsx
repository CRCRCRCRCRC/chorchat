"use client";

import clsx from "clsx";
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { playToneSequence, unlockAudio } from "@/lib/audio-client";
import type { CallSignal, CallSignalType } from "@/lib/call";
import { acquireRealtimeChannel } from "@/lib/pusher-client";
import { PUSHER_EVENT_CALL_SIGNAL } from "@/lib/realtime";
import { SENDER_LABEL, type Sender } from "@/lib/types";

type CallStatus = "idle" | "calling" | "ringing" | "connecting" | "reconnecting" | "active";
type RingMode = "outgoing" | "incoming";

type VoiceCallProps = {
  sender: Sender;
  recipient: Sender;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" }
];
const SIGNAL_FAST_POLLING_INTERVAL_MS = 500;
const SIGNAL_IDLE_FALLBACK_POLLING_INTERVAL_MS = 1000;
const SIGNAL_IDLE_REALTIME_POLLING_INTERVAL_MS = 2000;
const SIGNAL_BACKGROUND_REALTIME_POLLING_INTERVAL_MS = 10000;
const SIGNAL_BACKGROUND_FALLBACK_POLLING_INTERVAL_MS = 1500;
const SIGNAL_POLLING_LOOKBACK_MS = 1500;
const CALL_ANSWER_TIMEOUT_MS = 30000;
const DISCONNECT_GRACE_MS = 8000;

function createCallId() {
  if (globalThis.crypto?.randomUUID) {
    return "call-" + globalThis.crypto.randomUUID();
  }

  return "call-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

export function VoiceCall({ sender, recipient }: VoiceCallProps) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const statusRef = useRef(status);
  const callIdRef = useRef<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localStreamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const ringtoneIntervalRef = useRef<number | null>(null);
  const callTimeoutRef = useRef<number | null>(null);
  const disconnectTimeoutRef = useRef<number | null>(null);
  const callStartedAtRef = useRef<number | null>(null);
  const seenSignalIdsRef = useRef<Set<string>>(new Set());
  const lastSignalPollAtRef = useRef(new Date(Date.now() - 5000).toISOString());
  const pusherConnectedRef = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    seenSignalIdsRef.current.clear();
    lastSignalPollAtRef.current = new Date(Date.now() - 5000).toISOString();
  }, [sender]);

  const clearCallTimeout = useCallback(() => {
    if (callTimeoutRef.current) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  const clearDisconnectTimeout = useCallback(() => {
    if (disconnectTimeoutRef.current) {
      window.clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringtoneIntervalRef.current) {
      window.clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }
  }, []);

  const playRingtonePattern = useCallback((mode: RingMode) => {
    if (mode === "incoming") {
      return playToneSequence([
        { frequency: 740, duration: 0.18, volume: 0.08 },
        { frequency: 740, start: 0.28, duration: 0.18, volume: 0.08 }
      ]);
    }

    return playToneSequence([
      { frequency: 520, duration: 0.16, volume: 0.07 },
      { frequency: 660, start: 0.22, duration: 0.16, volume: 0.07 }
    ]);
  }, []);

  const startRingtone = useCallback(
    (mode: RingMode) => {
      stopRingtone();
      void unlockAudio().then(() => {
        void playRingtonePattern(mode);
        ringtoneIntervalRef.current = window.setInterval(
          () => void playRingtonePattern(mode),
          mode === "incoming" ? 1400 : 1900
        );
      });
    },
    [playRingtonePattern, stopRingtone]
  );

  useEffect(() => {
    function handleFirstInteraction() {
      void unlockAudio();
    }

    document.addEventListener("pointerdown", handleFirstInteraction, { once: true });
    document.addEventListener("keydown", handleFirstInteraction, { once: true });

    return () => {
      document.removeEventListener("pointerdown", handleFirstInteraction);
      document.removeEventListener("keydown", handleFirstInteraction);
    };
  }, []);

  useEffect(() => {
    if (status === "calling") {
      startRingtone("outgoing");
      return;
    }

    if (status === "ringing") {
      startRingtone("incoming");
      return;
    }

    stopRingtone();
  }, [startRingtone, status, stopRingtone]);

  useEffect(() => {
    if (!["active", "reconnecting"].includes(status) || !callStartedAtRef.current) {
      return;
    }

    const updateDuration = () => {
      if (callStartedAtRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - callStartedAtRef.current) / 1000));
      }
    };

    updateDuration();
    const intervalId = window.setInterval(updateDuration, 1000);
    return () => window.clearInterval(intervalId);
  }, [status]);

  const sendSignal = useCallback(
    async (type: CallSignalType, nextCallId: string, payload?: CallSignal["payload"]) => {
      const response = await fetch("/api/call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type,
          callId: nextCallId,
          from: sender,
          to: recipient,
          payload
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "通話訊號傳送失敗。"));
      }
    },
    [recipient, sender]
  );

  const cleanupCall = useCallback(() => {
    clearCallTimeout();
    clearDisconnectTimeout();
    stopRingtone();

    const peerConnection = peerConnectionRef.current;
    peerConnectionRef.current = null;

    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
    }

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    localStreamPromiseRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    pendingCandidatesRef.current = [];
    callIdRef.current = null;
    callStartedAtRef.current = null;
    setElapsedSeconds(0);
    setStatus("idle");
    setIsMuted(false);
  }, [clearCallTimeout, clearDisconnectTimeout, stopRingtone]);

  const endCallWithError = useCallback(
    (message: string) => {
      cleanupCall();
      setIsPanelOpen(true);
      setError(message);
    },
    [cleanupCall]
  );

  const closePanel = useCallback(() => {
    setError(null);
    setIsPanelOpen(false);
  }, []);

  const getLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("這個瀏覽器不支援語音通話。");
    }

    localStreamPromiseRef.current ??= navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      })
      .then((stream) => {
        localStreamRef.current = stream;
        return stream;
      })
      .finally(() => {
        localStreamPromiseRef.current = null;
      });

    return localStreamPromiseRef.current;
  }, []);

  const addPendingCandidates = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;

    if (!peerConnection?.remoteDescription) {
      return;
    }

    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];

    for (const candidate of candidates) {
      await peerConnection.addIceCandidate(candidate).catch(() => undefined);
    }
  }, []);

  const createPeerConnection = useCallback(
    (nextCallId: string) => {
      const existingConnection = peerConnectionRef.current;

      if (existingConnection) {
        existingConnection.onicecandidate = null;
        existingConnection.ontrack = null;
        existingConnection.onconnectionstatechange = null;
        existingConnection.close();
      }

      const peerConnection = new RTCPeerConnection({
        iceServers: ICE_SERVERS
      });

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          void sendSignal("ice-candidate", nextCallId, {
            candidate: event.candidate.toJSON()
          }).catch(() => undefined);
        }
      };

      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;

        if (remoteAudioRef.current && remoteStream) {
          remoteAudioRef.current.srcObject = remoteStream;
          void remoteAudioRef.current.play().catch(() => undefined);
        }

        clearCallTimeout();
        clearDisconnectTimeout();
        callStartedAtRef.current ??= Date.now();
        setStatus("active");
      };

      peerConnection.onconnectionstatechange = () => {
        const connectionState = peerConnection.connectionState;

        if (connectionState === "connected") {
          clearCallTimeout();
          clearDisconnectTimeout();
          callStartedAtRef.current ??= Date.now();
          setStatus("active");
          return;
        }

        if (connectionState === "disconnected") {
          setStatus("reconnecting");
          clearDisconnectTimeout();
          disconnectTimeoutRef.current = window.setTimeout(() => {
            void sendSignal("hangup", nextCallId).catch(() => undefined);
            endCallWithError("通話連線中斷。");
          }, DISCONNECT_GRACE_MS);
          return;
        }

        if (connectionState === "failed") {
          void sendSignal("hangup", nextCallId).catch(() => undefined);
          endCallWithError("語音通話連線失敗。");
        }
      };

      peerConnectionRef.current = peerConnection;
      return peerConnection;
    },
    [clearCallTimeout, clearDisconnectTimeout, endCallWithError, sendSignal]
  );

  const addLocalTracks = useCallback(
    async (peerConnection: RTCPeerConnection) => {
      const localStream = await getLocalStream();
      const existingTrackIds = new Set(peerConnection.getSenders().map((streamSender) => streamSender.track?.id));

      localStream.getTracks().forEach((track) => {
        if (!existingTrackIds.has(track.id)) {
          peerConnection.addTrack(track, localStream);
        }
      });
    },
    [getLocalStream]
  );

  const startCall = useCallback(async () => {
    setError(null);
    setIsPanelOpen(true);

    const nextCallId = createCallId();
    callIdRef.current = nextCallId;
    setStatus("calling");

    try {
      await sendSignal("call-request", nextCallId);
      callTimeoutRef.current = window.setTimeout(() => {
        void sendSignal("hangup", nextCallId).catch(() => undefined);
        endCallWithError("對方未接聽。");
      }, CALL_ANSWER_TIMEOUT_MS);
      await getLocalStream();
    } catch (callError) {
      await sendSignal("hangup", nextCallId).catch(() => undefined);
      endCallWithError(callError instanceof Error ? callError.message : "無法開始語音通話。");
    }
  }, [endCallWithError, getLocalStream, sendSignal]);

  const acceptCall = useCallback(async () => {
    const activeCallId = callIdRef.current;

    if (!activeCallId) {
      return;
    }

    clearCallTimeout();
    setError(null);
    setStatus("connecting");

    try {
      const peerConnection = createPeerConnection(activeCallId);
      await addLocalTracks(peerConnection);
      await sendSignal("call-accept", activeCallId);
    } catch (callError) {
      await sendSignal("hangup", activeCallId).catch(() => undefined);
      endCallWithError(callError instanceof Error ? callError.message : "無法接聽語音通話。");
    }
  }, [addLocalTracks, clearCallTimeout, createPeerConnection, endCallWithError, sendSignal]);

  const rejectCall = useCallback(async () => {
    const activeCallId = callIdRef.current;

    if (activeCallId) {
      await sendSignal("call-reject", activeCallId).catch(() => undefined);
    }

    cleanupCall();
    setIsPanelOpen(false);
  }, [cleanupCall, sendSignal]);

  const hangUp = useCallback(async () => {
    const activeCallId = callIdRef.current;

    if (activeCallId) {
      await sendSignal("hangup", activeCallId).catch(() => undefined);
    }

    cleanupCall();
    setIsPanelOpen(false);
  }, [cleanupCall, sendSignal]);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  }, [isMuted]);

  const markSignalSeen = useCallback((signal: CallSignal) => {
    const fallbackKey = [
      signal.type,
      signal.callId,
      signal.from,
      signal.to,
      signal.createdAt ?? "",
      JSON.stringify(signal.payload ?? {})
    ].join(":");
    const signalKey = signal.id ?? fallbackKey;
    const seenSignals = seenSignalIdsRef.current;

    if (seenSignals.has(signalKey)) {
      return false;
    }

    seenSignals.add(signalKey);

    if (seenSignals.size > 500) {
      const oldestSignal = seenSignals.values().next().value;

      if (oldestSignal) {
        seenSignals.delete(oldestSignal);
      }
    }

    return true;
  }, []);

  const handleSignal = useCallback(
    async (signal: CallSignal) => {
      if (signal.to !== sender || signal.from !== recipient) {
        return;
      }

      if (signal.type === "call-request") {
        if (statusRef.current !== "idle") {
          await sendSignal("call-reject", signal.callId).catch(() => undefined);
          return;
        }

        callIdRef.current = signal.callId;
        setIsPanelOpen(true);
        setError(null);
        setStatus("ringing");
        callTimeoutRef.current = window.setTimeout(() => {
          void sendSignal("call-reject", signal.callId).catch(() => undefined);
          endCallWithError("未接來電已結束。");
        }, CALL_ANSWER_TIMEOUT_MS);
        return;
      }

      if (signal.callId !== callIdRef.current) {
        return;
      }

      if (signal.type === "call-reject") {
        endCallWithError(SENDER_LABEL[recipient] + " 沒有接聽。");
        return;
      }

      if (signal.type === "hangup") {
        endCallWithError(SENDER_LABEL[recipient] + " 已掛斷。");
        return;
      }

      if (signal.type === "call-accept") {
        clearCallTimeout();
        setStatus("connecting");

        try {
          const peerConnection = createPeerConnection(signal.callId);
          await addLocalTracks(peerConnection);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          await sendSignal("offer", signal.callId, { offer });
        } catch (callError) {
          await sendSignal("hangup", signal.callId).catch(() => undefined);
          endCallWithError(callError instanceof Error ? callError.message : "語音通話連線失敗。");
        }
        return;
      }

      if (signal.type === "offer" && signal.payload?.offer) {
        const peerConnection = peerConnectionRef.current ?? createPeerConnection(signal.callId);

        try {
          await addLocalTracks(peerConnection);
          await peerConnection.setRemoteDescription(signal.payload.offer);
          await addPendingCandidates();
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await sendSignal("answer", signal.callId, { answer });
          setStatus("connecting");
        } catch (callError) {
          await sendSignal("hangup", signal.callId).catch(() => undefined);
          endCallWithError(callError instanceof Error ? callError.message : "語音通話連線失敗。");
        }
        return;
      }

      if (signal.type === "answer" && signal.payload?.answer) {
        const peerConnection = peerConnectionRef.current;

        if (peerConnection) {
          await peerConnection.setRemoteDescription(signal.payload.answer).catch(() => undefined);
          await addPendingCandidates();
          callStartedAtRef.current ??= Date.now();
          setStatus("active");
        }
        return;
      }

      if (signal.type === "ice-candidate" && signal.payload?.candidate) {
        const peerConnection = peerConnectionRef.current;

        if (!peerConnection?.remoteDescription) {
          pendingCandidatesRef.current.push(signal.payload.candidate);
          return;
        }

        await peerConnection.addIceCandidate(signal.payload.candidate).catch(() => undefined);
      }
    },
    [
      addLocalTracks,
      addPendingCandidates,
      clearCallTimeout,
      createPeerConnection,
      endCallWithError,
      recipient,
      sendSignal,
      sender
    ]
  );

  const receiveSignal = useCallback(
    async (signal: CallSignal) => {
      if (!markSignalSeen(signal)) {
        return;
      }

      await handleSignal(signal);
    },
    [handleSignal, markSignalSeen]
  );

  useEffect(() => {
    const realtimeLease = acquireRealtimeChannel();

    if (!realtimeLease) {
      return;
    }

    const { pusher, channel } = realtimeLease;
    pusherConnectedRef.current = pusher.connection.state === "connected";
    const handleStateChange = ({ current }: { current: string }) => {
      pusherConnectedRef.current = current === "connected";
    };
    const handleCallSignal = (signal: CallSignal) => {
      void receiveSignal(signal);
    };

    pusher.connection.bind("state_change", handleStateChange);
    channel.bind(PUSHER_EVENT_CALL_SIGNAL, handleCallSignal);

    return () => {
      pusherConnectedRef.current = false;
      pusher.connection.unbind("state_change", handleStateChange);
      channel.unbind(PUSHER_EVENT_CALL_SIGNAL, handleCallSignal);
      realtimeLease.release();
    };
  }, [receiveSignal]);

  useEffect(() => {
    let isStopped = false;
    let timeoutId: number | null = null;

    function getPollingDelay() {
      if (document.hidden) {
        return pusherConnectedRef.current
          ? SIGNAL_BACKGROUND_REALTIME_POLLING_INTERVAL_MS
          : SIGNAL_BACKGROUND_FALLBACK_POLLING_INTERVAL_MS;
      }

      if (statusRef.current !== "idle") {
        return SIGNAL_FAST_POLLING_INTERVAL_MS;
      }

      return pusherConnectedRef.current
        ? SIGNAL_IDLE_REALTIME_POLLING_INTERVAL_MS
        : SIGNAL_IDLE_FALLBACK_POLLING_INTERVAL_MS;
    }

    function schedulePoll(delay = getPollingDelay()) {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        void pollSignals().finally(() => {
          if (!isStopped) {
            schedulePoll();
          }
        });
      }, delay);
    }

    function handleVisibilityChange() {
      schedulePoll();
    }

    async function pollSignals() {
      const since = new Date(
        new Date(lastSignalPollAtRef.current).getTime() - SIGNAL_POLLING_LOOKBACK_MS
      ).toISOString();

      try {
        const response = await fetch("/api/call?to=" + sender + "&since=" + encodeURIComponent(since), {
          cache: "no-store"
        });

        if (!response.ok || isStopped) {
          return;
        }

        const data = (await response.json()) as { signals?: CallSignal[] };
        const signals = data.signals ?? [];
        let latestSignalTime = new Date(lastSignalPollAtRef.current).getTime();

        for (const signal of signals) {
          if (signal.createdAt) {
            latestSignalTime = Math.max(latestSignalTime, new Date(signal.createdAt).getTime());
          }

          await receiveSignal(signal);
        }

        lastSignalPollAtRef.current = new Date(Math.max(latestSignalTime, Date.now())).toISOString();
      } catch {
        // Retried on the next adaptive polling tick.
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void pollSignals().finally(() => {
      if (!isStopped) {
        schedulePoll();
      }
    });

    return () => {
      isStopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [receiveSignal, sender]);

  useEffect(() => {
    return () => {
      cleanupCall();
    };
  }, [cleanupCall]);

  const showCallPanel = isPanelOpen || status !== "idle" || Boolean(error);
  const statusText =
    status === "calling"
      ? "正在撥打 " + SENDER_LABEL[recipient]
      : status === "ringing"
        ? SENDER_LABEL[recipient] + " 來電"
        : status === "connecting"
          ? "語音連線中"
          : status === "reconnecting"
            ? "連線不穩，正在重新連線"
            : status === "active"
              ? "與 " + SENDER_LABEL[recipient] + " 通話中"
              : error;

  return (
    <>
      <button
        type="button"
        onClick={() => void startCall()}
        disabled={status !== "idle"}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-brand/20"
        aria-label="語音通話"
        title="語音通話"
      >
        <Phone size={17} />
      </button>

      <audio ref={remoteAudioRef} autoPlay playsInline />

      {showCallPanel ? (
        <div
          role="dialog"
          aria-live="assertive"
          className="fixed right-4 top-20 z-[1000] w-[min(calc(100vw-2rem),380px)] rounded-lg border border-line bg-white p-3 shadow-soft"
        >
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
                status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"
              )}
            >
              <PhoneCall size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{statusText}</p>
              {["active", "reconnecting"].includes(status) ? (
                <p className="mt-0.5 text-xs tabular-nums text-slate-500">{formatDuration(elapsedSeconds)}</p>
              ) : null}
              {error ? <p className="mt-0.5 text-xs text-red-600">{error}</p> : null}
            </div>
            {status === "idle" ? (
              <button
                type="button"
                onClick={closePanel}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                aria-label="關閉"
              >
                <X size={18} />
              </button>
            ) : null}
          </div>

          {status !== "idle" ? (
            <div className="mt-3 flex justify-end gap-2">
              {status === "ringing" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void rejectCall()}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700"
                    aria-label="拒接"
                  >
                    <PhoneOff size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptCall()}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-green-600 text-white hover:bg-green-700"
                    aria-label="接聽"
                  >
                    <PhoneCall size={18} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-slate-700 hover:bg-slate-50"
                    aria-label={isMuted ? "取消靜音" : "靜音"}
                  >
                    {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void hangUp()}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700"
                    aria-label="掛斷"
                  >
                    <PhoneOff size={18} />
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
