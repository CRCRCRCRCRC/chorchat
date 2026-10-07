import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { createProvisionalMessage } from "../../lib/message-input";
import type { Message } from "../../lib/types";
import type { CallHistoryRecord } from "../../lib/call";
import { chatPair } from "./chat-fixture";

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }
});

const now = Date.now();
function message(index: number, text: string, unread = false): Message {
  return {
    ...createProvisionalMessage({
      sender: index % 3 ? "CHEN" : "ZUO",
      clientId: `optimistic-feature-${index}`,
      text
    })!,
    id: `feature-${index}`,
    clientStatus: undefined,
    createdAt: new Date(now - 3600000 + index * 60000).toISOString(),
    readAt: unread ? null : new Date(now).toISOString()
  };
}
const completed: CallHistoryRecord = {
  id: "call-history-example",
  caller: "CHEN",
  callee: "ZUO",
  status: "completed",
  startedAt: new Date(now - 3000000).toISOString(),
  answeredAt: new Date(now - 2995000).toISOString(),
  endedAt: new Date(now - 2920000).toISOString(),
  endedBy: "CHEN",
  updatedAt: new Date(now - 2920000).toISOString()
};
const photoBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/1XcAAAAASUVORK5CYII=",
  "base64"
);
const photoUrls = ["https://photos.test/1.png", "https://photos.test/2.png", "https://photos.test/3.png"];
const photos = Object.fromEntries(photoUrls.map((url) => [url, photoBytes]));
const album: Message = { ...message(16, ""), imageUrl: photoUrls[0], imageUrls: photoUrls };

for (const navigate of [false, true]) {
  test(`late initial call history ${navigate ? "preserves manual navigation" : "settles at the bottom"}`, async ({
    browser
  }) => {
    const history = Array.from({ length: 32 }, (_, index) => message(index, `通話紀錄載入前的訊息 ${index}`));
    const calls = Array.from({ length: 12 }, (_, index): CallHistoryRecord => {
      const start = now - 600000 + index * 1000;
      return {
        ...completed,
        id: `call-late-${index}`,
        startedAt: new Date(start).toISOString(),
        answeredAt: new Date(start + 1000).toISOString(),
        endedAt: new Date(start + 2000).toISOString(),
        updatedAt: new Date(start + 2000).toISOString()
      };
    });
    const pair = await chatPair(browser, { history, calls, callHistoryDelayMs: 3500 });
    try {
      const scroller = pair.zuo.locator("section.chat-scrollbar");
      if (navigate) {
        await scroller.dispatchEvent("wheel");
        await scroller.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
      }
      await expect(pair.zuo.locator("section [id^='call-']")).toHaveCount(12);
      if (navigate) await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
      else
        await expect
          .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
          .toBeLessThan(5);
      expect(pair.errors).toEqual([]);
    } finally {
      await pair.close();
    }
  });
}

test("entry unread divider locates the first unread message without changing bottom-on-entry", async ({
  browser
}) => {
  const history = Array.from({ length: 32 }, (_, i) => message(i, `歷史訊息 ${i}`));
  history.push(
    ...[32, 33, 34].map((index) => ({
      ...message(index, `未讀訊息 ${index}`, true),
      sender: "CHEN" as const
    }))
  );
  const pair = await chatPair(browser, { history });
  try {
    const page = pair.zuo;
    await expect(page.getByText("3 則新訊息", { exact: true })).toBeVisible();
    await expect(page.getByRole("separator", { name: "以下為新訊息" })).toHaveCount(1);
    const scroller = page.locator("section.chat-scrollbar");
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
      .toBeLessThan(5);
    await page.getByRole("button", { name: "查看第一則", exact: true }).click();
    await expect(page.locator("#unread-divider")).toBeInViewport();
    await expect(page.getByText("未讀訊息 32", { exact: true })).toBeInViewport();
    expect(pair.errors).toEqual([]);
  } finally {
    await pair.close();
  }
});

