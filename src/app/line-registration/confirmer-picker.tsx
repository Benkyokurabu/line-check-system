"use client";

import { useEffect, useState } from "react";

const KEY = "line-contact-operator-name";
const SESSION_KEY = "line-registration-operator";
const OTHER = "__other__";

export default function ConfirmerPicker({ onActiveChange, fromRegistrationLink = false, disabled = false }: {
  onActiveChange: (name: string) => void;
  fromRegistrationLink?: boolean;
  disabled?: boolean;
}) {
  const [current, setCurrent] = useState("");
  const [editing, setEditing] = useState(true);
  const [choice, setChoice] = useState("");
  const [otherName, setOtherName] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

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
      setChoice("");
      setEditing(true);
      onActiveChange("");
      setError("別のタブで担当者が変更されました。この画面でも選び直してください。");
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

  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) setLoading(true); });
    void fetch("/api/admin/teachers", { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.teachers)) throw Error("担当者候補を取得できませんでした。");
      const available = (body.teachers as Array<{ display_name?: unknown }>).map(item => item.display_name)
        .filter((name: unknown): name is string => typeof name === "string" && !!name.trim());
      setNames([...new Set(available)].sort((left, right) => left.localeCompare(right, "ja")));
    }).catch(() => { if (!controller.signal.aborted) setError("担当者候補を取得できませんでした。再読み込みしてください。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [editing, retry]);

  function save() {
    const name = (choice === OTHER ? otherName : choice).trim();
    if (!name || name.length > 100 || choice !== OTHER && !names.includes(name)) return;
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
    setChoice(names.includes(current) ? current : current ? OTHER : "");
    setOtherName(current);
    setEditing(true);
    setError("");
  }

  return <div aria-label="LINE確認担当者" style={{ display: "grid", gap: 8, minWidth: 0, width: "100%", maxWidth: 360 }}>
    {current && !editing ? <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <strong>確認担当者：{current}</strong>
      <button type="button" disabled={disabled} onClick={startChange}>担当者を変更</button>
    </div> : <>
      <label style={{ display: "grid", gap: 6 }}>確認担当者を選択
        <select value={choice} style={{ minWidth: 0, width: "100%", padding: 8 }} disabled={disabled || loading || !!error} onChange={event => { setChoice(event.target.value); setError(""); }}>
          <option value="">選択してください</option>
          {names.map(name => <option key={name} value={name}>{name}</option>)}
          <option value={OTHER}>候補にない担当者</option>
        </select>
      </label>
      {choice === OTHER && <label style={{ display: "grid", gap: 6 }}>担当者名
        <input value={otherName} maxLength={100} disabled={disabled} onChange={event => setOtherName(event.target.value)} />
      </label>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={disabled || loading || !!error || !choice || choice === OTHER && !otherName.trim()} onClick={save}>この担当者で続ける</button>
        {current && <button type="button" disabled={disabled} onClick={() => { setEditing(false); onActiveChange(current); setError(""); }}>変更をやめる</button>}
      </div>
    </>}
    {error && <p role="alert" style={{ margin: 0, color: "#b42318" }}>{error} <button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>再試行</button></p>}
  </div>;
}
