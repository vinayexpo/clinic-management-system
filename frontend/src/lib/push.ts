import { notificationApi, type PushSubscriptionPayload } from "../api";

/**
 * Browser push helpers. A push subscription needs the service worker, the VAPID
 * public key issued by the API, and the user's permission to receive notifications.
 */

export type PushState = "unsupported" | "denied" | "default" | "granted" | "subscribed";

function base64UrlToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(window.isSecureContext) &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return await navigator.serviceWorker.ready;
  } catch (err) {
    console.error("Failed to register service worker:", err);
    return null;
  }
}

export function currentPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function checkPushSubscription(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
}

function toPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const rawP256dh = subscription.getKey ? subscription.getKey("p256dh") : null;
  const rawAuth = subscription.getKey ? subscription.getKey("auth") : null;

  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh || arrayBufferToBase64Url(rawP256dh),
      auth: json.keys?.auth || arrayBufferToBase64Url(rawAuth),
    },
    // Firefox uses aesgcm, Chrome and Safari use aes128gcm.
    content_encoding: (subscription as unknown as { encryption?: string }).encryption === "aesgcm" ? "aesgcm" : "aes128gcm",
  };
}

/** Subscribe the browser to push and register the subscription with the API. */
export async function subscribeToPush(token: string, vapidPublicKey: string): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";
  if (!vapidPublicKey) {
    console.warn("VAPID public key is missing.");
    return "default";
  }

  const permission = await requestPermission();
  if (permission !== "granted") return permission;

  const registration = await registerServiceWorker();
  if (!registration) {
    console.warn("Service worker is not ready for push subscription.");
    return "default";
  }

  try {
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
      });
    }

    let payload = toPayload(subscription);
    if (!payload.keys.p256dh || !payload.keys.auth) {
      await subscription.unsubscribe();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
      });
      payload = toPayload(subscription);
    }

    await notificationApi.subscribePush(token, payload);
    return "subscribed";
  } catch (error) {
    console.error("Push subscription initial attempt failed, attempting fresh retry:", error);
    try {
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }
      const fresh = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
      });
      await notificationApi.subscribePush(token, toPayload(fresh));
      return "subscribed";
    } catch (retryError) {
      console.error("Push subscription retry failed:", retryError);
    }
    return Notification.permission === "denied" ? "denied" : "default";
  }
}

/** Remove the browser subscription and tell the API to forget it. */
export async function unsubscribeFromPush(token: string): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      try {
        await notificationApi.unsubscribePush(token, subscription.endpoint);
      } catch {
        // The server record may already be gone; removing locally is what matters.
      }
      await subscription.unsubscribe();
    }
  } catch (err) {
    console.error("Error unsubscribing from push:", err);
  }

  return "default";
}