test("unread divider remains stable after the provisional message is saved", async ({ browser }) => {
  const pair = await chatPair(browser, { persistenceDelay: 900 });
  try {
    await pair.chen.getByPlaceholder("輸入訊息").fill("未讀分隔測試");
    await pair.chen.getByRole("button", { name: "送出訊息", exact: true }).click();
    await expect(pair.zuo.getByRole("separator", { name: "以下為新訊息" })).toHaveCount(1);
    await expect.poll(() => pair.metrics.persisted).toBe(1);
    await expect(pair.zuo.getByRole("separator", { name: "以下為新訊息" })).toHaveCount(1);
    await expect(pair.zuo.getByText("1 則新訊息", { exact: true })).toBeVisible();
    expect(pair.errors).toEqual([]);
  } finally {
    await pair.close();
  }
});

test("call history supports redial, real WebRTC connection, duration and immediate hangup", async ({
  browser
}) => {
  const pair = await chatPair(browser, { calls: [completed], microphone: true });
  try {
    await pair.chen.getByRole("button", { name: "通話紀錄", exact: true }).click();
    const history = pair.chen.getByRole("dialog", { name: "通話紀錄", exact: true });
    await expect(history.getByRole("button", { name: "語音通話 1:15，回撥", exact: true })).toBeVisible();
    await history.getByRole("button", { name: "語音通話 1:15，回撥", exact: true }).click();
    await expect(history).toHaveCount(0);
    await expect(pair.chen.getByRole("button", { name: "掛斷", exact: true })).toBeVisible();
    await expect(pair.zuo.getByRole("button", { name: "接聽", exact: true })).toBeVisible();
    await pair.zuo.getByRole("button", { name: "接聽", exact: true }).click();
    await expect.poll(() => pair.calls.at(-1)?.status, { timeout: 15000 }).toBe("active");
    await expect.poll(() => pair.calls.at(-1)?.answeredAt).toBeTruthy();
    await pair.chen.getByRole("button", { name: "掛斷", exact: true }).click();
    await expect(pair.chen.getByRole("button", { name: "掛斷", exact: true })).toHaveCount(0);
    await expect.poll(() => pair.calls.at(-1)?.status).toBe("completed");
    await expect(pair.zuo.getByRole("button", { name: "掛斷", exact: true })).toHaveCount(0);
    await expect(pair.zuo.getByRole("button", { name: /語音通話 0:\d{2}，回撥/ })).toBeVisible();
    expect(pair.errors).toEqual([]);
  } finally {
    await pair.close();
  }
});

test("declined calls are recorded for both devices and survive reload", async ({ browser }) => {
  const pair = await chatPair(browser, { microphone: true });
  try {
    await pair.chen.getByRole("button", { name: "語音通話", exact: true }).click();
    await pair.zuo.getByRole("button", { name: "拒接", exact: true }).click();
    await expect(pair.chen.getByRole("button", { name: "對方已拒接，回撥", exact: true })).toBeVisible();
    await expect(pair.zuo.getByRole("button", { name: "已拒接來電，回撥", exact: true })).toBeVisible();
    await pair.zuo.reload();
    await expect(pair.zuo.getByRole("button", { name: "已拒接來電，回撥", exact: true })).toBeVisible();
    expect(pair.calls.at(-1)?.answeredAt).toBeNull();
    await pair.zuo.getByRole("button", { name: "已拒接來電，回撥", exact: true }).click();
    await expect(pair.zuo.getByRole("button", { name: "掛斷", exact: true })).toBeVisible();
    await pair.chen.getByRole("button", { name: "拒接", exact: true }).click();
    await expect(pair.zuo.getByRole("button", { name: "掛斷", exact: true })).toHaveCount(0);
    expect(pair.errors).toEqual([]);
  } finally {
    await pair.close();
  }
});

