"use client";
import Link from "next/link";
import { useEffect, useEffectEvent, type CSSProperties, type ReactNode } from "react";
export type RegistrationChange = { userId: string; alias: string; relation?: string; studentNumbers?: string[] };
export type RegistrationEntry = { userId: string; returnTo: "/attendance" | "/contacts" | "/students"; source: string; studentNumber?: string; evidenceId?: string; operator?: string; mode?: "name" | "register"; relation?: string };
export function registrationHref(entry: RegistrationEntry) {
  const params = new URLSearchParams({ userId: entry.userId, returnTo: entry.returnTo, source: entry.source });
  if (entry.studentNumber) params.set("student", entry.studentNumber);
  if (entry.evidenceId) params.set("evidence", entry.evidenceId);
  if (entry.mode) params.set("mode", entry.mode);
  if (entry.relation === "staff") params.set("relation", "staff");
  return `/line-registration?${params}`;
}
export function rememberRegistrationOperator(operator?: string) {
  if (operator !== undefined) { try { sessionStorage.setItem("line-registration-operator", operator); } catch {} }
}
export function RegistrationLink({ entry, children, style }: { entry: RegistrationEntry; children: ReactNode; style?: CSSProperties }) {
  return <Link href={registrationHref(entry)} prefetch={false} scroll={false} style={{ ...style, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", minHeight: 44, boxSizing: "border-box", whiteSpace: "normal", overflowWrap: "anywhere" }} onClick={event => { event.stopPropagation(); rememberRegistrationOperator(entry.operator); }}>{children}</Link>;
}
export function useRegistrationRefresh(refresh: (change: RegistrationChange) => Promise<void>) {
  const changed = useEffectEvent(refresh);
  useEffect(() => {
    const listener = (event: Event) => { void changed((event as CustomEvent<RegistrationChange>).detail).catch(() => { window.dispatchEvent(new CustomEvent("line-registration-refresh-error")); }); };
    window.addEventListener("line-registration-saved", listener);
    return () => window.removeEventListener("line-registration-saved", listener);
  }, []);
}
