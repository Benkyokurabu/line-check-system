"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    let cancelled = false;
    let updateTimer: number | undefined;
    let refreshing = false;
    let updateRegistration: (() => void) | null = null;

    const reloadOnce = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    const updateWhenVisible = () => {
      if (document.visibilityState === "visible") updateRegistration?.();
    };
    const updateOnFocus = () => updateRegistration?.();

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
      updateTimer = window.setInterval(() => updateRegistration?.(), 15 * 60 * 1000);
      window.addEventListener("focus", updateOnFocus);
      document.addEventListener("visibilitychange", updateWhenVisible);
    }).catch(() => {
      // The page still works normally if the browser blocks service worker registration.
    });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", reloadOnce);
      window.removeEventListener("focus", updateOnFocus);
      document.removeEventListener("visibilitychange", updateWhenVisible);
      if (updateTimer !== undefined) window.clearInterval(updateTimer);
    };
  }, []);

  return null;
}