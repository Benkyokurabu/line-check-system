"""Publish immutable versions, switching only the offline HTML after full validation."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from contextlib import contextmanager
from pathlib import Path

SHARE_ROOT = Path(r'\\TS3210\benko\03 教務部\015 各面談行事／文化会館も含む\98面談資料')
OWNER = 'bentan-daily-materials-v1'


def make_html_visible(path):
    """Remove only Windows Hidden; SMB can retain it after renaming a dot file."""
    if os.name != 'nt':
        return
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    get_attributes = kernel32.GetFileAttributesW
    get_attributes.argtypes = [wintypes.LPCWSTR]
    get_attributes.restype = wintypes.DWORD
    set_attributes = kernel32.SetFileAttributesW
    set_attributes.argtypes = [wintypes.LPCWSTR, wintypes.DWORD]
    set_attributes.restype = wintypes.BOOL
    name = str(path)
    attributes = get_attributes(name)
    if attributes == 0xffffffff:
        raise ctypes.WinError(ctypes.get_last_error())
    if attributes & 0x2:
        # FILE_ATTRIBUTE_NORMAL is needed if Hidden was the only attribute.
        if not set_attributes(name, (attributes & ~0x2) or 0x80):
            raise ctypes.WinError(ctypes.get_last_error())
        attributes = get_attributes(name)
        if attributes == 0xffffffff:
            raise ctypes.WinError(ctypes.get_last_error())
        if attributes & 0x2:
            raise RuntimeError('共有フォルダの面談資料を表示できる状態にできません。')


def safe_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')


def fingerprint(prepared, preview, helper_root):
    guide = Path((helper_root / 'guide-path.txt').read_text(encoding='utf-8-sig').strip())
    stat = guide.stat()
    local_sources = [[str(guide).casefold(), stat.st_size, stat.st_mtime_ns]]
    for source in (helper_root / 'export-guide.ps1', helper_root / 'sources.txt'):
        local_sources.append([source.name, digest(source)])
    contents = {'sourceHash': prepared['sourceHash'], 'summary': prepared['context']['summary'], 'preview': preview, 'localSources': local_sources,
                'template': hashlib.sha256(prepared['template'].encode('utf-8')).hexdigest()}
    return hashlib.sha256(safe_json(contents).encode('utf-8')).hexdigest()


def dock_kind(item):
    label, source = item['label'], item.get('source', '')
    for pattern, kind in [('アンケート', 'アンケート'), ('指導簿', '指導簿')]:
        if pattern in label:
            return kind
    for pattern, kind in [(r'晶文社|高校受験案内|高校別スキャンデータ', '晶文社'),
                          (r'北辰基礎資料|北辰偏差値', '北辰基礎資料'), (r'北辰併願状況', '併願校'),
                          (r'高校入試選抜基準', '実施内容')]:
        if re.search(pattern, source):
            return kind
    for pattern, kind in [(r'晶文社|高校案内', '晶文社'), (r'実施内容|選抜基準|推薦基準', '実施内容'),
                          (r'併願校|併願状況', '併願校'), (r'北辰基礎資料|北辰偏差値資料', '北辰基礎資料'),
                          ('北辰', '北辰成績'), ('成績通知', '塾内成績'), ('志望校', '志望校'), ('Vもぎ', 'Vもぎ')]:
        if re.search(pattern, label):
            return kind
    return '資料'


def records_text(context):
    rows = ['Notionの直近3回の面談記録（取得時点）', '取得日時：' + context.get('capturedAt', '')]
    for record in context['records']:
        rows.append(f"{record.get('date', '日付なし')}　{record['title']}\n方法：{record.get('method') or '記載なし'} ／ 目的：{record.get('purpose') or '記載なし'}\n原本：{record['url']}\n\n{record.get('body') or '本文なし'}"
                    + ('\n\n添付ファイル：' + '、'.join(record['attachments']) + '（原本から確認）' if record.get('attachments') else ''))
    return '\n\n━━━━━━━━━━━━━━━━\n\n'.join(rows)


def information_text(context):
    summary = context['summary']
    notes = [f"・{item['note']}\n  出典：{item['source']}" for item in summary.get('items', [])] if summary['status'] == 'completed' else ['AIによる注意点の抽出は保存時点で完了していません。面談記録と生徒情報の原文を確認してください。']
    return '\n\n'.join(['面談前に確認したい点（AI）', *(notes or ['特記する項目なし']), '', '生徒情報DBの原文',
                         *(f"{item['source']}\n{item['value']}" for item in context['info'])])


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


@contextmanager
def publication_lock(folder):
    # An OS byte-range lock is shared across processes/PCs over SMB and released on exit.
    # Keep the lock file; deleting it would allow another process to lock a different file.
    with (folder / '.bentan-publication.lock').open('a+b', buffering=0) as stream:
        if stream.seek(0, os.SEEK_END) == 0:
            stream.write(b'0')
        stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise RuntimeError('同じ面談資料を保存処理中です。以前の資料は保持し、後で再試行します。') from None
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class DailyFolder:
    def __init__(self, prepared, share_root=SHARE_ROOT):
        self.prepared = prepared
        parts = prepared['folderParts']
        if len(parts) not in (2, 3) or any(not part or part in ('.', '..') or re.search(r'[<>:"/\\|?*\x00-\x1f]', part) for part in parts):
            raise ValueError('面談資料の保存先を確認できません。')
        if not share_root.is_dir():
            raise RuntimeError('共有フォルダ「98面談資料」に接続できません。以前の資料は保持しています。')
        self.folder = share_root.joinpath(*parts)
        self.legacy_files = []
        # Reuse the canonical appointment folder, while requiring proof of ownership and identity.
        existing = self.folder / '面談資料.html'
        self.initial_html_hash = digest(existing) if existing.is_file() else None
        if existing.is_file() and f'name="bentan-owner" content="{OWNER}"' in existing.read_text(encoding='utf-8'):
            try:
                text = existing.read_text(encoding='utf-8')
                previous_id = re.search(r'<meta name="bentan-version" content="([a-f0-9]{32})">', text).group(1)
                previous = self.folder / '_auto_versions' / previous_id
                saved = json.loads((previous / '自動保存情報.json').read_text(encoding='utf-8'))
                if saved['htmlHash'] != self.initial_html_hash or any(saved['appointment'][key] != prepared['appointment'][key] for key in
                    ('id', 'number', 'name', 'grade', 'teacher', 'teacherId', 'date', 'start', 'source')):
                    raise ValueError('edited or identity mismatch')
                if any(digest(previous / name) != value for name, value in saved['files'].items()):
                    raise ValueError('generated files were edited')
            except (OSError, ValueError, KeyError, AttributeError):
                raise RuntimeError('保存済みの自動作成資料が編集されたか、本人を確認できません。自動上書きを保留しました。')
        if existing.is_file() and f'name="bentan-owner" content="{OWNER}"' not in existing.read_text(encoding='utf-8'):
            try:
                saved = json.loads((self.folder / '保存情報.json').read_text(encoding='utf-8'))
                expected = prepared['appointment']
                if saved['studentNumber'] != expected['number'] or any(saved['appointment'][key] != expected[key] for key in
                    ('id', 'number', 'name', 'grade', 'teacher', 'teacherId', 'date', 'start', 'editedAt', 'source')):
                    raise ValueError('identity mismatch')
                text = existing.read_text(encoding='utf-8')
                decoder = json.JSONDecoder()
                material_items, _ = decoder.raw_decode(text[text.index('const items=') + len('const items='):])
                context = {**saved['context'], 'showPastSchools': saved['showPastSchools']}
                original = prepared['template'].replace('__ITEMS_JSON__', safe_json(material_items))
                original = original.replace('__STUDENT_NAME_JSON__', safe_json(expected['name'])).replace('__CONTEXT_JSON__', safe_json(context))
                if text != original:
                    raise ValueError('HTML was edited or created from an unknown template')
                generated = ['面談資料.html', 'staff-bundle.pdf', *(f'material-{index}.pdf' for index in range(len(material_items))),
                             '面談記録.txt', '生徒情報・注意点.txt', '資料一覧.txt', '保存情報.json', 'AI要約.js']
                self.legacy_files = [(self.folder / name, digest(self.folder / name)) for name in generated]
            except (OSError, ValueError, KeyError, TypeError):
                raise RuntimeError('保存済みフォルダの本人・面談予定を確認できないか、画面が編集されています。自動上書きを保留しました。')

    def unchanged(self, input_hash):
        entry = self.folder / '面談資料.html'
        if not entry.is_file():
            return False
        text = entry.read_text(encoding='utf-8')
        found = re.search(r'<meta name="bentan-version" content="([a-f0-9]{32})">', text)
        if not found or f'<meta name="bentan-input" content="{input_hash}">' not in text:
            return False
        version = self.folder / '_auto_versions' / found[1]
        try:
            saved = json.loads((version / '自動保存情報.json').read_text(encoding='utf-8'))
            return saved['owner'] == OWNER and saved['inputHash'] == input_hash and saved['htmlHash'] == hashlib.sha256(text.encode('utf-8')).hexdigest() and all(
                (version / name).is_file() and digest(version / name) == value for name, value in saved['files'].items())
        except (OSError, ValueError, KeyError):
            return False

    def publish(self, bundle, manifest, input_hash, authorize):
        if not manifest.get('items') or not manifest.get('hasGuide'):
            raise RuntimeError('本人の指導簿を含む資料一式がそろっていません。以前の資料は保持しています。')
        template = self.prepared['template']
        if any(template.count(key) != 1 for key in ('__ITEMS_JSON__', '__STUDENT_NAME_JSON__', '__CONTEXT_JSON__')):
            raise RuntimeError('面談資料のHTML原本を確認できません。')
        save_id = uuid.uuid4().hex
        context = {**self.prepared['context'], 'showPastSchools': self.prepared['payload']['grade'] == '中2' and not self.prepared['payload']['schools']}
        rendered = template.replace('__ITEMS_JSON__', safe_json([{'label': item['label'], 'kind': dock_kind(item)} for item in manifest['items']]))
        rendered = rendered.replace('__STUDENT_NAME_JSON__', safe_json(self.prepared['payload']['name'])).replace('__CONTEXT_JSON__', safe_json(context))
        metadata = f'<base href="_auto_versions/{save_id}/"><meta name="bentan-owner" content="{OWNER}"><meta name="bentan-version" content="{save_id}"><meta name="bentan-input" content="{input_hash}">'
        if '<head>' not in rendered:
            raise RuntimeError('面談資料のHTML原本を確認できません。')
        rendered = rendered.replace('<head>', '<head>' + metadata, 1)
        version = self.folder / '_auto_versions' / save_id
        version.mkdir(parents=True, exist_ok=False)
        if self.legacy_files:
            old_version = self.folder / '_auto_versions' / ('保存済み_' + save_id)
            old_version.mkdir(exist_ok=False)
            for original, original_hash in self.legacy_files:
                if digest(original) != original_hash:
                    raise RuntimeError('保存済みの資料が編集中です。以前の資料は保持しています。')
                shutil.copyfile(original, old_version / original.name)
                if digest(old_version / original.name) != original_hash:
                    raise RuntimeError('保存済みの資料を保全できません。以前の資料は保持しています。')
        copies = ['staff-bundle.pdf', *(f'material-{index}.pdf' for index in range(len(manifest['items']))) ]
        for name in copies:
            source = bundle / name
            if source.read_bytes()[:5] != b'%PDF-':
                raise RuntimeError('PDFの内容を確認できません。以前の資料は保持しています。')
            shutil.copyfile(source, version / name)
            if digest(source) != digest(version / name):
                raise RuntimeError('共有フォルダへ資料を完全に保存できません。以前の資料は保持しています。')
        texts = {'面談記録.txt': records_text(context), '生徒情報・注意点.txt': information_text(context),
                 '資料一覧.txt': '\n'.join(['面談資料.html：生徒フォルダの表紙を開く（ネット接続不要）', 'staff-bundle.pdf：印刷用の一式PDF',
                                             *(f"material-{index}.pdf：{item['label']}" for index, item in enumerate(manifest['items']))]),
                 '保存情報.json': safe_json({'studentNumber': self.prepared['payload']['number'], 'saveId': save_id,
                                            'sourceHash': context['summary'].get('sourceHash', ''), 'context': context,
                                            'showPastSchools': context['showPastSchools'], 'appointment': self.prepared['appointment']}),
                 'AI要約.js': 'window.__INTERVIEW_AI_SNAPSHOT__ = ' + safe_json({'saveId': save_id, 'sourceHash': context['summary'].get('sourceHash', ''), 'summary': context['summary']}) + ';'}
        for name, text in texts.items():
            (version / name).write_text(text, encoding='utf-8', newline='')
            if (version / name).read_text(encoding='utf-8') != text:
                raise RuntimeError('共有フォルダへ資料を完全に保存できません。以前の資料は保持しています。')
        saved = {'owner': OWNER, 'inputHash': input_hash, 'htmlHash': hashlib.sha256(rendered.encode('utf-8')).hexdigest(),
                 'files': {name: digest(version / name) for name in [*copies, *texts]}, 'appointment': self.prepared['appointment'],
                 'missing': manifest.get('missing', [])}
        (version / '自動保存情報.json').write_text(safe_json(saved), encoding='utf-8', newline='')
        temporary = self.folder / f'_面談資料_{save_id}.html'
        temporary.write_text(rendered, encoding='utf-8', newline='')
        if temporary.read_text(encoding='utf-8') != rendered:
            raise RuntimeError('共有フォルダへ画面を完全に保存できません。以前の資料は保持しています。')
        make_html_visible(temporary)
        # The previous entry point is untouched until originals, schedule, sources and lease are rechecked.
        with publication_lock(self.folder):
            authorize()
            current_html = self.folder / '面談資料.html'
            if (digest(current_html) if current_html.is_file() else None) != self.initial_html_hash or any(
                    digest(original) != original_hash for original, original_hash in self.legacy_files):
                raise RuntimeError('保存済みの資料が処理中に変更されました。自動上書きを保留しました。')
            os.replace(temporary, self.folder / '面談資料.html')
            make_html_visible(current_html)
            if not self.unchanged(input_hash):
                raise RuntimeError('保存後の資料確認に失敗しました。')
        return str(self.folder)
