import type { CallSignal, CallHistoryRecord, CallRecordStatus } from "@/lib/call";
import type { Sender } from "@/lib/types";

export type StoredCallRecord = {
  id: string;
  caller: Sender;
  callee: Sender;
  status: string;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  endedBy: Sender | null;
  lastActivityAt: Date;
  updatedAt: Date;
};

export function serializeCallRecord(record: StoredCallRecord): CallHistoryRecord {
  return {
    id: record.id,
    caller: record.caller,
    callee: record.callee,
    status: record.status as CallRecordStatus,
    startedAt: record.startedAt.toISOString(),
    answeredAt: record.answeredAt?.toISOString() ?? null,
    endedAt: record.endedAt?.toISOString() ?? null,
    endedBy: record.endedBy,
    updatedAt: record.updatedAt.toISOString()
  };
}

// Terminal records are immutable, even when late or duplicate signaling arrives.
export function getCallRecordUpdate(record: StoredCallRecord, signal: CallSignal, now: Date) {
  if (record.endedAt) return null;
  const isCaller = signal.from === record.caller && signal.to === record.callee;
  const isCallee = signal.from === record.callee && signal.to === record.caller;
  if (!isCaller && !isCallee) throw new Error("Invalid call participants.");
  if ((signal.type === "call-accept" || signal.type === "call-reject") && !isCallee) {
    throw new Error("Only the recipient can answer or reject a call.");
  }
  if (signal.type === "call-accept" && record.status === "ringing") {
    return { status: "connecting", lastActivityAt: now };
  }
  if (signal.type === "call-connected" && ["connecting", "active"].includes(record.status)) {
    return { status: "active", answeredAt: record.answeredAt ?? now, lastActivityAt: now };
  }
  if (signal.type === "call-heartbeat" && record.status === "active") return { lastActivityAt: now };
  if (signal.type !== "hangup" && signal.type !== "call-reject") return null;

  const reason = signal.payload?.reason;
  const expired = now.getTime() - record.startedAt.getTime() >= 30000;
  const status: CallRecordStatus = record.answeredAt
    ? reason === "failed"
      ? "failed"
      : "completed"
    : reason === "failed" || record.status === "connecting"
      ? "failed"
      : reason === "missed" || expired
        ? "missed"
        : signal.type === "call-reject"
          ? "declined"
          : "cancelled";
  return { status, endedAt: now, endedBy: signal.from, lastActivityAt: now };
}
