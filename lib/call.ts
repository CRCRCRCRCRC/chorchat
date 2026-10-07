import type { Sender } from "@/lib/types";

export type CallSignalType =
  | "call-request"
  | "call-accept"
  | "call-reject"
  | "call-connected"
  | "call-heartbeat"
  | "offer"
  | "answer"
  | "ice-candidate"
  | "hangup";

export type CallSignal = {
  record?: CallHistoryRecord;
  id?: string;
  type: CallSignalType;
  callId: string;
  from: Sender;
  to: Sender;
  createdAt?: string;
  payload?: {
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
    reason?: "missed" | "declined" | "cancelled" | "failed";
  };
};

export type CallRecordStatus =
  "ringing" | "connecting" | "active" | "completed" | "missed" | "declined" | "cancelled" | "failed";

export type CallHistoryRecord = {
  id: string;
  caller: Sender;
  callee: Sender;
  status: CallRecordStatus;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endedBy: Sender | null;
  updatedAt: string;
};

export function mergeCallRecords(current: CallHistoryRecord[], incoming: CallHistoryRecord[]) {
  const byId = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    const previous = byId.get(record.id);
    if (previous?.endedAt) continue;
    const rank = (value: CallHistoryRecord) =>
      value.endedAt ? 3 : value.answeredAt ? 2 : value.status === "connecting" ? 1 : 0;
    if (
      !previous ||
      previous.updatedAt < record.updatedAt ||
      (previous.updatedAt === record.updatedAt && rank(record) > rank(previous))
    )
      byId.set(record.id, record);
  }
  const merged = [...byId.values()].sort(
    (a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id)
  );
  return current.length === merged.length && current.every((record, index) => record === merged[index])
    ? current
    : merged;
}

export function formatCallDuration(record: CallHistoryRecord) {
  if (!record.answeredAt || !record.endedAt) return null;
  const seconds = Math.max(
    0,
    Math.floor((Date.parse(record.endedAt) - Date.parse(record.answeredAt)) / 1000)
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
