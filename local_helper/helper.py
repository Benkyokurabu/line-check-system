"""Local-only bridge between the authenticated staff page and the seven NAS sources."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image
from openpyxl import load_workbook
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

PORT = 38473
ORIGIN = os.environ.get('BENTAN_ORIGIN', 'https://line-check-system.vercel.app')
ROOT = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
CONFIG = ROOT / 'sources.txt'
GUIDE_CONFIG = ROOT / 'guide-path.txt'
SUFFIXES = {'.pdf', '.jpg', '.jpeg', '.png'}
SESSIONS: dict[str, tuple[float, tempfile.TemporaryDirectory, dict]] = {}
LOCK = threading.Lock()


def norm(value: str) -> str:
    return re.sub(r'[\s\u3000]', '', unicodedata.normalize('NFKC', str(value))).lower()


def school_key(value: str) -> str:
    value = re.sub(r'^[ぁ-ん](?=[\s　]|[一-龯])', '', str(value))
    return norm(value).replace('高等学校', '').replace('高校', '')


def school_name_matches(filename: str, school: str) -> bool:
    stem = school_key(filename)
    key = school_key(school)
    if len(key) < 2:
        return False
    for match in re.finditer(re.escape(key), stem):
        rest = stem[match.end():]
        if not rest or rest[0] in '（([【・_-':
            return True
        if rest.startswith(('推薦', '選抜', '入試', '募集', '基準', '案内', '偏差値')):
            return True
    return False


def roots() -> list[Path]:
    lines = [line.strip() for line in CONFIG.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    if len(lines) != 7 or any(not line.startswith('\\\\TS3210\\benko\\') for line in lines):
        raise ValueError('資料の場所はNASの7行を指定してください。')
    return [Path(line) for line in lines]


def files(root: Path):
    if not root.is_dir():
        return []
    found = []
    for directory, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith('●作業用') and not d.startswith('過去資料')]
        for name in names:
            path = Path(directory) / name
            if path.suffix.lower() in SUFFIXES:
                found.append(path)
    return found


def display_label(path: Path, root: Path) -> str:
    return str(path.relative_to(root)).replace('\\', ' / ')


def source_pdf(path: Path, output: Path) -> Path:
    if path.suffix.lower() == '.pdf':
        return path
    image = Image.open(path)
    image.load()
    image = image.convert('RGB')
    image.save(output, 'PDF', resolution=180.0)
    return output


def selected_schools(all_roots: list[Path], names: list[str]):
    selected = []
    missing = []
    indexed = {source_id: files(all_roots[source_id]) for source_id in (3, 4, 5, 6)}
    for school in names:
        key = school_key(school)
        if len(key) < 2:
            missing.append(f'{school}：学校名を確認してください')
            continue
        found_for_school = []
        for source_id in (3, 4, 5, 6):
            candidates = indexed[source_id]
            matches = []
            for path in candidates:
                if not school_name_matches(path.stem, school):
                    continue
                matches.append(path)
            if source_id == 5 and matches:
                years = [(int(match[1]), path) for path in matches if (match := re.search(r'(20\d{2})年受験用', str(path)))]
                matches = [path for year, path in years if year == max(y for y, _ in years)] if years else []
            found_for_school.extend((source_id, path) for path in matches)
        if not found_for_school:
            missing.append(f'{school}：学校資料が見つかりません')
        selected.extend(found_for_school)
    return list(dict.fromkeys(selected)), missing


def hokushin(all_roots: list[Path], grade: str, name: str):
    target = norm(name)
    candidates = []
    for path in files(all_roots[1]):
        if path.suffix.lower() != '.pdf' or '個人成績表' not in str(path.parent):
            continue
        folder = path.parent.name
        if norm(grade) not in norm(folder):
            continue
        ocr = path.with_name(path.stem + '_ocr.txt')
        if not ocr.is_file():
            continue
        try:
            content = norm(ocr.read_text(encoding='utf-8-sig', errors='ignore'))
        except OSError:
            continue
        if target and target in content:
            match = re.search(r'(\d{2})月(\d{2})日', folder)
            rank = (int(match[1]), int(match[2])) if match else (0, 0)
            candidates.append((rank, path))
    candidates.sort(key=lambda item: item[0], reverse=True)
    if candidates and (len(candidates) == 1 or candidates[0][0] > candidates[1][0]):
        return candidates[0][1], None
    if candidates:
        return None, '北辰：同じ最新回に複数の候補があるため選べません'
    return None, '北辰：個人成績票を特定できません'


def vmogi(all_roots: list[Path], number: str, name: str, grade: str):
    root = all_roots[2]
    books = list(root.glob('*.xlsx'))
    books.sort(key=lambda p: int(re.search(r'(\d+)月号', p.name)[1]) if re.search(r'(\d+)月号', p.name) else 0, reverse=True)
    for book in books:
        wb = load_workbook(book, read_only=True, data_only=True)
        try:
            sheet = wb.active
            rows = sheet.iter_rows(values_only=True)
            headers = [str(value or '').strip() for value in next(rows)]
            index = {header: pos for pos, header in enumerate(headers)}
            if '氏名' not in index:
                continue
            matches = []
            for row in rows:
                if norm(row[index['氏名']]) != norm(name):
                    continue
                if '学年' in index and str(row[index['学年']] or '').strip() not in (grade[-1], f'中{grade[-1]}'):
                    continue
                if '登録番号' in index and number and str(row[index['登録番号']] or '').strip() == number:
                    return book, headers, row, None
                matches.append(row)
            if len(matches) == 1:
                return book, headers, matches[0], None
            if len(matches) > 1:
                return None, None, None, 'Vもぎ：同姓同名の候補が複数あります'
        finally:
            wb.close()
    return None, None, None, 'Vもぎ：成績を特定できません'


def vmogi_pdf(book: Path, headers: list[str], row: tuple, output: Path):
    pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
    data = [(headers[i], str(value)) for i, value in enumerate(row) if value is not None and headers[i]]
    c = canvas.Canvas(str(output), pagesize=A4)
    width, height = A4
    c.setFont('HeiseiKakuGo-W5', 16)
    c.drawString(38, height - 42, 'Vもぎ 個人成績')
    c.setFont('HeiseiKakuGo-W5', 9)
    c.drawString(38, height - 60, book.name)
    y = height - 82
    for label, value in data:
        if y < 42:
            c.showPage()
            c.setFont('HeiseiKakuGo-W5', 9)
            y = height - 42
        c.drawString(38, y, label[:22])
        c.drawString(190, y, value[:76])
        c.setStrokeColor(colors.lightgrey)
        c.line(38, y - 4, width - 38, y - 4)
        y -= 18
    c.save()


def guide_pdf(number: str, name: str, output: Path):
    script = ROOT / 'export-guide.ps1'
    master = GUIDE_CONFIG.read_text(encoding='utf-8-sig').strip()
    if not master.startswith('\\\\TS3210\\benko\\') or not master.lower().endswith('.xlsm'):
        raise ValueError('指導簿の場所を確認してください。')
    result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script),
                             '-StudentNumber', number, '-StudentName', name, '-MasterPath', master, '-OutputPath', str(output)],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode or not output.is_file():
        raise RuntimeError('指導簿の生徒照合またはPDF化に失敗しました')


def make_bundle(payload: dict):
    number = str(payload.get('number', ''))
    name = str(payload.get('name', '')).strip()
    grade = unicodedata.normalize('NFKC', str(payload.get('grade', '')))
    schools = payload.get('schools', [])
    if not re.fullmatch(r'\d{5,12}', number) or not name or len(name) > 80 or not re.fullmatch(r'(小[4-6]|中[1-3])', grade):
        raise ValueError('生徒情報を確認してください。')
    if not isinstance(schools, list) or len(schools) > 6 or any(not isinstance(s, str) or len(s) > 80 for s in schools):
        raise ValueError('志望校を確認してください。')
    all_roots = roots()
    folder = tempfile.TemporaryDirectory(prefix='bentan-materials-')
    base = Path(folder.name)
    items = []
    missing = []
    pdfs = []

    def add(label, source, sensitive=False):
        index = len(items)
        pdf = source_pdf(source, base / f'converted-{index}.pdf')
        PdfReader(str(pdf))  # Fail a damaged source before returning a successful bundle.
        pdfs.append(pdf)
        items.append({'label': label, 'source': str(source), 'staffOnly': sensitive})

    try:
        guide = base / 'guide.pdf'
        try:
            guide_pdf(number, name, guide)
            add('指導簿', guide)
        except Exception as exc:
            missing.append(str(exc))
        if grade == '中3':
            common = [p for p in files(all_roots[0]) if p.parent == all_roots[0] and p.suffix.lower() == '.pdf']
            for path in common:
                add('中3共通資料：' + path.name, path)
        school_files, school_missing = selected_schools(all_roots, schools)
        missing.extend(school_missing)
        for source_id, path in school_files:
            sensitive = source_id == 5
            label = f'{["", "", "", "高校案内", "選抜基準", "私立推薦基準", "北辰偏差値資料"][source_id]}：{path.name}'
            try:
                add(label, path, sensitive)
            except Exception:
                missing.append(label + '：PDF化できません')
        if grade in ('中2', '中3'):
            path, error = hokushin(all_roots, grade, name)
            if path:
                add('北辰：' + path.parent.name, path)
            elif error:
                missing.append(error)
            book, headers, row, error = vmogi(all_roots, number, name, grade)
            if book:
                target = base / 'vmogi.pdf'
                vmogi_pdf(book, headers, row, target)
                add('Vもぎ：' + book.name, target)
            elif error:
                missing.append(error)
        if not pdfs:
            raise RuntimeError('印刷できる資料が見つかりません')
        writer = PdfWriter()
        for pdf in pdfs:
            writer.append(str(pdf))
        combined = base / 'staff-bundle.pdf'
        with combined.open('wb') as stream:
            writer.write(stream)
        return folder, {'items': items, 'missing': missing, 'hasGuide': guide.is_file(), 'pages': len(writer.pages)}
    except Exception:
        folder.cleanup()
        raise


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', ORIGIN)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Vary', 'Origin')
        self.send_header('Cache-Control', 'no-store')

    def allowed(self):
        return self.headers.get('Origin') == ORIGIN and self.headers.get('Host') in (f'127.0.0.1:{PORT}', f'localhost:{PORT}')

    def reply(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        if not self.allowed():
            self.send_error(403)
            return
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.reply(200, {'ready': True, 'version': 1})
            return
        path, _, query = self.path.partition('?')
        match = re.fullmatch(r'/pdf/([a-f0-9]{32})/(staff-bundle|guide)\.pdf', path)
        if not match:
            self.send_error(404)
            return
        with LOCK:
            session = SESSIONS.get(match[1])
        if not session or session[0] < time.time():
            self.send_error(404)
            return
        path = Path(session[1].name) / (match[2] + '.pdf')
        if not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.cors()
        self.send_header('Content-Type', 'application/pdf')
        disposition = 'attachment' if query == 'download=1' else 'inline'
        self.send_header('Content-Disposition', f'{disposition}; filename="{match[2]}.pdf"')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != '/generate' or not self.allowed() or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.send_error(403)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 1 or length > 4096:
                raise ValueError('入力が大きすぎます')
            payload = json.loads(self.rfile.read(length))
            folder, manifest = make_bundle(payload)
            token = uuid.uuid4().hex
            with LOCK:
                expired = [key for key, value in SESSIONS.items() if value[0] < time.time()]
                for key in expired:
                    SESSIONS.pop(key)[1].cleanup()
                SESSIONS[token] = (time.time() + 900, folder, manifest)
            self.reply(200, {**manifest, 'combinedUrl': f'/pdf/{token}/staff-bundle.pdf',
                             'guideUrl': f'/pdf/{token}/guide.pdf' if manifest['hasGuide'] else None})
        except Exception as exc:
            self.reply(422, {'error': str(exc)[:200]})

    def log_message(self, format, *args):
        pass  # Do not log student names or paths.


if __name__ == '__main__':
    def cleanup_sessions():
        while True:
            time.sleep(60)
            with LOCK:
                expired = [key for key, value in SESSIONS.items() if value[0] < time.time()]
                for key in expired:
                    SESSIONS.pop(key)[1].cleanup()
    threading.Thread(target=cleanup_sessions, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
