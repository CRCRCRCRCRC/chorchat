import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCallDuration, mergeCallRecords, type CallSignal } from "../lib/call";
import { getCallRecordUpdate, serializeCallRecord, type StoredCallRecord } from "../lib/call-records";

const start = new Date("2026-10-07T12:00:00.000Z");
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
const record = (): StoredCallRecord => ({
  id: "call-test",
  caller: "CHEN",
  callee: "ZUO",
  status: "ringing",
  startedAt: start,
  answeredAt: null,
  endedAt: null,
  endedBy: null,
  lastActivityAt: start,
  updatedAt: start
});
const signal = (
  type: CallSignal["type"],
  from: CallSignal["from"] = "ZUO",
  payload?: CallSignal["payload"]
): CallSignal => ({
  type,
  callId: "call-test",
  from,
  to: from === "CHEN" ? "ZUO" : "CHEN",
  payload
});

test("call duration starts at actual connection, not the answer button", () => {
  const initial = record();
  const accepted = { ...initial, ...getCallRecordUpdate(initial, signal("call-accept"), at(5)) };
  assert.equal(accepted.status, "connecting");
  assert.equal(accepted.answeredAt, null);
  const connected = { ...accepted, ...getCallRecordUpdate(accepted, signal("call-connected"), at(8)) };
  assert.equal(connected.status, "active");
  assert.deepEqual(connected.answeredAt, at(8));
  const duplicate = getCallRecordUpdate(connected, signal("call-connected", "CHEN"), at(10));
  assert.deepEqual(duplicate?.answeredAt, at(8));
  const ended = { ...connected, ...getCallRecordUpdate(connected, signal("hangup", "CHEN"), at(83)) };
  assert.equal(ended.status, "completed");
  assert.equal(formatCallDuration(serializeCallRecord(ended)), "1:15");
  assert.equal(getCallRecordUpdate(ended, signal("call-connected"), at(85)), null);
  assert.equal(getCallRecordUpdate(ended, signal("call-reject"), at(85)), null);
});

test("call records distinguish declines, cancellations, missed calls and connection failures", () => {
  assert.equal(getCallRecordUpdate(record(), signal("call-reject"), at(10))?.status, "declined");
  assert.equal(getCallRecordUpdate(record(), signal("hangup", "CHEN"), at(10))?.status, "cancelled");
  assert.equal(
    getCallRecordUpdate(record(), signal("hangup", "CHEN", { reason: "missed" }), at(30))?.status,
    "missed"
  );
  assert.equal(getCallRecordUpdate(record(), signal("hangup", "CHEN"), at(35))?.status, "missed");
  assert.equal(
    getCallRecordUpdate(record(), signal("hangup", "CHEN", { reason: "failed" }), at(10))?.status,
    "failed"
  );
  assert.equal(formatCallDuration(serializeCallRecord(record())), null);
  assert.throws(() => getCallRecordUpdate(record(), signal("call-accept", "CHEN"), at(5)));
});

test("heartbeats keep active calls alive without resetting the connected time", () => {
  const active = { ...record(), status: "active", answeredAt: at(5) };
  assert.deepEqual(getCallRecordUpdate(active, signal("call-heartbeat"), at(25)), { lastActivityAt: at(25) });
  assert.equal(getCallRecordUpdate(record(), signal("call-heartbeat"), at(25)), null);
});

test("history merging never resurrects completed calls and handles same-millisecond updates", () => {
  const ringing = serializeCallRecord(record());
  const active = { ...ringing, status: "active" as const, answeredAt: at(5).toISOString() };
  assert.deepEqual(mergeCallRecords([ringing], [active]), [active]);
  const ended = { ...active, status: "completed" as const, endedAt: at(20).toISOString() };
  const current = [ended];
  assert.equal(mergeCallRecords(current, [{ ...active, updatedAt: at(30).toISOString() }]), current);
  assert.deepEqual(mergeCallRecords([active], [ended]), current);
  assert.equal(mergeCallRecords(current, [ended]), current);
});
