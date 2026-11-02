/* Carehaven service worker: receives browser push messages and shows them as native notifications. */

const DEFAULT_ICON = "/push-icon.png";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Carehaven", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Carehaven";
  const options = {
    body: payload.body || "",
    icon: payload.icon || DEFAULT_ICON,
    badge: payload.badge || DEFAULT_ICON,
    tag: payload.tag || "carehaven-notification",
    renotify: false,
    data: payload,
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = event.notification.data && event.notification.data.url;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target || "/");
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target || "/");
      }
      return undefined;
    }),
  );
});
