export const MAX_DOWNLOAD_IMAGES = 100;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg"
};

export async function prepareImageDownload(
  urls: string[],
  signal: AbortSignal,
  onProgress?: (completed: number, total: number) => void
) {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length || unique.length > MAX_DOWNLOAD_IMAGES)
    throw new Error(`每次請選擇 1 到 ${MAX_DOWNLOAD_IMAGES} 張圖片。`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  let totalBytes = 0;
  const date = new Date().toISOString().slice(0, 10);
  async function readImage(url: string, consume: (chunk: Uint8Array) => void) {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("圖片下載失敗，請稍後重試。");
    const type = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
    if (!type.startsWith("image/")) throw new Error("無法下載此圖片，來源沒有提供圖片檔案。");
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_DOWNLOAD_BYTES) throw new Error("圖片總容量超過 100MB，請分批下載。");
        consume(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return type;
  }

  try {
    if (unique.length === 1) {
      const chunks: ArrayBuffer[] = [];
      const type = await readImage(unique[0], (chunk) => chunks.push(new Uint8Array(chunk).buffer));
      signal.throwIfAborted();
      onProgress?.(1, 1);
      return { blob: new Blob(chunks, { type }), name: `chorchat-${date}.${extensions[type] ?? "img"}` };
    }
    const { Zip, ZipPassThrough } = await import("fflate");
    const chunks: ArrayBuffer[] = [];
    let zipError: Error | null = null;
    const archive = new Zip((error, data) => {
      if (error) zipError = error;
      else chunks.push(new Uint8Array(data).buffer);
    });
    let index = 0;
    let completed = 0;
    const worker = async () => {
      while (index < unique.length) {
        const current = index++;
        const response = await fetch(unique[current], { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`第 ${current + 1} 張圖片下載失敗，請重試。`);
        const type = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
        if (!type.startsWith("image/")) throw new Error(`第 ${current + 1} 張圖片無法下載。`);
        const file = new ZipPassThrough(
          `chorchat-${String(current + 1).padStart(3, "0")}.${extensions[type] ?? "img"}`
        );
        archive.add(file);
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_DOWNLOAD_BYTES) throw new Error("圖片總容量超過 100MB，請分批下載。");
            file.push(value);
            if (zipError) throw zipError;
          }
          file.push(new Uint8Array(0), true);
          onProgress?.(++completed, unique.length);
        } finally {
          await reader.cancel().catch(() => undefined);
        }
      }
    };
    const tasks = Array.from({ length: Math.min(3, unique.length) }, worker);
    try {
      await Promise.all(tasks);
    } catch (error) {
      controller.abort();
      await Promise.allSettled(tasks);
      archive.terminate();
      throw error;
    }
    signal.throwIfAborted();
    archive.end();
    if (zipError) throw zipError;
    return { blob: new Blob(chunks, { type: "application/zip" }), name: `chorchat-photos-${date}.zip` };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
