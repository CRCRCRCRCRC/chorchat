import type { Sender } from "@/lib/types";

export function storedMessageId(clientId: string, sender: Sender) {
  // The same send has one identity across previews, HTTP responses and polling.
  return `c${sender.toLowerCase()}${clientId.replace(/^optimistic-/, "").replace(/-/g, "")}`;
}
