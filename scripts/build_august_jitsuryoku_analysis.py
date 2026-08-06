from __future__ import annotations

import html
import json
import math
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "●指導簿(2026年度) .xlsm"
OUTPUT_DIR = ROOT / "analysis_outputs"
OUTPUT = OUTPUT_DIR / "2026_08_jitsuryoku_analysis.html"


def to_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def date_parts(value):
    if hasattr(value, "year"):
        return value.year, value.month
    if value:
        text = str(value)
        try:
            parsed = datetime.fromisoformat(text[:10])
            return parsed.year, parsed.month
        except ValueError:
            return None, None
    return None, None


def mean(values):
    nums = [v for v in values if v is not None]
    return round(sum(nums) / len(nums), 1) if nums else None


def median(values):
    nums = [v for v in values if v is not None]
    return round(statistics.median(nums), 1) if nums else None


def stdev(values):
    nums = [v for v in values if v is not None]
    return round(statistics.pstdev(nums), 1) if len(nums) >= 2 else None


def pct(value):
    if value is None:
        return "-"
    return f"{value:.1f}"


def score_band(score):
    if score is None:
        return "未入力"
    if score >= 80:
        return "80点以上"
    if score >= 60:
        return "60-79点"
    if score >= 40:
        return "40-59点"
    return "39点以下"


def read_records():
    wb = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True, keep_vba=True)
    ws = wb["DB_塾内テスト"]
    headers = [str(v) if v is not None else "" for v in next(ws.iter_rows(min_row=3, max_row=3, values_only=True))]
    records = []
    for row in ws.iter_rows(min_row=4, values_only=True):
        item = dict(zip(headers, row))
        year, month = date_parts(item.get("実施年月"))
        if year != 2026 or month != 8 or item.get("テスト名") != "前期実力テスト":
            continue
        score = to_float(item.get("点数"))
        if score is None:
            continue
        records.append(
            {
                "student_id": str(item.get("学籍番号") or ""),
                "name": str(item.get("氏名") or ""),
                "campus": str(item.get("校舎") or ""),
                "grade": str(item.get("学年") or ""),
                "subject": str(item.get("科目") or ""),
                "klass": str(item.get("クラス") or ""),
                "lesson": str(item.get("授業名") or ""),
                "score": score,
                "avg": to_float(item.get("平均点")),
                "deviation": to_float(item.get("塾内偏差値")),
                "rank": to_float(item.get("順位")),
                "count": to_float(item.get("人数")),
            }
        )
    return records


def group_stats(records, keys):
    groups = defaultdict(list)
    for record in records:
        groups[tuple(record[k] for k in keys)].append(record)
    rows = []
    for key, items in groups.items():
        scores = [r["score"] for r in items]
        rows.append(
            {
                **{keys[i]: key[i] for i in range(len(keys))},
                "n": len(items),
                "avg": mean(scores),
                "median": median(scores),
                "stdev": stdev(scores),
                "max": max(scores),
                "min": min(scores),
                "under40": sum(1 for s in scores if s < 40),
                "over80": sum(1 for s in scores if s >= 80),
            }
        )
    return sorted(rows, key=lambda r: tuple(str(r[k]) for k in keys))


def build_student_rows(records):
    grouped = defaultdict(list)
    for record in records:
        grouped[(record["student_id"], record["name"], record["grade"], record["campus"])].append(record)

    rows = []
    for (student_id, name, grade, campus), items in grouped.items():
        by_subject = {r["subject"]: r["score"] for r in items}
        scores = list(by_subject.values())
        if not scores:
            continue
        weak_subject = min(by_subject.items(), key=lambda x: x[1])
        strong_subject = max(by_subject.items(), key=lambda x: x[1])
        rows.append(
            {
                "student_id": student_id,
                "name": name,
                "grade": grade,
                "campus": campus,
                "subjects": by_subject,
                "total": round(sum(scores), 1),
                "avg": round(sum(scores) / len(scores), 1),
                "weak_subject": weak_subject[0],
                "weak_score": weak_subject[1],
                "strong_subject": strong_subject[0],
                "strong_score": strong_subject[1],
                "tested": len(scores),
            }
        )
    return rows


