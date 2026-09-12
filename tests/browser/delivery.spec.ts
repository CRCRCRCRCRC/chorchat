import { expect, test, type Browser, type BrowserContext, type WebSocketRoute } from "@playwright/test";
import { storedMessageId } from "../../lib/message-identity";
import { createProvisionalMessage, type MessageInput } from "../../lib/message-input";
import { encodeRealtimePayload } from "../../lib/realtime-payload";
import type { Message, Sender } from "../../lib/types";

async function chatPair(browser: Browser, options: { persistenceDelay?: number; rejectSubscription?: boolean } = {}) {
  const sockets = new Set<WebSocketRoute>();
  const saved: Message[] = [];
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const metrics = { persisted: 0, polls: 0, clientEvents: 0 };
  let rejectSubscription = options.rejectSubscription ?? false;
  const pending = new Set<Promise<void>>();

  function publish(event: string, payload: Record<string, unknown>) {
    for (const part of encodeRealtimePayload(event, payload)) {
      for (const socket of sockets) socket.send(JSON.stringify({ event: part.name, channel: "private-chorchat-main", data: JSON.stringify(part.data) }));
    }
  }

  async function pageFor(sender: Sender, mobile: boolean) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile });
    contexts.push(context);
    await context.addInitScript((identity) => localStorage.setItem("chorchat:sender", identity), sender);
    await context.routeWebSocket(/wss:\/\/ws-.*\.pusher\.com\//, (socket) => {
      socket.send(JSON.stringify({ event: "pusher:connection_established", data: JSON.stringify({ socket_id: `${Math.random()}.1`, activity_timeout: 120 }) }));
      socket.onMessage((raw) => {
        const message = JSON.parse(raw.toString());
        if (message.event === "pusher:subscribe") {
          sockets.add(socket);
          socket.send(JSON.stringify({ event: "pusher_internal:subscription_succeeded", channel: "private-chorchat-main", data: "{}" }));
        } else if (message.event === "pusher:unsubscribe") sockets.delete(socket);
        // Deliberately discard client events: server relay must work without this dashboard switch.
        else if (message.event.startsWith("client-")) metrics.clientEvents++;
      });
      socket.onClose(() => sockets.delete(socket));
    });
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
      if (path === "/api/realtime" && request.method() === "GET") return json({ config: { key: "test-key", cluster: "ap3" } });
      if (path === "/api/pusher/auth") return json(rejectSubscription ? { error: "Test authorization failure" } : { auth: "test-key:test-signature" }, rejectSubscription ? 403 : 200);
      if (path === "/api/realtime") {
        const input = request.postDataJSON() as MessageInput;
        publish("messages:changed", { type: "created", message: createProvisionalMessage(input) });
        return json({ published: true });
      }
      if (path === "/api/messages" && request.method() === "GET") {
        metrics.polls++;
        return json({ messages: saved });
      }
      if (path === "/api/messages") {
        const input = request.postDataJSON() as MessageInput;
        const task = (async () => {
          await new Promise((resolve) => setTimeout(resolve, options.persistenceDelay ?? 20));
          const message: Message = { ...createProvisionalMessage(input)!, id: storedMessageId(input.clientId!, input.sender), clientStatus: undefined };
          saved.push(message);
          metrics.persisted++;
          // Both channels may deliver the saved message; it must appear only once.
          publish("messages:changed", { type: "created", message, clientId: input.clientId });
          await json({ message }, 201);
        })();
        pending.add(task);
        try { await task; } finally { pending.delete(task); }
        return;
      }
      if (path === "/api/messages/read") return json({ marked: 0 });
      if (path === "/api/presence") return json({ statuses: [], presence: {} });
      if (path === "/api/call") return json({ signals: [] });
      return json({ ok: true });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:3100");
    await expect(page.getByPlaceholder("輸入訊息")).toBeVisible();
    await expect(page.getByText("還沒有訊息。傳送第一則文字或圖片開始對話。")).toBeVisible();
    return page;
  }
  const chen = await pageFor("CHEN", false);
  const zuo = await pageFor("ZUO", true);
  return {
    chen, zuo, metrics, errors,
    allowSubscription: () => { rejectSubscription = false; },
    close: async () => { await Promise.allSettled([...pending]); await Promise.all(contexts.map((context) => context.close())); }
  };
}

