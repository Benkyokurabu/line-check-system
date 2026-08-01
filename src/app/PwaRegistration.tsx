"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    let cancelled = false;
    let updateTimer: number | undefined;

    navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (cancelled) return;
      void registration.update();
      updateTimer = window.setInterval(() => {
        void registration.update();
      }, 60 * 60 * 1000);
    }).catch(() => {
      // The page still works normally if the browser blocks service worker registration.
    });

    return () => {
      cancelled = true;
      if (updateTimer !== undefined) window.clearInterval(updateTimer);
    };
  }, []);

  return null;
}