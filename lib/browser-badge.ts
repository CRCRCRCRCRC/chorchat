const DEFAULT_TITLE = "chorchat";

function createFaviconDataUrl(hasUnread: boolean) {
  const unreadDot = hasUnread
    ? '<circle cx="8" cy="8" r="6" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>'
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111827"/><text x="32" y="43" text-anchor="middle" font-family="Arial,sans-serif" font-size="40" font-weight="700" fill="#ffffff">c</text>${unreadDot}</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function updateBrowserUnreadBadge(unreadCount: number) {
  if (typeof document === "undefined") {
    return;
  }

  document.title =
    unreadCount > 0 ? `(${unreadCount > 99 ? "99+" : unreadCount}) ${DEFAULT_TITLE}` : DEFAULT_TITLE;

  let favicon = document.querySelector<HTMLLinkElement>('link[data-chorchat-favicon="true"]');

  if (!favicon) {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/svg+xml";
    favicon.dataset.chorchatFavicon = "true";
    document.head.appendChild(favicon);
  }

  favicon.href = createFaviconDataUrl(unreadCount > 0);

  const badgeNavigator = navigator as Navigator & {
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };

  if (unreadCount > 0) {
    void badgeNavigator.setAppBadge?.(unreadCount).catch(() => undefined);
  } else {
    void badgeNavigator.clearAppBadge?.().catch(() => undefined);
  }
}

export function clearBrowserUnreadBadge() {
  updateBrowserUnreadBadge(0);
}
