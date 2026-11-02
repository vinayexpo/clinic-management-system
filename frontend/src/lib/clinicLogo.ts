import { useEffect, useState } from "react";
import { clinicApi, setupApi } from "../api";
import { useLiveRefresh } from "./realtime";

/** Fired after the clinic logo is uploaded or removed, so the app chrome refreshes. */
export const CLINIC_LOGO_EVENT = "clinic:logo-changed";

/**
 * The clinic logo as an object URL, or null when the clinic has no logo.
 *
 * The image is only requested when the clinic reports a logo, so a clinic without
 * one makes no failed request. A change event forces a refresh either way.
 */
export function useClinicLogo(token: string | null, hasLogo: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [override, setOverride] = useState<boolean | null>(null);
  useLiveRefresh(async () => {
    if (!token) return;
    // Re-read presence too: the original clinic prop may predate an upload/removal.
    const res = await setupApi.status();
    const clinic = res.data as { has_logo?: boolean };
    setOverride(!!clinic.has_logo);
    setVersion((current) => current + 1);
  }, !!token);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ hasLogo?: boolean }>).detail;
      // Clear the image before the old object URL is revoked, so no broken image is rendered.
      setUrl(null);
      if (typeof detail?.hasLogo === "boolean") {
        setOverride(detail.hasLogo);
      }
      setVersion((current) => current + 1);
    };
    window.addEventListener(CLINIC_LOGO_EVENT, onChange);
    return () => window.removeEventListener(CLINIC_LOGO_EVENT, onChange);
  }, []);

  useEffect(() => {
    const wanted = override ?? hasLogo;
    if (!token || !wanted) {
      setUrl(null);
      return;
    }

    let objectUrl: string | null = null;
    let alive = true;
    setUrl(null);

    clinicApi.logoBlob(token)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (alive) {
          setUrl(objectUrl);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      })
      .catch(() => {
        if (alive) setUrl(null);
      });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, override, hasLogo, version]);

  return url;
}
