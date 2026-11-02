import type { WhatsAppSignupAttempt } from "../api";

interface FacebookSdk {
  init(options: { appId: string; version: string; xfbml: boolean; cookie: boolean }): void;
  login(callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>): void;
}

const sdkWindow = window as Window & { FB?: FacebookSdk };
let sdkPromise: Promise<void> | null = null;

// Called only after the administrator explicitly chooses to connect with Meta.
export function prepareWhatsAppSignup(attempt: WhatsAppSignupAttempt): Promise<void> {
  if (!sdkPromise) {
    sdkPromise = new Promise<void>((resolve, reject) => {
      if (sdkWindow.FB) { resolve(); return; }
      const script = document.createElement("script");
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      const timeout = window.setTimeout(() => { script.remove(); reject(new Error("Meta signup did not load. Check your connection and browser blockers, then retry.")); }, 20000);
      script.onload = () => { window.clearTimeout(timeout); sdkWindow.FB ? resolve() : reject(new Error("Meta signup is unavailable.")); };
      script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error("Could not load Meta signup. Check browser blockers and retry.")); };
      document.head.appendChild(script);
    }).catch((error: unknown) => { sdkPromise = null; throw error; });
  }
  return sdkPromise.then(() => sdkWindow.FB!.init({ appId: attempt.app_id, version: attempt.graph_version, xfbml: false, cookie: false }));
}

// Keep FB.login synchronous with the button click so popup blockers do not intercept it.
export function launchWhatsAppSignup(attempt: WhatsAppSignupAttempt, signal: AbortSignal): Promise<{ code: string; waba_id: string }> {
  return new Promise((resolve, reject) => {
    let code: string | undefined;
    let wabaId: string | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled || (!error && (!code || !wabaId))) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ code: code!, waba_id: wabaId! });
    };
    const onMessage = (event: MessageEvent) => {
      if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
      let payload: unknown = event.data;
      try { if (typeof payload === "string") payload = JSON.parse(payload); } catch { return; }
      if (!payload || typeof payload !== "object") return;
      const message = payload as { type?: string; event?: string; data?: { waba_id?: string } };
      if (message.type !== "WA_EMBEDDED_SIGNUP") return;
      if (message.event === "CANCEL" || message.event === "ERROR") {
        finish(new Error("Meta signup was cancelled or could not finish. No new connection was saved."));
      } else if (message.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" && /^\d+$/.test(message.data?.waba_id ?? "")) {
        wabaId = message.data!.waba_id;
        finish();
      }
    };
    const onAbort = () => finish(new Error("Connection cancelled."));
    const timer = window.setTimeout(() => finish(new Error("Meta signup timed out. Prepare a new connection and try again.")), 300000);
    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    if (!sdkWindow.FB) { finish(new Error("Prepare Meta signup before connecting.")); return; }
    try {
      sdkWindow.FB.login((response) => {
        if (!response.authResponse?.code) {
          finish(new Error("Meta did not authorize the connection. Retry and choose your existing Business app number."));
          return;
        }
        code = response.authResponse.code;
        finish();
      }, {
        config_id: attempt.config_id,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      });
    } catch {
      finish(new Error("Meta signup could not open. Allow popups for this site and retry."));
    }
  });
}