test("lightbox saves the original image and media selection downloads all images in a valid ZIP", async ({
  browser
}) => {
  const pair = await chatPair(browser, { history: [album], photos });
  try {
    const page = pair.zuo;
    await page.getByRole("button", { name: "開啟第 1 張相片，共 3 張", exact: true }).click();
    const lightbox = page.getByRole("dialog", { name: "圖片預覽", exact: true });
    const single = page.waitForEvent("download");
    await lightbox.getByRole("button", { name: "下載這張圖片", exact: true }).click();
    const download = await single;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    expect(await readFile((await download.path())!)).toEqual(photoBytes);
    await lightbox.getByRole("button", { name: "關閉圖片預覽", exact: true }).click();
    await page.getByRole("button", { name: "照片", exact: true }).click();
    const media = page.getByRole("dialog", { name: "照片與連結", exact: true });
    await media.getByRole("button", { name: "選取照片", exact: true }).click();
    await media.getByRole("button", { name: "全選", exact: true }).click();
    await expect(media.getByText("已選 3 張", { exact: true })).toBeVisible();
    const batch = page.waitForEvent("download");
    await media.getByRole("button", { name: "下載所選", exact: true }).click();
    const archive = await batch;
    expect(archive.suggestedFilename()).toMatch(/\.zip$/);
    const files = unzipSync(await readFile((await archive.path())!));
    expect(Object.keys(files)).toHaveLength(3);
    for (const data of Object.values(files)) expect(Buffer.from(data)).toEqual(photoBytes);
    await expect(media.getByRole("link", { name: "再次下載", exact: true })).toBeVisible();
    expect(pair.errors).toEqual([]);
  } finally {
    await pair.close();
  }
});

test("failed batch downloads show an error instead of claiming a partial archive is ready", async ({
  browser
}) => {
  const pair = await chatPair(browser, { history: [album], photos: { [photoUrls[0]]: photoBytes } });
  try {
    await pair.zuo.getByRole("button", { name: "照片", exact: true }).click();
    const media = pair.zuo.getByRole("dialog", { name: "照片與連結", exact: true });
    await media.getByRole("button", { name: "選取照片", exact: true }).click();
    await media.getByRole("button", { name: "全選", exact: true }).click();
    await media.getByRole("button", { name: "下載所選", exact: true }).click();
    await expect(media.getByText(/圖片下載失敗/)).toBeVisible();
    await expect(media.getByRole("link", { name: "再次下載", exact: true })).toHaveCount(0);
    await expect(media.getByRole("button", { name: "下載所選", exact: true })).toBeEnabled();
    expect(pair.errors).toEqual([]);
  } finally {
    await pair.close();
  }
});

test("chat layout and dialogs fit desktop, iPad and narrow mobile viewports", async ({
  browser
}, testInfo) => {
  const landscape = await readFile("tests/browser/fixtures/landscape.jpg");
  const previewPhotos = Object.fromEntries(photoUrls.map((url) => [url, landscape]));
  const history = [
    { ...message(1, "週末一起出去走走？"), sender: "ZUO" as const },
    message(2, "好啊，我整理了幾張照片"),
    album,
    { ...message(17, "這個地方看起來不錯，等一下打給你", true), sender: "CHEN" as const }
  ];
  const missed = {
    ...completed,
    id: "call-missed-example",
    status: "missed" as const,
    answeredAt: null,
    caller: "ZUO" as const,
    callee: "CHEN" as const,
    startedAt: new Date(now - 2500000).toISOString()
  };
  const pair = await chatPair(browser, { history, calls: [completed, missed], photos: previewPhotos });
  try {
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [320, 700]
    ]) {
      const page = pair.chen;
      await page.setViewportSize({ width, height });
      await expect(page.getByPlaceholder("輸入訊息")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const header = page.locator("main header").first();
      expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      for (const img of await page.locator("section img").all()) {
        await expect(img).toHaveJSProperty("complete", true);
        expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      }
      await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`) });
      await page.getByRole("button", { name: "通話紀錄", exact: true }).filter({ visible: true }).click();
      const dialog = page.getByRole("dialog", { name: "通話紀錄", exact: true });
      await expect(dialog.getByRole("button", { name: "未接來電，回撥", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`calls-${width}.png`) });
      await dialog.getByRole("button", { name: "關閉", exact: true }).click();
    }
    expect(pair.errors).toEqual([]);
  } finally {
    await pair.close();
  }
});
