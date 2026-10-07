import { expect, type Browser, type BrowserContext, type WebSocketRoute } from "@playwright/test";
import { storedMessageId } from "../../lib/message-identity";
import { createProvisionalMessage, type MessageInput } from "../../lib/message-input";
import { encodeRealtimePayload } from "../../lib/realtime-payload";
import type { Message, Sender } from "../../lib/types";
import { installNotificationProbe } from "./notification-probe";
import type { CallHistoryRecord, CallSignal } from "../../lib/call";
import { getCallRecordUpdate, serializeCallRecord, type StoredCallRecord } from "../../lib/call-records";

export async function chatPair(
  browser: Browser,
  options: {
    persistenceDelay?: number;
    rejectSubscription?: boolean;
    sameIdentity?: boolean;
    initialHistoryDelayMs?: number;
    history?: Message[];
    dropFirstMobileConnection?: boolean;
    failProbePublish?: boolean;
    calls?: CallHistoryRecord[];
    callHistoryDelayMs?: number;
    microphone?: boolean;
    photos?: Record<string, Buffer>;
  } = {}
) {
  const sockets = new Set<WebSocketRoute>();
  const droppedSockets = new Set<WebSocketRoute>();
  const saved: Message[] = [...(options.history ?? [])];
  const calls: StoredCallRecord[] = (options.calls ?? []).map((call) => ({
    ...call,
    startedAt: new Date(call.startedAt),
    answeredAt: call.answeredAt ? new Date(call.answeredAt) : null,
    endedAt: call.endedAt ? new Date(call.endedAt) : null,
    updatedAt: new Date(call.updatedAt),
    lastActivityAt: new Date(call.updatedAt)
  }));
  const callSignals: CallSignal[] = [];
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const metrics = { persisted: 0, polls: 0, clientEvents: 0, mobileConnections: 0, probes: 0 };
  let rejectSubscription = options.rejectSubscription ?? false;
  const pending = new Set<Promise<void>>();

  function publish(event: string, payload: Record<string, unknown>) {
    for (const part of encodeRealtimePayload(event, payload)) {
      for (const socket of sockets) {
        if (!droppedSockets.has(socket))
          socket.send(
            JSON.stringify({
              event: part.name,
              channel: "private-chorchat-main",
              data: JSON.stringify(part.data)
            })
          );
      }
    }
  }

  async function pageFor(sender: Sender, mobile: boolean) {
    let initialHistory = true;
    let initialCalls = true;
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      isMobile: mobile,
      hasTouch: mobile
    });
    contexts.push(context);
    if (options.microphone) await context.grantPermissions(["microphone"]);
    await context.addInitScript((identity) => localStorage.setItem("chorchat:sender", identity), sender);
    await context.addInitScript(installNotificationProbe);
    if (options.photos)
      await context.route("https://photos.test/**", (route) => {
        const photo = options.photos?.[route.request().url()];
        return route.fulfill({
          status: photo ? 200 : 404,
          body: photo ?? Buffer.from("missing"),
          contentType: photo?.[0] === 255 ? "image/jpeg" : "image/png",
          headers: { "access-control-allow-origin": "*" }
        });
      });
    await context.routeWebSocket(/wss:\/\/ws-.*\.pusher\.com\//, (socket) => {
      if (mobile) {
        metrics.mobileConnections++;
        if (options.dropFirstMobileConnection && metrics.mobileConnections === 1) droppedSockets.add(socket);
      }
      socket.send(
        JSON.stringify({
          event: "pusher:connection_established",
          data: JSON.stringify({ socket_id: `${Math.random()}.1`, activity_timeout: 120 })
        })
      );
      socket.onMessage((raw) => {
        const message = JSON.parse(raw.toString());
        if (message.event === "pusher:subscribe") {
          sockets.add(socket);
          socket.send(
            JSON.stringify({
              event: "pusher_internal:subscription_succeeded",
              channel: "private-chorchat-main",
              data: "{}"
            })
          );
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
      if (path === "/api/realtime" && request.method() === "GET")
        return json({ config: { key: "test-key", cluster: "ap3" } });
      if (path === "/api/realtime/probe") {
        metrics.probes++;
        if (options.failProbePublish) return json({ published: false }, 503);
        publish("connection:probe", { token: request.postDataJSON().token });
        return json({ published: true });
      }
      if (path === "/api/pusher/auth")
        return json(
          rejectSubscription ? { error: "Test authorization failure" } : { auth: "test-key:test-signature" },
          rejectSubscription ? 403 : 200
        );
      if (path === "/api/realtime") {
        const input = request.postDataJSON() as MessageInput;
        publish("messages:changed", { type: "created", message: createProvisionalMessage(input) });
        return json({ published: true });
      }
      if (path === "/api/messages" && request.method() === "GET") {
        metrics.polls++;
        const snapshot = [...saved];
        if (mobile && initialHistory && options.initialHistoryDelayMs) {
          initialHistory = false;
          const task = new Promise<void>((resolve) =>
            setTimeout(resolve, options.initialHistoryDelayMs)
          ).then(() => json({ messages: snapshot }));
          pending.add(task);
          try {
            await task;
          } finally {
            pending.delete(task);
          }
          return;
        }
        return json({ messages: snapshot });
      }
      if (path === "/api/messages") {
        const input = request.postDataJSON() as MessageInput;
        const task = (async () => {
          await new Promise((resolve) => setTimeout(resolve, options.persistenceDelay ?? 20));
          const message: Message = {
            ...createProvisionalMessage(input)!,
            id: storedMessageId(input.clientId!, input.sender),
            clientStatus: undefined
          };
          saved.push(message);
          metrics.persisted++;
          // Both channels may deliver the saved message; it must appear only once.
          publish("messages:changed", { type: "created", message, clientId: input.clientId });
          await json({ message }, 201);
        })();
        pending.add(task);
        try {
          await task;
        } finally {
          pending.delete(task);
        }
        return;
      }
      if (path === "/api/messages/read") return json({ marked: 0 });
      if (path === "/api/presence") return json({ statuses: [], presence: {} });
      if (path === "/api/calls") {
        if (initialCalls && options.callHistoryDelayMs) {
          initialCalls = false;
          const task = new Promise<void>((resolve) => setTimeout(resolve, options.callHistoryDelayMs)).then(
            () => json({ calls: calls.map(serializeCallRecord) })
          );
          pending.add(task);
          try {
            await task;
          } finally {
            pending.delete(task);
          }
          return;
        }
        return json({ calls: calls.map(serializeCallRecord) });
      }
      if (path === "/api/call" && request.method() === "GET") {
        const url = new URL(request.url());
        return json({
          signals: callSignals
            .filter(
              (signal) =>
                signal.to === url.searchParams.get("to") &&
                signal.createdAt! > (url.searchParams.get("since") ?? "")
            )
            .map((signal) => {
              const record = calls.find((call) => call.id === signal.callId);
              return record ? { ...signal, record: serializeCallRecord(record) } : signal;
            })
        });
      }
      if (path === "/api/call") {
        const input = request.postDataJSON() as CallSignal;
        const now = new Date();
        let call = calls.find((record) => record.id === input.callId);
        if (!call && input.type === "call-request") {
          call = {
            id: input.callId,
            caller: input.from,
            callee: input.to,
            status: "ringing",
            startedAt: now,
            answeredAt: null,
            endedAt: null,
            endedBy: null,
            updatedAt: now,
            lastActivityAt: now
          };
          calls.push(call);
        }
        if (!call) return json({ error: "Call not found" }, 400);
        if (call.endedAt) return json({ ok: true, record: serializeCallRecord(call) });
        const update = getCallRecordUpdate(call, input, now);
        if (update) Object.assign(call, update, { updatedAt: now });
        const record = serializeCallRecord(call);
        const signal = { ...input, id: `signal-${callSignals.length}`, createdAt: now.toISOString(), record };
        callSignals.push(signal);
        if (input.type !== "call-heartbeat") publish("call:signal", signal);
        publish("calls:changed", { record });
        return json({ ok: true, record });
      }
      return json({ ok: true });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:3100");
    await expect(page.getByPlaceholder("輸入訊息")).toBeVisible();
    if (options.history?.length) {
      await expect(page.locator("article[id^='message-']")).toHaveCount(options.history.length);
    } else if (options.calls?.length) {
      await expect(page.locator("section [id^='call-']")).toHaveCount(options.calls.length);
    } else if (!(mobile && options.initialHistoryDelayMs)) {
      await expect(page.getByText("還沒有訊息。傳送第一則文字或圖片開始對話。")).toBeVisible();
    }
    return page;
  }
  const chen = await pageFor("CHEN", false);
  const zuo = await pageFor(options.sameIdentity ? "CHEN" : "ZUO", true);
  return {
    chen,
    zuo,
    metrics,
    errors,
    publish,
    calls,
    allowSubscription: () => {
      rejectSubscription = false;
    },
    close: async () => {
      await Promise.allSettled([...pending]);
      // Keep context routes active while pages unload, including late focus requests.
      for (const context of contexts) {
        await Promise.all(context.pages().map((page) => page.close()));
        await context.close();
      }
    }
  };
}
