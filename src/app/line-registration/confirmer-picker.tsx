"use client";

import { useEffect, useState } from "react";

const KEY = "line-contact-operator-name";
const SESSION_KEY = "line-registration-operator";

export default function ConfirmerPicker({ onActiveChange, fromRegistrationLink = false, disabled = false }: {
  onActiveChange: (name: string) => void;
  fromRegistrationLink?: boolean;
  disabled?: boolean;
}) {
  const [current, setCurrent] = useState("");
  const [editing, setEditing] = useState(true);
  const [otherName, setOtherName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const stored = window.localStorage.getItem(KEY)?.trim() ?? "";
        const passed = fromRegistrationLink ? window.sessionStorage.getItem(SESSION_KEY) : null;
        const name = passed === null ? stored : passed.trim() === stored ? stored : "";
        setCurrent(name);
        setEditing(!name);
        onActiveChange(name);
      } catch {
        setCurrent("");
        setEditing(true);
        onActiveChange("");
        setError("このブラウザに担当者名を保存できません。ブラウザの保存設定を確認してください。");
      }
    });
    return () => { active = false; };
  }, [fromRegistrationLink, onActiveChange]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== KEY || event.newValue?.trim() === current) return;
      setCurrent("");
      setOtherName("");
      setEditing(true);
      onActiveChange("");
      setError("別のタブで担当者が変更されました。この画面でも入力し直してください。");
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [current, onActiveChange]);

  useEffect(() => {
    const changed = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      if (!name) return;
      setCurrent(name);
      setEditing(false);
      setError("");
      onActiveChange(name);
    };
    window.addEventListener("line-confirmer-changed", changed);
    return () => window.removeEventListener("line-confirmer-changed", changed);
  }, [onActiveChange]);

  function save() {
    const name = otherName.trim();
    if (!name || name.length > 100) return;
    try {
      if (current && window.localStorage.getItem(KEY)?.trim() !== current) throw Error("operator changed elsewhere");
      window.localStorage.setItem(KEY, name);
      if (window.localStorage.getItem(KEY) !== name) throw Error("storage verification failed");
      try { window.sessionStorage.setItem(SESSION_KEY, name); } catch { /* The durable choice is in localStorage. */ }
      setCurrent(name);
      setEditing(false);
      setError("");
      onActiveChange(name);
      window.dispatchEvent(new CustomEvent("line-confirmer-changed", { detail: name }));
    } catch {
      setCurrent("");
      setEditing(true);
      onActiveChange("");
      setError("担当者名を保存できませんでした。確認記録は行わず、ブラウザの保存設定を確認してください。");
    }
  }

  function startChange() {
    onActiveChange("");
    setOtherName(current);
    setEditing(true);
    setError("");
  }

  return <div aria-label="LINE確認担当者" style={{ display: "grid", gap: 8, minWidth: 0, width: "100%", maxWidth: 360 }}>
    {current && !editing ? <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <strong>確認担当者：{current}</strong>
      <button type="button" disabled={disabled} onClick={startChange}>担当者を変更</button>
    </div> : <>
      <label style={{ display: "grid", gap: 6 }}>確認担当者を入力
        <input value={otherName} maxLength={100} style={{ minWidth: 0, width: "100%", padding: 8 }} disabled={disabled || !!error} onChange={event => { setOtherName(event.target.value); setError(""); }} />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={disabled || !!error || !otherName.trim()} onClick={save}>この担当者で続ける</button>
        {current && <button type="button" disabled={disabled} onClick={() => { setEditing(false); onActiveChange(current); setError(""); }}>変更をやめる</button>}
      </div>
    </>}
    {error && <p role="alert" style={{ margin: 0, color: "#b42318" }}>{error} <button type="button" onClick={() => setError("")}>再試行</button></p>}
  </div>;
}
