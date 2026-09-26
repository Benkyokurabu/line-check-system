import tempfile
import threading
import time
import unittest
import json
from unittest.mock import patch
from pathlib import Path
from subprocess import CompletedProcess
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import helper
from helper import hokushin, save_bundle_to_onedrive, school_name_matches, selected_schools, sync_bundle_to_cloud


class MaterialSelectionTests(unittest.TestCase):
    def test_saves_only_requested_bundle_to_shared_folder_without_overwriting(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict('os.environ', {'OneDrive': folder}):
            source = Path(folder) / 'generated.pdf'
            source.write_bytes(b'%PDF-1.4 test bundle')
            first = save_bundle_to_onedrive(source, '2018999')
            second = save_bundle_to_onedrive(source, '2018999')
            self.assertEqual(first.parent, Path(folder) / '面談準備' / '保存済み資料')
            self.assertNotEqual(first, second)
            self.assertEqual(first.read_bytes(), source.read_bytes())
            self.assertEqual(second.read_bytes(), source.read_bytes())
            self.assertFalse(list(first.parent.glob('*.partial')))

    def test_missing_onedrive_does_not_silently_save_elsewhere(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict('os.environ', {}, clear=True):
            source = Path(folder) / 'generated.pdf'
            source.write_bytes(b'%PDF-1.4 test bundle')
            with self.assertRaisesRegex(RuntimeError, 'OneDrive'):
                save_bundle_to_onedrive(source, '2018999')

    def test_rclone_upload_is_confirmed_only_after_success(self):
        source = Path('20260926_2018999_面談資料.pdf')
        with patch('helper.shutil.which', return_value='rclone.exe'), patch('helper.subprocess.run', side_effect=[
            CompletedProcess([], 0, stdout='onedrive:\n'), CompletedProcess([], 0),
        ]) as run:
            self.assertTrue(sync_bundle_to_cloud(source))
            self.assertEqual(run.call_args_list[1].args[0][-1], f'onedrive:面談準備/保存済み資料/{source.name}')
        with patch('helper.shutil.which', return_value=None):
            self.assertFalse(sync_bundle_to_cloud(source))
        with patch('helper.shutil.which', return_value='rclone.exe'), patch('helper.subprocess.run', side_effect=[
            CompletedProcess([], 0, stdout='onedrive:\n'), CompletedProcess([], 1),
        ]):
            with self.assertRaisesRegex(RuntimeError, 'クラウドへ送れません'):
                sync_bundle_to_cloud(source)

    def test_save_endpoint_checks_origin_and_reuses_saved_bundle(self):
        with tempfile.TemporaryDirectory() as onedrive, tempfile.TemporaryDirectory() as generated:
            Path(generated, 'staff-bundle.pdf').write_bytes(b'%PDF-1.4 test bundle')
            token = 'a' * 32
            helper.SESSIONS[token] = (time.time() + 60, type('Folder', (), {'name': generated})(), {}, '2018999')
            server = ThreadingHTTPServer(('127.0.0.1', 0), helper.Handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                url = f'http://127.0.0.1:{server.server_port}/save/{token}'
                with patch('helper.PORT', server.server_port), patch.dict('os.environ', {'OneDrive': onedrive}), \
                        patch('helper.sync_bundle_to_cloud', return_value=True) as upload:
                    bad = Request(url, method='POST', headers={'Origin': 'https://other.example'})
                    with self.assertRaises(HTTPError) as refused:
                        urlopen(bad, timeout=5)
                    self.assertEqual(refused.exception.code, 403)
                    good = Request(url, method='POST', headers={'Origin': helper.ORIGIN})
                    with urlopen(good, timeout=5) as response:
                        first = json.load(response)
                    with urlopen(good, timeout=5) as response:
                        second = json.load(response)
                    self.assertTrue(first['cloudSynced'])
                    self.assertEqual(first['filename'], second['filename'])
                    self.assertEqual(upload.call_count, 1)
                    self.assertEqual(Path(first['folder'], first['filename']).read_bytes(), b'%PDF-1.4 test bundle')
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)
                helper.SESSIONS.pop(token, None)

    def test_school_name_keeps_other_schools_out(self):
        self.assertTrue(school_name_matches('お大宮（理数）', '大宮'))
        self.assertTrue(school_name_matches('2027年 大宮 推薦基準', '大宮'))
        self.assertFalse(school_name_matches('お大宮光陵（音楽）', '大宮'))
        self.assertFalse(school_name_matches('市立大宮北', '大宮'))

    def test_private_recommendation_uses_latest_year_for_school(self):
        with tempfile.TemporaryDirectory() as folder:
            roots = [Path(folder) / str(index) for index in range(7)]
            for root in roots:
                root.mkdir()
            (roots[3] / 'う 浦和学院高等学校.jpg').touch()
            for year in (2025, 2027):
                sub = roots[5] / f'★{year}年受験用★私立高校推薦'
                sub.mkdir()
                (sub / f'{year}年浦和学院推薦基準.pdf').touch()
            selected, missing = selected_schools(roots, ['浦和学院'])
            self.assertFalse(missing)
            self.assertEqual([index for index, _ in selected], [3, 5])
            self.assertIn('2027', selected[-1][1].name)

    def test_hokushin_picks_latest_matching_ocr(self):
        with tempfile.TemporaryDirectory() as folder:
            roots = [Path(folder) / str(index) for index in range(7)]
            for root in roots:
                root.mkdir()
            for day in ('06月21日', '09月06日'):
                sub = roots[1] / f'北辰中３第１回{day}号個人成績表本校'
                sub.mkdir()
                (sub / 'NO_NAME_01_p1-2.pdf').touch()
                (sub / 'NO_NAME_01_p1-2_ocr.txt').write_text('山田 太郎', encoding='utf-8')
            found, error = hokushin(roots, '中3', '山田太郎')
            self.assertIsNone(error)
            self.assertIn('09月06日', str(found))


if __name__ == '__main__':
    unittest.main()
