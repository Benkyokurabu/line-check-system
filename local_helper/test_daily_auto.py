import json
import re
import tempfile
import unittest
import threading
from pathlib import Path
from urllib.parse import quote, urljoin
from unittest.mock import Mock, patch

from pypdf import PdfWriter

from daily_auto import DailyFolder, fingerprint, make_html_visible, safe_json


class HtmlVisibilityTests(unittest.TestCase):
    def visibility_api(self, attributes, success=True):
        kernel = Mock()
        kernel.GetFileAttributesW.side_effect = attributes
        kernel.SetFileAttributesW.return_value = success
        return kernel

    def test_hidden_is_removed_without_changing_other_attributes(self):
        kernel = self.visibility_api([0x27, 0x25])
        with patch('daily_auto.os.name', 'nt'), patch('ctypes.WinDLL', return_value=kernel, create=True):
            make_html_visible('offline.html')
        kernel.SetFileAttributesW.assert_called_once_with('offline.html', 0x25)

    def test_visible_file_needs_no_attribute_write(self):
        kernel = self.visibility_api([0x20])
        with patch('daily_auto.os.name', 'nt'), patch('ctypes.WinDLL', return_value=kernel, create=True):
            make_html_visible('offline.html')
        kernel.SetFileAttributesW.assert_not_called()

    def test_hidden_only_uses_normal_and_verifies_change(self):
        kernel = self.visibility_api([0x2, 0x80])
        with patch('daily_auto.os.name', 'nt'), patch('ctypes.WinDLL', return_value=kernel, create=True):
            make_html_visible('offline.html')
        kernel.SetFileAttributesW.assert_called_once_with('offline.html', 0x80)

    def test_failed_attribute_write_is_reported(self):
        kernel = self.visibility_api([0x22], success=False)
        with patch('daily_auto.os.name', 'nt'), patch('ctypes.WinDLL', return_value=kernel, create=True), \
                patch('ctypes.get_last_error', return_value=5, create=True), \
                patch('ctypes.WinError', return_value=OSError('attribute denied'), create=True):
            with self.assertRaisesRegex(OSError, 'attribute denied'):
                make_html_visible('offline.html')

    def test_nas_ignoring_attribute_change_is_reported(self):
        kernel = self.visibility_api([0x22, 0x22])
        with patch('daily_auto.os.name', 'nt'), patch('ctypes.WinDLL', return_value=kernel, create=True):
            with self.assertRaisesRegex(RuntimeError, '表示'):
                make_html_visible('offline.html')


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
                         'folderParts': ['確認用先生', '2030.01.02.2130-小６確認用生徒'],
                         'appointment': {'id': 'appointment', 'number': '2018998', 'name': '確認用 生徒', 'grade': '小6', 'teacher': '確認用',
                                         'teacherId': 'teacher', 'date': '2030-01-02', 'start': '21:30', 'editedAt': '2030-01-01', 'source': 'notion-bensuke'}}

    def folder(self):
        return DailyFolder(self.prepared, self.share)

    def test_old_three_part_folder_is_still_readable_during_migration(self):
        old = ['確認用先生', '2030小６秋の教育相談会', '2030.01.02 21：30- 確認用 生徒']
        self.assertEqual(DailyFolder({**self.prepared, 'folderParts': old}, self.share).folder,
                         self.share.joinpath(*old))

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

    def test_all_hokushin_link_resolves_from_version_base_for_both_folder_depths(self):
        target = self.share.parent / '07 中３秋冬面談資料' / '北辰基礎資料' / '北辰基礎資料.html'
        target.parent.mkdir(parents=True)
        target.write_text('<title>北辰基礎資料</title>', encoding='utf-8')
        for parts in (
            ['確認用先生', '2030.01.02.2130-架空確認用生徒'],
            ['確認用先生', '2030年秋の教育相談', '2030.01.02 21：30- 架空確認用生徒'],
        ):
            with self.subTest(parts=parts):
                self.prepared['folderParts'] = parts
                folder = self.folder()
                folder.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
                entry = folder.folder / '面談資料.html'
                html = entry.read_text(encoding='utf-8')
                base = re.search(r'<base href="([^"]+)">', html)[1]
                link = re.search(r'<a[^>]*id="all-hokushin"[^>]*href="([^"]+)"', html)[1]
                self.assertEqual(link.count('../'), len(parts) + 3)
                self.assertTrue(link.endswith('.html'))
                self.assertIn('%E5%8C%97', link)
                self.assertEqual(urljoin(urljoin(entry.as_uri(), base), link), target.as_uri())
                nas_parent = 'file://ts3210/benko/' + quote('03 教務部/015 各面談行事／文化会館も含む', safe='/')
                nas_entry = nas_parent + '/' + quote('98面談資料/' + '/'.join(parts) + '/面談資料.html', safe='/')
                nas_target = nas_parent + '/' + quote('07 中３秋冬面談資料/北辰基礎資料/北辰基礎資料.html', safe='/')
                self.assertEqual(urljoin(urljoin(nas_entry, base), link), nas_target)
                self.assertTrue(folder.unchanged('a' * 64))

    def test_browser_template_keeps_direct_link_without_base(self):
        template = self.prepared['template']
        self.assertNotIn('<base ', template)
        link = re.search(r'<a[^>]*id="all-hokushin"[^>]*href="([^"]+)"', template)[1]
        self.assertTrue(link.startswith('file://ts3210/'))
        self.assertTrue(link.endswith('.html'))

    def test_missing_all_hokushin_link_stops_before_publication(self):
        self.prepared['template'] = self.prepared['template'].replace('id="all-hokushin"', 'id="missing-all-hokushin"')
        folder = self.folder()
        with self.assertRaisesRegex(RuntimeError, '北辰基礎資料へのリンク'):
            folder.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
        self.assertFalse((folder.folder / '面談資料.html').exists())

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

    def test_html_visibility_is_checked_before_and_after_publication(self):
        folder = self.folder()
        paths = []
        def visible(path):
            self.assertTrue(path.is_file())
            paths.append(path)
        with patch('daily_auto.make_html_visible', side_effect=visible):
            folder.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
        self.assertEqual(len(paths), 2)
        self.assertTrue(paths[0].name.startswith('_面談資料_'))
        self.assertEqual(paths[1], folder.folder / '面談資料.html')

    def test_visibility_failure_before_switch_preserves_old_html(self):
        first = self.folder()
        first.publish(self.bundle, self.manifest, 'a' * 64, lambda: None)
        old = (first.folder / '面談資料.html').read_bytes()
        with patch('daily_auto.make_html_visible', side_effect=OSError('attribute denied')):
            with self.assertRaisesRegex(OSError, 'attribute denied'):
                self.folder().publish(self.bundle, self.manifest, 'b' * 64, lambda: None)
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
