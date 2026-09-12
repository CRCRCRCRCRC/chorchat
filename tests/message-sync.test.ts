import assert from "node:assert/strict";
import { test } from "node:test";
import { storedMessageId } from "../lib/message-identity";
import { createProvisionalMessage } from "../lib/message-input";
import { mergeLoadedMessages, mergeRealtimeMessages, messageIdentity } from "../lib/message-sync";
import { createRealtimeAssembler, encodeRealtimePayload } from "../lib/realtime-payload";
import type { Message } from "../lib/types";

const preview = createProvisionalMessage({ sender: "CHEN", clientId: "optimistic-12345678-abcd", text: "hello" })!;
const saved: Message = { ...preview, id: storedMessageId(preview.id, preview.sender), clientStatus: undefined };

test("a polling response reconciles a preview even when the final event was lost", () => {
  const messages = mergeLoadedMessages([preview], [saved]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, saved.id);
  assert.equal(messages[0].clientStatus, undefined);
  assert.equal(messageIdentity(preview), messageIdentity(saved));
});

test("a delayed relay cannot resurrect a duplicate after persistence", () => {
  assert.deepEqual(mergeRealtimeMessages([saved], [preview]), [saved]);
});

test("an old GET snapshot cannot erase a new delivery or undo a recall", () => {
  const recalled = { ...saved, text: null, recalledAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" };
  assert.deepEqual(mergeLoadedMessages([recalled], [saved]), [recalled]);
  assert.deepEqual(mergeLoadedMessages([preview], []), [preview]);
});

test("unchanged snapshots preserve references and known read receipts", () => {
  const read = { ...saved, readAt: "2030-01-01T00:00:00.000Z" };
  const current = [read];
  assert.equal(mergeLoadedMessages(current, [saved]), current);
});

test("long Unicode messages and thirty images survive Pusher's 10KB limit", () => {
  const payload = { type: "created", message: { ...preview, text: "\u9673".repeat(4000), imageUrls: Array.from({ length: 30 }, (_, i) => `https://example.com/${i}/${"x".repeat(1200)}`) } };
  const parts = encodeRealtimePayload("messages:changed", payload);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(Buffer.byteLength(JSON.stringify(part.data)) < 10000);
  const received: unknown[] = [];
  const assemble = createRealtimeAssembler((event, data) => received.push({ event, data }));
  for (const part of parts.reverse()) assemble(part.data);
  assert.deepEqual(received, [{ event: "messages:changed", data: payload }]);
});

test("invalid chunks cannot emit events or crash the subscriber", () => {
  const received: unknown[] = [];
  const assemble = createRealtimeAssembler((event) => received.push(event));
  assemble({ id: "x", event: "messages:changed", total: 50000, index: 0, data: "x" });
  assemble({ id: "x", event: "pusher:subscription_succeeded", total: 1, index: 0, data: "e30=" });
  assemble(null);
  assert.deepEqual(received, []);
});
