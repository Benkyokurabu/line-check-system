import * as XLSX from "xlsx";
import { validateScheduleMonth, scheduleRows } from "./schedule-preview.mjs";

// Port of the existing export_schedule_json/export_by_grade_subject reader.
// Never executes macros, writes workbooks, or guesses teacher colours.
const digits = (s) => String(s ?? "").replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));
const text = (cell) => String(cell?.v ?? "").trim();
const classToken = (s) => {
  s = digits(s).replace(/[ \u3000]/g, "");
  if (/休|テスト|模試/.test(s)) return null;
  const m = s.replaceAll("翌", "").match(/([1-6])\s*([SABXＳＡＢＸ])?(特)?\s*([数算国英理社])/);
  return m ? { grade: m[1], klass: (m[2] ?? "").normalize("NFKC"), special: Boolean(m[3]), subject: m[4] === "算" ? "数" : m[4] } : null;
};
function color(cell) {
  if (cell?.scheduleColor) return cell.scheduleColor;
  const c = cell?.s?.fgColor;
  if (!c) return "rgb:000000"; // openpyxl's default colour key
  if (c.theme != null) return `theme:${c.theme}:${Math.round((c.tint ?? 0) * 1000) / 1000}`;
  if (c.indexed != null) return `indexed:${c.indexed}`;
  if (c.rgb) return `rgb:${c.rgb.slice(-6).toUpperCase()}`;
  return "rgb:000000";
}
// SheetJS CE drops some indexed foreground colours. Read the original style
// references rather than conflating those colours and assigning the wrong teacher.
function preserveOriginalColors(wb) {
  const xml = (name) => { const v = wb.files?.[name]?.content; return v ? Buffer.from(v).toString("utf8") : ""; };
  const attr = (s, name) => s.match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`))?.[1];
  const styles = xml("xl/styles.xml");
  const fills = [...(styles.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/)?.[1] ?? "").matchAll(/<fill\b[^>]*>([\s\S]*?)<\/fill>/g)].map((m) => {
    const fg = m[1].match(/<fgColor\b([^>]*)\/?\s*>/)?.[1] ?? "";
    const rgb = attr(fg, "rgb"); const indexed = attr(fg, "indexed"); const theme = attr(fg, "theme");
    return rgb ? `rgb:${rgb.slice(-6).toUpperCase()}` : indexed != null ? `indexed:${indexed}` : theme != null ? `theme:${theme}:${Math.round(Number(attr(fg, "tint") ?? 0) * 1000) / 1000}` : "rgb:000000";
  });
  const xfs = [...(styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "").matchAll(/<xf\b([^>]*)>/g)].map((m) => Number(attr(m[1], "fillId") ?? 0));
  const rels = new Map([...xml("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)>/g)].map((m) => [attr(m[1], "Id"), attr(m[1], "Target")]));
  const sheets = [...xml("xl/workbook.xml").matchAll(/<sheet\b([^>]*)>/g)];
  if (!fills.length || !xfs.length || sheets.length !== wb.SheetNames.length) throw new Error("Excelの書式情報を読み取れません。");
  sheets.forEach((m, i) => {
    const target = rels.get(attr(m[1], "r:id")); if (!target) throw new Error("Excelのシート参照が不正です。");
    const content = xml(target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
    if (!content) throw new Error("Excelのシートを読み取れません。");
    for (const c of content.matchAll(/<c\b([^>]*)>/g)) {
      const address = attr(c[1], "r"); const value = wb.Sheets[wb.SheetNames[i]][address];
      if (value) value.scheduleColor = fills[xfs[Number(attr(c[1], "s") ?? 0)]];
    }
  });
}
function sheetReader(sh) {
  const merges = sh["!merges"] ?? [];
  const raw = (r, c) => sh[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
  const cell = (r, c) => {
    const m = merges.find((m) => m.s.r < r && m.e.r >= r - 1 && m.s.c < c && m.e.c >= c - 1);
    return m ? raw(m.s.r + 1, m.s.c + 1) : raw(r, c);
  };
  const maxcol = XLSX.utils.decode_range(sh["!ref"] ?? "A1:AD60").e.c + 1;
  function dayAt(r, previous = false) {
    const read = (row) => {
      let day = null; let weekday = null;
      for (const c of [1, maxcol - 1]) { const m = digits(text(cell(row, c))).match(/\d{1,2}/); if (m && Number(m[0]) >= 1 && Number(m[0]) <= 31) { day = Number(m[0]); break; } }
      for (const c of [2, maxcol]) { const m = text(cell(row, c)).match(/[月火水木金土日]/); if (m) { weekday = m[0]; break; } }
      return { day, weekday };
    };
    const a = read(r);
    if (previous && r > 1 && (!a.day || !a.weekday)) { const b = read(r - 1); a.day ??= b.day; a.weekday ??= b.weekday; }
    return a;
  }
  const timeRe = /\d{1,2}[:：]\d{2}\s*[~～]\s*\d{1,2}[:：]\d{2}/;
  function timeAt(r, c, grade) {
    const candidates = merges.filter((m) => m.s.c < c && m.e.c >= c - 1 && m.s.r + 1 < r)
      .map((m) => ({ row: m.s.r + 1, label: text(raw(m.s.r + 1, m.s.c + 1)) }))
      .map((m) => ({ ...m, time: m.label.match(timeRe)?.[0].replaceAll("：", ":") })).filter((m) => m.time);
    if (candidates.length >= 2 && grade) {
      const keyword = ["1", "2", "3"].includes(grade) ? "中学" : "小学";
      return candidates.find((m) => m.label.includes(keyword))?.time ?? candidates.sort((a, b) => b.row - a.row)[0].time;
    }
    if (candidates.length) return candidates.sort((a, b) => a.row - b.row)[0].time;
    for (let row = r - 1; row > 1; row--) { const t = text(raw(row, c)); if (timeRe.test(t)) return t.replaceAll("：", ":"); }
    return "";
  }
  const legend = new Map();
  const nameLike = (s) => /^[ぁ-んァ-ン一-龥々〆ヵヶA-Za-z]{1,6}$/.test(s);
  function addRow(r, lo, hi) { for (let c = lo; c <= hi; c++) { const v = raw(r, c); if (nameLike(text(v)) && !legend.has(color(v))) legend.set(color(v), text(v)); } }
  addRow(56, 8, 32);
  if (!legend.size) for (let r = 54; r <= 58; r++) addRow(r, 3, 52);
  if (!legend.size) {
    let best = 0; let bestRow = 0;
    for (let r = 40; r <= 120; r++) { let n = 0; for (let c = 3; c <= 52; c++) if (nameLike(text(raw(r, c)))) n++; if (n > best) { best = n; bestRow = r; } }
    if (best >= 5) addRow(bestRow, 3, 52);
  }
  let roomRow = null;
  for (let r = 1; r < 60; r++) { let n = 0; for (let c = 3; c <= 30; c++) if (/^[①-⑨]/.test(text(raw(r, c)))) n++; if (n >= 3) { roomRow = r; break; } }
  function roomAt(c) {
    const s = roomRow ? text(cell(roomRow, c)) : "";
    const circle = s.match(/[①-⑨]/)?.[0];
    return circle ? String(circle.charCodeAt(0) - 0x2460 + 1) : digits(s).match(/\d+/)?.[0] ?? "";
  }
  return { cell, dayAt, timeAt, roomAt, teacher: (r, c) => legend.get(color(cell(r, c))) ?? "" };
}

export function parseScheduleWorkbook(buffer, month) {
  validateScheduleMonth(month);
  if (!buffer?.length || buffer.length > 8 * 1024 * 1024) throw new Error("Excelのサイズが不正です（上限8MB）。");
  const wb = XLSX.read(buffer, { type: "buffer", cellStyles: true, bookVBA: false, bookFiles: true });
  preserveOriginalColors(wb);
  const selected = new Map();
  for (const name of wb.SheetNames) {
    const n = name.replace(/[ \u3000]/g, "");
    if (!n.includes("教務")) continue;
    const campus = n.includes("本校") ? "hon" : n.includes("南") ? "minami" : null;
    if (!campus) continue;
    if (selected.has(campus)) throw new Error("同じ校舎の教務用シートが複数あります。原本を確認してください。");
    selected.set(campus, name);
  }
  if (!selected.size) throw new Error("本校・南教室の教務用シートが見つかりません。");
  const items = []; const seen = new Set();
  for (const [campus, name] of selected) {
    const sh = sheetReader(wb.Sheets[name]);
    for (let r = 2; r <= 54; r++) for (let c = 3; c <= 30; c++) {
      const raw = text(sh.cell(r, c)); if (!raw) continue;
      const token = classToken(raw);
      const specialLesson = !token && /補講|対策|英検|漢検/.test(raw);
      if (!token && !specialLesson) continue;
      const { day } = sh.dayAt(r, true); if (!day) continue;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const time = sh.timeAt(r, c, token?.grade); const room = sh.roomAt(c);
      let item;
      if (token) {
        const grade = Number(token.grade) <= 3 ? `j${token.grade}` : `e${token.grade}`;
        const subject = ({ 英: "eng", 国: "jp", 理: "sci", 社: "soc" })[token.subject] ?? (Number(token.grade) <= 3 ? "math" : "arith");
        const gradeLabel = `${Number(token.grade) <= 3 ? "中" : "小"}${String.fromCharCode(0xff10 + Number(token.grade))}`;
        const subjectLabel = ({ eng: "英語", jp: "国語", sci: "理科", soc: "社会", math: "数学", arith: "算数" })[subject];
        const face = raw.includes("対面");
        const display = digits(raw.replace(/[\r\n]+\s*対面\s*/g, "").replace(/[\s\u3000]+対面\s*$/, "")).split(/\r?\n/).filter((s) => s.trim())[0]?.replace(/[ \u3000]/g, "").replace(/[ＳＡＢＸ]/g, (s) => s.normalize("NFKC"));
        item = { date, time, grade, class: token.klass, subject, campus, room, groupKey: `${campus}_${grade}_${token.klass}_${subject}`, label: `${gradeLabel}${token.klass} ${subjectLabel}`, faceToFace: face, special: token.special, displayTitle: face ? `${display}対面` : "", teacher: sh.teacher(r, c) };
      } else {
        const label = raw.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
        item = { date, time, grade: "", class: "", subject: "", campus, room, groupKey: `${campus}_special_${label}`, label, faceToFace: false, special: true, displayTitle: label, teacher: sh.teacher(r, c), isSpecialLesson: true };
      }
      // Merged cells repeat in the scan. Only identical extracted records collapse.
      const key = JSON.stringify(item);
      if (!seen.has(key)) { seen.add(key); items.push(item); }
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.label.localeCompare(b.label));
  scheduleRows(items, month); // Reject empty/incomplete/duplicate extraction.
  return items;
}
