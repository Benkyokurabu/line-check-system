"use client";

import { useEffect } from "react";

const APP_VERSION_KEY = "line-check:app-version";

type VersionResponse = { version?: string };

export function PwaRegistration() {
  useEffect(() => {
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    let cancelled = false;

    let refreshing = false;
    let updateRegistration: (() => void) | null = null;

    const reloadOnce = () => {
      if (refreshing || cancelled) return;
      refreshing = true;
      window.location.reload();
    };

    const checkAppVersion = async () => {
      try {
        const response = await fetch(`/api/app-version?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as VersionResponse;
        const version = typeof body.version === "string" && body.version ? body.version : null;
        if (!version || version === "local") return;
        const previous = window.localStorage.getItem(APP_VERSION_KEY);
        if (!previous) {
          window.localStorage.setItem(APP_VERSION_KEY, version);
          return;
        }
        if (previous !== version) {
          window.localStorage.setItem(APP_VERSION_KEY, version);
          reloadOnce();
        }
      } catch {
        // Version checks are best-effort; the app can still run with normal fetches.
      }
    };

    const updateWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      updateRegistration?.();
      void checkAppVersion();
    };
    const updateOnFocus = () => {
      updateRegistration?.();
      void checkAppVersion();
    };

    void checkAppVersion();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);

      navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (cancelled) return;

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) reloadOnce();
          });
        });

        updateRegistration = () => void registration.update();
        updateRegistration();
      }).catch(() => {
        // The page still works normally if the browser blocks service worker registration.
      });
    }

    const updateTimer = window.setInterval(() => {
      updateRegistration?.();
      void checkAppVersion();
    }, 5 * 60 * 1000);
    window.addEventListener("focus", updateOnFocus);
    document.addEventListener("visibilitychange", updateWhenVisible);

    return () => {
      cancelled = true;
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange", reloadOnce);
      window.removeEventListener("focus", updateOnFocus);
      document.removeEventListener("visibilitychange", updateWhenVisible);
      window.clearInterval(updateTimer);
    };
  }, []);

  return null;
}