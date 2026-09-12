import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import Pusher from "pusher";
import { GET, POST } from "../app/api/realtime/route";

const keys = ["PUSHER_APP_ID", "PUSHER_SECRET", "PUSHER_CLUSTER", "NEXT_PUBLIC_PUSHER_KEY", "NEXT_PUBLIC_PUSHER_CLUSTER"];
const original = keys.map((key) => process.env[key]);
after(() => keys.forEach((key, i) => {
  if (original[i] === undefined) delete process.env[key];
  else process.env[key] = original[i];
}));

test("runtime configuration uses the server cluster and never exposes the secret", async () => {
  process.env.PUSHER_APP_ID = "test-app";
  process.env.PUSHER_SECRET = "test-secret";
  process.env.PUSHER_CLUSTER = "ap3";
  process.env.NEXT_PUBLIC_PUSHER_CLUSTER = "wrong-cluster";
  process.env.NEXT_PUBLIC_PUSHER_KEY = "test-key";
  assert.deepEqual(await GET().json(), { config: { key: "test-key", cluster: "ap3" } });
});

test("the relay publishes without requiring a database and reports publish failure", async () => {
  const trigger = mock.method(Pusher.prototype, "trigger", async () => ({}));
  const request = () => new Request("http://localhost/api/realtime", { method: "POST", body: JSON.stringify({ sender: "CHEN", clientId: "optimistic-12345678", text: "hello" }) });
  try {
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("Server-Timing")?.includes("publish;dur="));
    assert.equal(trigger.mock.calls.length, 1);
    trigger.mock.mockImplementation(async () => { throw new Error("Unavailable"); });
    assert.equal((await POST(request())).status, 502);
  } finally {
    trigger.mock.restore();
  }
});

test("malformed and empty previews are rejected", async () => {
  for (const body of ["{", "{}", '{"sender":"CHEN","text":"hello"}']) {
    assert.equal((await POST(new Request("http://localhost/api/realtime", { method: "POST", body }))).status, 400);
  }
});
