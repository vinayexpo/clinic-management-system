import { useCallback, useEffect, useState } from "react";
import { aiApi, type AiStatus } from "../api";
import { useLiveRefresh } from "./realtime";

/** Fired after an administrator saves the AI settings, so every open screen re-reads the status. */
export const AI_EVENT = "carehaven:ai-changed";

/**
 * The AI status for staff screens, refreshed on AI_EVENT.
 *
 * null while loading (or when the clinic has no AI configuration), so screens
 * can hide the AI buttons until something is actually configured.
 */
export function useAiStatus(token: string): { ai: AiStatus | null; reload: () => void } {
  const [ai, setAi] = useState<AiStatus | null>(null);
  const reload = useCallback(() => {
    return aiApi.status(token)
      .then((res) => setAi(res.data))
      .catch(() => { /* Retain the last known status during transient disconnects. */ });
  }, [token]);
  useEffect(() => {
    reload();
    const listener = () => reload();
    window.addEventListener(AI_EVENT, listener);
    return () => window.removeEventListener(AI_EVENT, listener);
  }, [reload]);
  useLiveRefresh(reload, !!token);
  return { ai, reload };
}

/** Feature labels, matching AiController::FEATURES on the server. */
export const AI_FEATURE_LABELS: Record<keyof AiStatus["features"], string> = {
  consultation: "Consultation drafts",
  prescription: "Prescription drafts",
  patient_summary: "Patient summaries",
  assistant: "Clinic assistant",
};