test("mobile receives and alerts before a 10-second DB write, without client events", async ({ browser }, testInfo) => {
  const pair = await chatPair(browser, { persistenceDelay: 10000 });
  try {
    await expect(pair.chen.getByRole("status")).toHaveCount(0);
    await expect(pair.zuo.getByRole("status")).toHaveCount(0);
    await pair.chen.getByPlaceholder("輸入訊息").fill("instant delivery test");
    const started = performance.now();
    await pair.chen.getByRole("button", { name: "送出訊息", exact: true }).click();
    await expect(pair.zuo.getByText("instant delivery test", { exact: true })).toBeVisible({ timeout: 1000 });
    await expect(pair.zuo.getByRole("button", { name: "1 則未讀訊息，回到最新訊息", exact: true })).toBeVisible({ timeout: 1000 });
    const elapsed = Math.round(performance.now() - started);
    expect(elapsed).toBeLessThan(1000);
    expect(pair.metrics.persisted).toBe(0);
    await testInfo.attach("delivery-timing", { body: JSON.stringify({ simulatedDatabaseDelayMs: 10000, receivedAndAlertedMs: elapsed }), contentType: "application/json" });
    await pair.zuo.screenshot({ path: testInfo.outputPath("mobile-before-database.png") });
    await expect.poll(() => pair.metrics.persisted, { timeout: 15000 }).toBe(1);
    await expect(pair.zuo.getByText("instant delivery test", { exact: true })).toHaveCount(1);
    await expect(pair.zuo.getByRole("button", { name: "1 則未讀訊息，回到最新訊息", exact: true })).toBeVisible();
    // A second device sends back without waiting for the health poll.
    await pair.zuo.getByPlaceholder("輸入訊息").fill("reply from mobile");
    await pair.zuo.getByRole("button", { name: "送出訊息", exact: true }).click();
    await expect(pair.chen.getByText("reply from mobile", { exact: true })).toBeVisible({ timeout: 1000 });
    expect(pair.errors).toEqual([]);
  } finally { await pair.close(); }
});

test("long Chinese text is delivered through chunked events without truncation", async ({ browser }) => {
  const pair = await chatPair(browser, { persistenceDelay: 1500 });
  try {
    await expect(pair.zuo.getByRole("status")).toHaveCount(0);
    const text = "\u5373\u6642\u6e2c\u8a66".repeat(1000);
    await pair.chen.getByPlaceholder("輸入訊息").fill(text);
    await pair.chen.getByRole("button", { name: "送出訊息", exact: true }).click();
    await expect(pair.zuo.getByText(text, { exact: true })).toHaveCount(1, { timeout: 1000 });
    expect(pair.metrics.persisted).toBe(0);
    expect(pair.errors).toEqual([]);
  } finally { await pair.close(); }
});

test("failed channel authorization keeps fast polling and can recover without reload", async ({ browser }) => {
  const pair = await chatPair(browser, { rejectSubscription: true });
  try {
    await expect(pair.zuo.getByText("即時連線中斷，正在重新連線")).toBeVisible();
    const polls = pair.metrics.polls;
    await pair.chen.getByPlaceholder("輸入訊息").fill("fallback delivery test");
    await pair.chen.getByRole("button", { name: "送出訊息", exact: true }).click();
    await expect(pair.zuo.getByText("fallback delivery test", { exact: true })).toBeVisible({ timeout: 4000 });
    expect(pair.metrics.polls).toBeGreaterThan(polls);
    pair.allowSubscription();
    await pair.zuo.getByRole("button", { name: "重新連線", exact: true }).click();
    await expect(pair.zuo.getByRole("status")).toHaveCount(0, { timeout: 10000 });
    await expect(pair.chen.getByRole("status")).toHaveCount(0, { timeout: 10000 });
    await pair.chen.getByPlaceholder("輸入訊息").fill("reconnected delivery test");
    await pair.chen.getByRole("button", { name: "送出訊息", exact: true }).click();
    await expect(pair.zuo.getByText("reconnected delivery test", { exact: true })).toBeVisible({ timeout: 1000 });
    expect(pair.errors).toEqual([]);
  } finally { await pair.close(); }
});
