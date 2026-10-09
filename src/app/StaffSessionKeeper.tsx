"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// The shared HttpOnly cookies remain the only credentials. Daily work pages also
// count as session activity, so moving back to interviews does not trigger login.
export default function StaffSessionKeeper() {
  const pathname = usePathname();
  useEffect(() => {
    const compact = pathname === "/staff/entry" || pathname === "/classroom"
      || pathname === "/private-feedback" || pathname.startsWith("/self-study-room")
      || pathname.startsWith("/interviews") || pathname.startsWith("/reservations");
    if (compact) return;
    let disposed = false;
    let inFlight = false;
    let lastAttempt = 0;
    async function maintain() {
      if (disposed || inFlight || document.visibilityState !== "visible"
        || Date.now() - lastAttempt < 5000) return;
      inFlight = true;
      lastAttempt = Date.now();
      try {
        const response = await fetch("/api/staff/session/activity", {
          cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000),
        });
        if (response.ok && !disposed && (await response.json()).authenticated === true) {
          window.dispatchEvent(new Event("bentan:staff-session-active"));
        }
      } catch { /* A network outage does not discard the shared login or drafts. */ }
      finally { inFlight = false; }
    }
    void maintain();
    const timer = window.setInterval(() => void maintain(), 5 * 60 * 1000);
    const onFocus = () => void maintain();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pathname]);
  return null;
}
