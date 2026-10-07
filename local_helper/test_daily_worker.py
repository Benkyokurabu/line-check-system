import tempfile
import unittest
import io
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError

import helper
from remote_worker import RemoteWorker


class DailyWorkerTests(unittest.TestCase):
    def test_server_validation_reason_survives_http_failure(self):
        with tempfile.TemporaryDirectory() as root:
            worker = self.worker(root)
            worker.config_path.write_text(json.dumps({'server': 'https://example.test', 'id': 'primary', 'token': 'a' * 64}), encoding='utf-8')
            response = io.BytesIO(json.dumps({'error': '面談予定が取消されました。以前の資料は保持しています。'}, ensure_ascii=False).encode('utf-8'))
            with patch('remote_worker.urlopen', side_effect=HTTPError('https://example.test', 409, 'Conflict', {}, response)):
                with self.assertRaisesRegex(RuntimeError, '面談予定が取消'):
                    worker.request({'action': 'daily-verify'})

    def test_selected_guide_failure_keeps_actual_reason_and_never_returns_partial_success(self):
        with (patch('helper.roots', return_value=[Path('unused')] * 9), patch('helper.guide_pdf', side_effect=RuntimeError('指導簿の生徒照合またはPDF化に失敗しました')),
              patch('helper.common_materials', return_value=[]), patch('helper.selected_schools', return_value=([], []))):
            with self.assertRaisesRegex(RuntimeError, '指導簿：指導簿の生徒照合'):
                helper.make_bundle({'number': '2018998', 'name': '確認用 生徒', 'grade': '小6', 'schools': [], 'selectedMaterialIds': ['guide']})

    def worker(self, root):
        return RemoteWorker(Path(root), lambda: [Path(root)], lambda roots, payload: {'materials': [{'id': 'guide'}]},
                            MagicMock(), MagicMock(), MagicMock(), {'completed': 1})

    def test_unchanged_complete_folder_skips_generation_after_server_reverification(self):
        with tempfile.TemporaryDirectory() as root:
            worker = self.worker(root)
            prepared = {'payload': {'number': '2018998'}, 'sourceHash': 'originals'}
            calls = []
            def request(body):
                calls.append(body)
                return prepared if body['action'] == 'daily-prepare' else {'ok': True}
            worker.request = request
            folder = MagicMock()
            folder.unchanged.return_value = True
            folder.folder = Path(root) / 'saved'
            with patch('remote_worker.DailyFolder', return_value=folder), patch('remote_worker.fingerprint', return_value='hash'):
                worker.execute({'id': 'job-id', 'lease': 'lease', 'kind': 'generate', 'payload': {'autoDaily': {'appointment': {}}, 'number': '2018998'}})
            worker.make_bundle.assert_not_called()
            worker.save_bundle.assert_not_called()
            self.assertEqual([call['action'] for call in calls], ['daily-prepare', 'daily-verify', 'complete'])
            self.assertTrue(calls[-1]['result']['skipped'])

    def test_changed_or_cancelled_appointment_is_not_skipped_as_success(self):
        with tempfile.TemporaryDirectory() as root:
            worker = self.worker(root)
            calls = []
            def request(body):
                calls.append(body)
                if body['action'] == 'daily-prepare':
                    return {'payload': {'number': '2018998'}, 'sourceHash': 'originals'}
                return {'ok': body['action'] != 'daily-verify'}
            worker.request = request
            folder = MagicMock()
            folder.unchanged.return_value = True
            with patch('remote_worker.DailyFolder', return_value=folder), patch('remote_worker.fingerprint', return_value='hash'):
                worker.execute({'id': 'job-id', 'lease': 'lease', 'kind': 'generate', 'payload': {'autoDaily': {'appointment': {}}, 'number': '2018998'}})
            self.assertEqual(calls[-1]['action'], 'fail')
            worker.make_bundle.assert_not_called()
            folder.publish.assert_not_called()

    def test_share_unavailable_is_reported_before_excel_generation(self):
        with tempfile.TemporaryDirectory() as root:
            worker = self.worker(root)
            calls = []
            worker.request = lambda body: calls.append(body) or {'payload': {'number': '2018998'}, 'sourceHash': 'originals'}
            with patch('remote_worker.DailyFolder', side_effect=RuntimeError('NAS unavailable')), patch('remote_worker.fingerprint', return_value='hash'):
                worker.execute({'id': 'job-id', 'lease': 'lease', 'kind': 'generate', 'payload': {'autoDaily': {'appointment': {}}, 'number': '2018998'}})
            self.assertEqual(calls[-1]['action'], 'fail')
            self.assertIn('NAS unavailable', calls[-1]['error'])
            worker.make_bundle.assert_not_called()


if __name__ == '__main__':
    unittest.main()
