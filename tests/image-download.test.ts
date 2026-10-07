import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync } from "fflate";
import { prepareImageDownload } from "../lib/image-download";

const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

test("single image downloads preserve original bytes and MIME type", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(bytes, { headers: { "content-type": "image/png" } })
  );
  const result = await prepareImageDownload(["https://images.test/one.png"], new AbortController().signal);
  assert.match(result.name, /\.png$/);
  assert.equal(result.blob.type, "image/png");
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), bytes);
});

test("batch ZIP contains each selected original exactly once and reports progress", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(bytes, { headers: { "content-type": "image/png" } })
  );
  const progress: number[] = [];
  const result = await prepareImageDownload(
    ["https://images.test/a", "https://images.test/b", "https://images.test/c", "https://images.test/a"],
    new AbortController().signal,
    (done, total) => {
      progress.push(done);
      assert.equal(total, 3);
    }
  );
  assert.match(result.name, /\.zip$/);
  const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ["chorchat-001.png", "chorchat-002.png", "chorchat-003.png"]);
  for (const file of Object.values(files)) assert.deepEqual(file, bytes);
  assert.deepEqual(progress, [1, 2, 3]);
});

test("failed or invalid image responses reject instead of creating a partial ZIP", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) =>
    url.endsWith("bad")
      ? new Response("not found", { status: 404 })
      : new Response(bytes, { headers: { "content-type": "image/png" } })
  );
  await assert.rejects(
    prepareImageDownload(["https://images.test/a", "https://images.test/bad"], new AbortController().signal),
    /下載失敗/
  );
  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>", { headers: { "content-type": "text/html" } })
  );
  await assert.rejects(
    prepareImageDownload(["https://images.test/html"], new AbortController().signal),
    /圖片檔案/
  );
});

test("empty selections, excessive selections and cancelled downloads are rejected", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(bytes, { headers: { "content-type": "image/png" } })
  );
  await assert.rejects(prepareImageDownload([], new AbortController().signal), /1 到 100/);
  await assert.rejects(
    prepareImageDownload(
      Array.from({ length: 101 }, (_, i) => `https://images.test/${i}`),
      new AbortController().signal
    ),
    /1 到 100/
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareImageDownload(["https://images.test/cancel"], controller.signal), {
    name: "AbortError"
  });
});
