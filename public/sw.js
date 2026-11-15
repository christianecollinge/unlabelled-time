// Unlabelled Time's service worker. It caches nothing: the app always reads the server.
// It is here so the app can be installed, and so the "Timer paused" notification's
// Resume button works while the page is hidden.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function tellPages() {
  const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const page of pages) page.postMessage({ type: "timer-changed" });
  return pages;
}

async function openApp(pages) {
  const page = pages.find((p) => new URL(p.url).origin === self.location.origin);
  if (page) return page.focus();
  return self.clients.openWindow("/");
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      if (event.action === "resume") {
        const response = await fetch("/api/timer/resume", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          credentials: "same-origin",
        }).catch(() => null);
        const pages = await tellPages();
        // Signed out, or it did not work: open the app so the person sees why.
        if (!response || !response.ok) await openApp(pages);
        else if (self.navigator.setAppBadge) await self.navigator.setAppBadge().catch(() => undefined);
        return;
      }
      await openApp(await self.clients.matchAll({ type: "window", includeUncontrolled: true }));
    })(),
  );
});
