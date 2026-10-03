"""Prepare the shared Hokushin school library without changing any NAS originals.

Run with --source pointing at a yearly school baseline directory, and --output
pointing at a local staging directory. Upload catalog.json only after all PDFs.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from reportlab.pdfgen import canvas

YEAR_FOLDER = re.compile(r'(20\d{2})年★高校別【北辰偏差値】基礎資料')


def school_name(stem: str) -> str:
    # The first hiragana is an alphabetic filing prefix in the prepared NAS data.
    name = re.sub(r'^[ぁ-ん]', '', stem).strip()
    return '叡明' if name in ('えいめい', 'えいめい高校') else name


def school_identity(name: str) -> str:
    """Match the verified NAS naming changes without mixing municipal/prefectural schools."""
    name = unicodedata.normalize('NFKC', name).replace(' ', '').replace('　', '')
    name = name.replace('所座商業', '所沢商業').replace('岩槻(国際文化)', '岩槻(国際教養)')
    name = name.replace('和光国際(外国語)', '和光国際(国際)').replace('県立大宮中央', '大宮中央')
    prefix = re.fullmatch(r'(県立|市立)([^()]+)(?:\(([^()]+)\))?', name)
    if prefix:
        kind, school, course = prefix.groups()
        name = f'{school}({kind}{"・" + course if course else ""})'
    return name


def catalog_sources(configured: Path) -> list[dict]:
    years = sorted(((int(match[1]), folder) for folder in configured.parent.iterdir()
                    if folder.is_dir() and (match := YEAR_FOLDER.fullmatch(folder.name))), reverse=True)
    if not years:
        raise ValueError('北辰基礎資料の年度フォルダが見つかりません。')
    selected = {}
    for year, folder in years:
        for path in sorted(folder.rglob('*')):
            relative = path.relative_to(folder)
            if any(part.startswith(('●作業用', '過去資料')) for part in relative.parts):
                continue
            if not path.is_file() or path.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.pdf'):
                continue
            school = school_name(path.stem)
            category = '公立' if any('公立' in part for part in relative.parts[:-1]) else '私立' if any('私立' in part for part in relative.parts[:-1]) else 'その他'
            identity = category + ':' + school_identity(school)
            # Keep every course, but use a newer year for the same school/course.
            selected.setdefault(identity, {'school': school, 'reading': path.stem, 'category': category,
                                          'year': year, 'source': path})
    return sorted(selected.values(), key=lambda item: (item['category'], item['reading']))


def build_library(configured: Path, output: Path) -> dict:
    sources = catalog_sources(configured)
    if not sources:
        raise ValueError('学校別の北辰基礎資料がありません。')
    pdf_directory = output / 'pdf'
    pdf_directory.mkdir(parents=True, exist_ok=True)

    def convert(item):
        source = item['source']
        if source.suffix.lower() == '.pdf':
            data = source.read_bytes()
        else:
            # Preserve the source resolution; JPEG compression reduces offline download size.
            with Image.open(source) as original:
                image = original.convert('RGB')
                jpeg = output / (hashlib.sha256(str(source).encode('utf-8')).hexdigest() + '.jpg')
                image.save(jpeg, format='JPEG', quality=88, optimize=True)
                width, height = image.size
                image.close()
                width, height = width * 72 / 180, height * 72 / 180
                document = io.BytesIO()
                pdf = canvas.Canvas(document, pagesize=(width, height), invariant=1, pageCompression=1)
                pdf.setTitle(f'{item["school"]} {item["category"]} {item["year"]}')
                # A JPEG filename lets ReportLab embed the compressed bytes directly.
                # ImageReader unnecessarily expands every high-resolution page to RGB.
                pdf.drawImage(str(jpeg), 0, 0, width=width, height=height)
                pdf.showPage()
                pdf.save()
                data = document.getvalue()
                jpeg.unlink()
        if not data.startswith(b'%PDF-') or not 0 < len(data) <= 52_428_800:
            raise ValueError(f'{item["school"]}をPDF化できませんでした。')
        digest = hashlib.sha256(data).hexdigest()
        destination = pdf_directory / f'{digest}.pdf'
        destination.write_bytes(data)
        return {**{key: value for key, value in item.items() if key != 'source'}, 'id': digest,
                'storagePath': f'hokushin-library/pdf/{digest}.pdf', 'bytes': len(data)}

    with ThreadPoolExecutor(max_workers=1) as pool:
        items = list(pool.map(convert, sources))
    if len({item['id'] for item in items}) != len(items):
        raise ValueError('同一のPDFに複数の学校名があります。学校別の資料を確認してください。')
    catalog = {'version': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(), 'items': items}
    (output / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False), encoding='utf-8')
    return catalog


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    arguments = parser.parse_args()
    result = build_library(Path(arguments.source), Path(arguments.output))
    print(json.dumps({'count': len(result['items']), 'bytes': sum(item['bytes'] for item in result['items']),
                      'years': sorted(set(item['year'] for item in result['items']))}))
