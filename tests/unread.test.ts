import assert from "node:assert/strict";
import { test } from "node:test";
import { createProvisionalMessage } from "../lib/message-input";
import { storedMessageId } from "../lib/message-identity";
import { firstUnreadIdentity, unreadBoundary } from "../lib/unread";

const incoming = createProvisionalMessage({
  sender: "ZUO",
  clientId: "optimistic-unread-test",
  text: "hello"
})!;
const own = createProvisionalMessage({ sender: "CHEN", clientId: "optimistic-own-test", text: "reply" })!;

test("unread divider ignores own, read, recalled and failed messages", () => {
  assert.equal(firstUnreadIdentity([own, { ...incoming, readAt: new Date().toISOString() }], "CHEN"), null);
  assert.equal(firstUnreadIdentity([{ ...incoming, recalledAt: new Date().toISOString() }], "CHEN"), null);
  assert.equal(firstUnreadIdentity([{ ...incoming, clientStatus: "failed" }], "CHEN"), null);
  assert.equal(firstUnreadIdentity([incoming], "ZUO"), null);
});

test("the entry divider survives persistence and immediate read-receipt updates", () => {
  const anchor = firstUnreadIdentity([incoming], "CHEN");
  assert.ok(anchor);
  const saved = {
    ...incoming,
    id: storedMessageId(incoming.id, incoming.sender),
    clientStatus: undefined,
    readAt: new Date().toISOString()
  };
  assert.deepEqual(unreadBoundary([saved, own], "CHEN", anchor), { id: anchor, count: 1 });
  assert.equal(unreadBoundary([saved], "CHEN", "missing"), null);
});

test("recalling the anchor moves the divider to the next incoming message", () => {
  const anchor = firstUnreadIdentity([incoming], "CHEN");
  const next = { ...incoming, id: "another-message" };
  const messages = [{ ...incoming, recalledAt: new Date().toISOString() }, own, next];
  assert.deepEqual(unreadBoundary(messages, "CHEN", anchor), { id: next.id, count: 1 });
});
