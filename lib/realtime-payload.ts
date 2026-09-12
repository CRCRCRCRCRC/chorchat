export const REALTIME_CHUNK_EVENT = "realtime:chunk";
const CHUNK_BYTES = 6000;
const MAX_PARTS = 32;

type Chunk = { id: string; event: string; index: number; total: number; data: string };

export function encodeRealtimePayload(event: string, payload: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.length <= 9000) return [{ name: event, data: payload }];

  const total = Math.ceil(bytes.length / CHUNK_BYTES);
  if (total > MAX_PARTS) throw new Error("Realtime payload too large.");
  const id = globalThis.crypto.randomUUID();
  return Array.from({ length: total }, (_, index) => ({
    name: REALTIME_CHUNK_EVENT,
    data: {
      id, event, index, total,
      data: btoa(String.fromCharCode(...bytes.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)))
    }
  }));
}

export function createRealtimeAssembler(emit: (event: string, data: Record<string, unknown>) => void) {
  const pending = new Map<string, { expires: number; event: string; total: number; parts: Map<number, Uint8Array> }>();
  return (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const part = value as Chunk;
    if (typeof part.id !== "string" || part.id.length > 100 ||
      !["messages:changed", "call:signal", "typing:changed"].includes(part.event) || !Number.isInteger(part.total) ||
      part.total < 1 || part.total > MAX_PARTS || !Number.isInteger(part.index) ||
      part.index < 0 || part.index >= part.total || typeof part.data !== "string" || part.data.length > 8000) return;

    for (const [id, assembly] of pending) if (assembly.expires < Date.now()) pending.delete(id);
    if (!pending.has(part.id) && pending.size >= 32) pending.delete(pending.keys().next().value!);
    const assembly = pending.get(part.id) ?? { expires: Date.now() + 15000, event: part.event, total: part.total, parts: new Map<number, Uint8Array>() };
    if (assembly.total !== part.total || assembly.event !== part.event) return;
    try {
      assembly.parts.set(part.index, Uint8Array.from(atob(part.data), (char) => char.charCodeAt(0)));
      pending.set(part.id, assembly);
      if (assembly.parts.size !== assembly.total) return;

      pending.delete(part.id);
      const bytes = new Uint8Array([...assembly.parts.values()].reduce((size, data) => size + data.length, 0));
      let offset = 0;
      for (let index = 0; index < assembly.total; index++) {
        const data = assembly.parts.get(index)!;
        bytes.set(data, offset);
        offset += data.length;
      }
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (data && typeof data === "object") emit(assembly.event, data);
    } catch {
      pending.delete(part.id);
    }
  };
}
