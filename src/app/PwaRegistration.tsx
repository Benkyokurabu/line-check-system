"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The page still works normally if the browser blocks service worker registration.
    });
  }, []);

  return null;
}