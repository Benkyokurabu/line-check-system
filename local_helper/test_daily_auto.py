import json
import tempfile
import unittest
import threading
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfWriter

from daily_auto import DailyFolder, fingerprint, safe_json


class DailyFolderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.share = self.base / '98面談資料'
        self.share.mkdir()
        self.bundle = self.base / 'bundle'
        self.bundle.mkdir()
        for name in ('staff-bundle.pdf', 'material-0.pdf'):
            writer = PdfWriter()
            writer.add_blank_page(width=595, height=842)
            with (self.bundle / name).open('wb') as stream:
                writer.write(stream)
        self.manifest = {'items': [{'label': '指導簿'}], 'hasGuide': True, 'pages': 1, 'missing': []}
        self.context = {'studentNumber': '2018998', 'capturedAt': '2030-01-01T00:00:00Z', 'records': [
            {'date': '2029-12-01', 'title': '前回面談', 'url': 'https://www.notion.so/test', 'body': '確認内容'}],
            'info': [{'source': '生徒情報', 'value': '保護者の希望'}], 'summary': {'status': 'empty', 'items': []}, 'source': 'notion'}
        self.prepared = {'sourceHash': 'server-hash', 'template': (Path(__file__).parent.parent / 'public/interview-material-offline-template.html').read_text(encoding='utf-8'),
                         'context': self.context, 'payload': {'number': '2018998', 'name': '確認用 生徒', 'grade': '小6', 'schools': []},
                         'folderParts': ['確認用先生', '2030小６秋の教育相談会', '2030.01.02 21：30- 確認用 生徒'],
                         'appointment': {'id': 'appointment', 'number': '2018998', 'name': '確認用 生徒', 'grade': '小6', 'teacher': '確認用',
                                         'teacherId': 'teacher', 'date': '2030-01-02', 'start': '21:30', 'editedAt': '2030-01-01', 'source': 'notion-bensuke'}}

    def folder(self):
        return DailyFolder(self.prepared, self.share)

    def test_offline_html_and_all_originals_are_published_as_one_version(self):
        folder = self.folder()
        calls = []
        result = folder.publish(self.bundle, self.manifest, 'a' * 64, lambda: calls.append('verified'))
        self.assertEqual(result, str(folder.folder))
        self.assertEqual(calls, ['verified'])
        self.assertTrue(folder.unchanged('a' * 64))
        text = (folder.folder / '面談資料.html').read_text(encoding='utf-8')
        self.assertIn('<base href="_auto_versions/', text)
        self.assertNotIn('__CONTEXT_JSON__', text)
        self.assertIn('確認内容', text)
        self.assertIn('保護者の希望', text)

    def test_update_uses_same_folder_and_preserves_previous_version_and_teacher_files(self):
        first = self.folder()
        first.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
        previous = {p: p.read_bytes() for p in (first.folder / '_auto_versions').rglob('*') if p.is_file()}
        teacher_file = first.folder / '先生のメモ.txt'
        teacher_file.write_text('保存すること', encoding='utf-8')
        second = self.folder()
        self.assertEqual(first.folder, second.folder)
        second.publish(self.bundle, self.manifest, 'b' * 64, lambda: None)
        self.assertTrue(second.unchanged('b' * 64))
        self.assertEqual(teacher_file.read_text(encoding='utf-8'), '保存すること')
        self.assertTrue(all(p.read_bytes() == content for p, content in previous.items()))

    def test_failure_before_switch_keeps_old_html_and_version_usable(self):
        first = self.folder()
        first.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
        old = (first.folder / '面談資料.html').read_bytes()
        def changed():
            raise RuntimeError('予定変更')
        with self.assertRaisesRegex(RuntimeError, '予定変更'):
            self.folder().publish(self.bundle, self.manifest, 'b' * 64, changed)
        self.assertEqual((first.folder / '面談資料.html').read_bytes(), old)
        self.assertTrue(first.unchanged('a' * 64))

    def test_incomplete_pdf_is_never_published(self):
        folder = self.folder()
        folder.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
        old = (folder.folder / '面談資料.html').read_bytes()
        (self.bundle / 'material-0.pdf').write_text('not PDF')
        with self.assertRaisesRegex(RuntimeError, 'PDF'):
            self.folder().publish(self.bundle, self.manifest, 'b' * 64, lambda: None)
        self.assertEqual((folder.folder / '面談資料.html').read_bytes(), old)

    def test_teacher_html_edits_and_concurrent_publication_are_held(self):
        first = self.folder()
        first.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
        stale = self.folder()
        self.folder().publish(self.bundle, self.manifest, 'b' * 64, lambda: None)
        with self.assertRaisesRegex(RuntimeError, '処理中に変更'):
            stale.publish(self.bundle, self.manifest, 'c' * 64, lambda: None)
        self.assertTrue(self.folder().unchanged('b' * 64))
        target = first.folder / '面談資料.html'
        target.write_text(target.read_text(encoding='utf-8') + '\n先生の編集', encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, '編集'):
            self.folder()

    def test_actual_concurrent_switch_allows_only_one_publication(self):
        first = self.folder()
        first.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
        writers = [self.folder(), self.folder()]
        locked, release = threading.Event(), threading.Event()
        errors = []
        def authorize():
            locked.set()
            if not release.wait(10):
                raise RuntimeError('test timed out')
        def publish_first():
            try:
                writers[0].publish(self.bundle, self.manifest, 'b' * 64, authorize)
            except Exception as error:
                errors.append(error)
        thread = threading.Thread(target=publish_first)
        thread.start()
        try:
            self.assertTrue(locked.wait(10))
            with self.assertRaisesRegex(RuntimeError, '保存処理中'):
                writers[1].publish(self.bundle, self.manifest, 'c' * 64, lambda: None)
        finally:
            release.set()
            thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(self.folder().unchanged('b' * 64))
        with self.assertRaisesRegex(RuntimeError, '処理中に変更'):
            writers[1].publish(self.bundle, self.manifest, 'c' * 64, lambda: None)
        self.folder().publish(self.bundle, self.manifest, 'c' * 64, lambda: None)
        self.assertTrue(self.folder().unchanged('c' * 64))

    def browser_saved_folder(self):
        folder = self.folder().folder
        folder.mkdir(parents=True)
        saved = {'studentNumber': '2018998', 'saveId': 'browser-save-id', 'sourceHash': '', 'context': self.context,
                 'showPastSchools': False, 'appointment': self.prepared['appointment']}
        text = self.prepared['template'].replace('__ITEMS_JSON__', safe_json([{'label': '指導簿', 'kind': '指導簿'}]))
        text = text.replace('__STUDENT_NAME_JSON__', safe_json('確認用 生徒')).replace('__CONTEXT_JSON__', safe_json({**self.context, 'showPastSchools': False}))
        (folder / '面談資料.html').write_text(text, encoding='utf-8')
        (folder / '保存情報.json').write_text(safe_json(saved), encoding='utf-8')
        for name in ('staff-bundle.pdf', 'material-0.pdf'):
            (folder / name).write_bytes((self.bundle / name).read_bytes())
        for name in ('面談記録.txt', '生徒情報・注意点.txt', '資料一覧.txt', 'AI要約.js'):
            (folder / name).write_text('original ' + name, encoding='utf-8')
        return folder

    def test_identity_checked_browser_folder_is_updated_in_place_and_backed_up(self):
        old = self.browser_saved_folder()
        original_html = (old / '面談資料.html').read_bytes()
        folder = self.folder()
        self.assertEqual(folder.folder, old)
        folder.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
        self.assertTrue(folder.unchanged('a' * 64))
        backups = list((old / '_auto_versions').glob('保存済み_*/面談資料.html'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), original_html)

    def test_browser_folder_wrong_identity_or_edited_html_is_not_overwritten(self):
        old = self.browser_saved_folder()
        file = old / '保存情報.json'
        saved = json.loads(file.read_text(encoding='utf-8'))
        saved['studentNumber'] = '9999999'
        file.write_text(safe_json(saved), encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, '保留'):
            self.folder()
        saved['studentNumber'] = '2018998'
        file.write_text(safe_json(saved), encoding='utf-8')
        target = old / '面談資料.html'
        target.write_text(target.read_text(encoding='utf-8').replace('保存した資料', '先生が編集'), encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, '保留'):
            self.folder()

    def test_unavailable_share_and_path_traversal_are_rejected(self):
        with self.assertRaisesRegex(RuntimeError, '接続'):
            DailyFolder(self.prepared, self.base / 'missing')
        with self.assertRaises(ValueError):
            DailyFolder({**self.prepared, 'folderParts': ['..', 'grade', 'student']}, self.share)

    def test_fingerprint_changes_for_source_files_and_optional_ai(self):
        root = self.base / 'helper'
        root.mkdir()
        guide = self.base / 'guide.xlsm'
        guide.write_text('guide')
        (root / 'guide-path.txt').write_text(str(guide), encoding='utf-8')
        (root / 'export-guide.ps1').write_text('export')
        (root / 'sources.txt').write_text('sources')
        preview = {'materials': [{'id': 'guide'}]}
        first = fingerprint(self.prepared, preview, root)
        self.assertEqual(first, fingerprint(self.prepared, preview, root))
        guide.write_text('updated guide')
        self.assertNotEqual(first, fingerprint(self.prepared, preview, root))
        second = fingerprint(self.prepared, preview, root)
        self.prepared['context']['summary'] = {'status': 'completed', 'items': [{'note': '要確認', 'source': '原本'}]}
        self.assertNotEqual(second, fingerprint(self.prepared, preview, root))


if __name__ == '__main__':
    unittest.main()