def distribution(records):
    groups = defaultdict(lambda: defaultdict(int))
    for record in records:
        groups[(record["grade"], record["campus"], record["subject"])][score_band(record["score"])] += 1
    rows = []
    for key, bands in groups.items():
        total = sum(bands.values())
        rows.append(
            {
                "grade": key[0],
                "campus": key[1],
                "subject": key[2],
                "total": total,
                "bands": {band: bands.get(band, 0) for band in ["80点以上", "60-79点", "40-59点", "39点以下"]},
            }
        )
    return sorted(rows, key=lambda r: (r["grade"], r["campus"], r["subject"]))


def esc(value):
    return html.escape(str(value), quote=True)


def render_table(rows, columns):
    head = "".join(f"<th>{esc(label)}</th>" for _, label in columns)
    body = []
    for row in rows:
        cells = []
        for key, _ in columns:
            value = row.get(key, "")
            if isinstance(value, float):
                value = pct(value)
            cells.append(f"<td>{esc(value)}</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")
    return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def main():
    records = read_records()
    student_rows = build_student_rows(records)
    grade_stats = group_stats(records, ["grade"])
    campus_grade_subject = group_stats(records, ["grade", "campus", "subject"])
    class_stats = group_stats(records, ["grade", "campus", "subject", "klass"])
    dist_rows = distribution(records)

    subjects = sorted({r["subject"] for r in records})
    student_rank = sorted(student_rows, key=lambda r: (-r["avg"], r["grade"], r["campus"], r["name"]))
    concern = sorted(
        [r for r in student_rows if r["weak_score"] < 40 or r["avg"] < 50],
        key=lambda r: (r["avg"], r["weak_score"], r["grade"], r["campus"], r["name"]),
    )

    payload = {
        "records": records,
        "students": student_rows,
        "gradeStats": grade_stats,
        "campusGradeSubject": campus_grade_subject,
        "classStats": class_stats,
        "distribution": dist_rows,
        "subjects": subjects,
    }

    cards = [
        ("受験データ", f"{len(records):,}", "科目別の延べ件数"),
        ("生徒数", f"{len(student_rows):,}", "1科目以上の受験者"),
        ("全体平均", pct(mean([r["score"] for r in records])), "全学年・全科目"),
        ("40点未満", f"{sum(1 for r in records if r['score'] < 40):,}", "延べ件数"),
    ]

    top_html = render_table(
        student_rank[:40],
        [
            ("grade", "学年"),
            ("campus", "校舎"),
            ("student_id", "学籍番号"),
            ("name", "氏名"),
            ("avg", "平均"),
            ("total", "合計"),
            ("tested", "科目数"),
            ("strong_subject", "最高科目"),
            ("strong_score", "最高点"),
            ("weak_subject", "最低科目"),
            ("weak_score", "最低点"),
        ],
    )
    concern_html = render_table(
        concern,
        [
            ("grade", "学年"),
            ("campus", "校舎"),
            ("student_id", "学籍番号"),
            ("name", "氏名"),
            ("avg", "平均"),
            ("weak_subject", "要確認科目"),
            ("weak_score", "点数"),
            ("tested", "科目数"),
        ],
    )
    class_html = render_table(
        class_stats,
        [
            ("grade", "学年"),
            ("campus", "校舎"),
            ("subject", "科目"),
            ("klass", "クラス"),
            ("n", "人数"),
            ("avg", "平均"),
            ("median", "中央値"),
            ("stdev", "標準偏差"),
            ("max", "最高"),
            ("min", "最低"),
            ("under40", "40未満"),
            ("over80", "80以上"),
        ],
    )
    subject_html = render_table(
        campus_grade_subject,
        [
            ("grade", "学年"),
            ("campus", "校舎"),
            ("subject", "科目"),
            ("n", "人数"),
            ("avg", "平均"),
            ("median", "中央値"),
            ("stdev", "標準偏差"),
            ("max", "最高"),
            ("min", "最低"),
            ("under40", "40未満"),
            ("over80", "80以上"),
        ],
    )

    dist_html = []
    for row in dist_rows:
        total = row["total"] or 1
        bars = "".join(
            f'<span class="seg seg{i}" style="width:{row["bands"][band] / total * 100:.2f}%" title="{esc(band)} {row["bands"][band]}"></span>'
            for i, band in enumerate(["80点以上", "60-79点", "40-59点", "39点以下"], start=1)
        )
        dist_html.append(
            f"<tr><td>{esc(row['grade'])}</td><td>{esc(row['campus'])}</td><td>{esc(row['subject'])}</td>"
            f"<td>{row['total']}</td><td><div class=\"bar\">{bars}</div></td>"
            f"<td>{row['bands']['80点以上']}</td><td>{row['bands']['60-79点']}</td>"
            f"<td>{row['bands']['40-59点']}</td><td>{row['bands']['39点以下']}</td></tr>"
        )

    cards_html = "".join(
        f"<section class=\"metric\"><div>{esc(label)}</div><strong>{esc(value)}</strong><span>{esc(note)}</span></section>"
        for label, value, note in cards
    )

    html_text = f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>2026年8月 前期実力テスト分析</title>
  <style>
    :root {{
      color-scheme: light;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #d7dde7;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --blue: #2563eb;
      --green: #138a57;
      --yellow: #c08403;
      --red: #cf3a3a;
      --navy: #23324a;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Yu Gothic", "Meiryo", system-ui, sans-serif;
      color: var(--ink);
      background: var(--bg);
      font-size: 14px;
      line-height: 1.5;
    }}
    header {{
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      padding: 18px 24px 14px;
      position: sticky;
      top: 0;
      z-index: 10;
    }}
    h1 {{ margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0; }}
    header p {{ margin: 4px 0 0; color: var(--muted); }}
    main {{ padding: 20px 24px 48px; max-width: 1440px; margin: 0 auto; }}
    .metrics {{ display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; margin-bottom: 18px; }}
    .metric {{ background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }}
    .metric div {{ color: var(--muted); font-size: 12px; }}
    .metric strong {{ display: block; font-size: 26px; margin: 2px 0; }}
    .metric span {{ color: var(--muted); font-size: 12px; }}
    .filters {{ display: flex; flex-wrap: wrap; gap: 10px; align-items: end; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 18px; }}
    label {{ display: grid; gap: 4px; color: var(--muted); font-size: 12px; }}
    select, input {{ min-width: 150px; height: 34px; border: 1px solid var(--line); border-radius: 6px; padding: 0 9px; background: #fff; color: var(--ink); }}
    input {{ min-width: 220px; }}
    .tabs {{ display: flex; gap: 6px; border-bottom: 1px solid var(--line); margin: 18px 0 12px; }}
    .tab {{ border: 1px solid var(--line); border-bottom: 0; background: #eef2f7; padding: 8px 12px; border-radius: 6px 6px 0 0; cursor: pointer; color: var(--navy); }}
    .tab.active {{ background: var(--panel); font-weight: 700; }}
    .panel {{ display: none; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; overflow: auto; }}
    .panel.active {{ display: block; }}
    h2 {{ margin: 0 0 10px; font-size: 16px; }}
    table {{ border-collapse: collapse; width: 100%; min-width: 900px; }}
    th, td {{ border-bottom: 1px solid #e6eaf0; padding: 7px 8px; text-align: left; white-space: nowrap; }}
    th {{ position: sticky; top: 92px; background: #f0f4f8; z-index: 2; font-size: 12px; color: #344054; }}
    tbody tr:hover {{ background: #f8fbff; }}
    td:nth-child(n+5) {{ text-align: right; }}
    .bar {{ display: flex; height: 18px; width: 260px; border-radius: 4px; overflow: hidden; background: #e5e7eb; }}
    .seg1 {{ background: var(--green); }}
    .seg2 {{ background: var(--blue); }}
    .seg3 {{ background: var(--yellow); }}
    .seg4 {{ background: var(--red); }}
    .legend {{ display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); margin-bottom: 10px; }}
    .legend i {{ display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }}
    .note {{ color: var(--muted); margin: 0 0 10px; }}
    @media (max-width: 760px) {{
      header {{ position: static; padding: 14px 16px; }}
      main {{ padding: 14px 16px 32px; }}
      .metrics {{ grid-template-columns: repeat(2, minmax(120px, 1fr)); }}
      select, input {{ width: 100%; min-width: 0; }}
      label {{ flex: 1 1 160px; }}
      th {{ top: 0; }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>2026年8月 前期実力テスト分析</h1>
    <p>参照元: {esc(SOURCE.name)} / 作成: {datetime.now().strftime('%Y-%m-%d %H:%M')}</p>
  </header>
  <main>
    <div class="metrics">{cards_html}</div>
    <section class="filters">
      <label>学年<select id="gradeFilter"><option value="">全て</option></select></label>
      <label>校舎<select id="campusFilter"><option value="">全て</option></select></label>
      <label>科目<select id="subjectFilter"><option value="">全て</option></select></label>
      <label>氏名・学籍番号<input id="searchFilter" type="search" placeholder="検索"></label>
    </section>

    <div class="tabs">
      <button class="tab active" data-panel="summary">全体</button>
      <button class="tab" data-panel="subject">科目別</button>
      <button class="tab" data-panel="class">クラス別</button>
      <button class="tab" data-panel="students">個人一覧</button>
      <button class="tab" data-panel="concern">要確認</button>
      <button class="tab" data-panel="dist">分布</button>
    </div>

    <section id="summary" class="panel active">
      <h2>学年別サマリー</h2>
      {render_table(grade_stats, [("grade", "学年"), ("n", "延べ件数"), ("avg", "平均"), ("median", "中央値"), ("stdev", "標準偏差"), ("max", "最高"), ("min", "最低"), ("under40", "40未満"), ("over80", "80以上")])}
    </section>
    <section id="subject" class="panel">
      <h2>学年・校舎・科目別</h2>
      {subject_html}
    </section>
    <section id="class" class="panel">
      <h2>クラス別</h2>
      {class_html}
    </section>
    <section id="students" class="panel">
      <h2>個人一覧 上位40名</h2>
      <p class="note">平均点順。詳細な全件検索は下のデータからブラウザ内で絞り込めます。</p>
      <div id="studentTable">{top_html}</div>
    </section>
    <section id="concern" class="panel">
      <h2>要確認リスト</h2>
      <p class="note">平均50点未満、または1科目でも40点未満の生徒です。</p>
      <div id="concernTable">{concern_html}</div>
    </section>
    <section id="dist" class="panel">
      <h2>点数分布</h2>
      <div class="legend">
        <span><i class="seg1"></i>80点以上</span><span><i class="seg2"></i>60-79点</span><span><i class="seg3"></i>40-59点</span><span><i class="seg4"></i>39点以下</span>
      </div>
      <table><thead><tr><th>学年</th><th>校舎</th><th>科目</th><th>人数</th><th>分布</th><th>80以上</th><th>60-79</th><th>40-59</th><th>39以下</th></tr></thead><tbody>{''.join(dist_html)}</tbody></table>
    </section>
  </main>
  <script id="payload" type="application/json">{json.dumps(payload, ensure_ascii=False)}</script>
  <script>
    const data = JSON.parse(document.getElementById('payload').textContent);
    const filters = {{
      grade: document.getElementById('gradeFilter'),
      campus: document.getElementById('campusFilter'),
      subject: document.getElementById('subjectFilter'),
      search: document.getElementById('searchFilter')
    }};
    function fill(select, values) {{
      [...new Set(values.filter(Boolean))].sort().forEach(v => {{
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v; select.appendChild(opt);
      }});
    }}
    fill(filters.grade, data.records.map(r => r.grade));
    fill(filters.campus, data.records.map(r => r.campus));
    fill(filters.subject, data.records.map(r => r.subject));
    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {{
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.panel).classList.add('active');
    }}));
    function table(rows) {{
      const cols = ['grade','campus','student_id','name','avg','total','tested','strong_subject','strong_score','weak_subject','weak_score'];
      const labels = ['学年','校舎','学籍番号','氏名','平均','合計','科目数','最高科目','最高点','最低科目','最低点'];
      return '<table><thead><tr>' + labels.map(x => `<th>${{x}}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + cols.map(c => `<td>${{r[c] ?? ''}}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
    }}
    function applyFilters() {{
      const q = filters.search.value.trim();
      let rows = data.students.filter(r =>
        (!filters.grade.value || r.grade === filters.grade.value) &&
        (!filters.campus.value || r.campus === filters.campus.value) &&
        (!q || r.name.includes(q) || r.student_id.includes(q)) &&
        (!filters.subject.value || Object.prototype.hasOwnProperty.call(r.subjects, filters.subject.value))
      ).sort((a,b) => b.avg - a.avg);
      document.getElementById('studentTable').innerHTML = table(rows);
      const concern = rows.filter(r => r.weak_score < 40 || r.avg < 50).sort((a,b) => a.avg - b.avg);
      document.getElementById('concernTable').innerHTML = table(concern);
    }}
    Object.values(filters).forEach(el => el.addEventListener('input', applyFilters));
  </script>
</body>
</html>
"""
    OUTPUT_DIR.mkdir(exist_ok=True)
    OUTPUT.write_text(html_text, encoding="utf-8")
    print(OUTPUT)
    print(f"records={len(records)} students={len(student_rows)} concerns={len(concern)}")


if __name__ == "__main__":
    main()
