// Minimal service worker: lets browsers offer "install" for the portal.
// It does not cache anything, so the app always loads the latest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
