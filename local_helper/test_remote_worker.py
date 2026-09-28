import tempfile
import threading
import unittest
from pathlib import Path

from remote_worker import RemoteWorker


class RemoteWorkerTests(unittest.TestCase):
    def worker(self, root, make_bundle=None):
        return RemoteWorker(
            Path(root), lambda: [Path(root)],
            lambda paths, payload: {'schools': [{'rank': 1, 'name': payload['schools'][0], 'found': True, 'files': []}],
                                    'materials': []},
            make_bundle or (lambda payload: None), lambda source, number: Path(root) / 'saved.pdf',
            lambda path: False, {'completed': 1},
        )

    def test_preview_reports_only_the_requested_student_result(self):
        with tempfile.TemporaryDirectory() as root:
            worker = self.worker(root)
            calls = []
            worker.request = lambda body: calls.append(body) or {'ok': True}
            worker.execute({'id': 'job-id', 'lease': 'lease-id', 'kind': 'preview',
                            'payload': {'number': '2018998', 'name': '確認用', 'grade': '中3', 'campus': '本校', 'schools': ['叡明']}})
            self.assertEqual([call['action'] for call in calls], ['complete'])
            self.assertEqual(calls[0]['result']['schools'][0]['name'], '叡明')

    def test_generation_uploads_and_reports_onedrive_location(self):
        with tempfile.TemporaryDirectory() as root:
            folder = tempfile.TemporaryDirectory(dir=root)
            (Path(folder.name) / 'staff-bundle.pdf').write_bytes(b'%PDF-1.4\n%%EOF')
            worker = self.worker(root, lambda payload: (folder, {'items': [], 'missing': [], 'pages': 1}))
            calls = []
            worker.request = lambda body: calls.append(body) or ({'url': 'https://example.test/upload', 'path': 'jobs/job-id/bundle.pdf'} if body['action'] == 'upload' else {'ok': True})
            uploaded = []
            worker.upload = lambda url, source: uploaded.append((url, source.read_bytes()))
            worker.execute({'id': 'job-id', 'lease': 'lease-id', 'kind': 'generate', 'payload': {'number': '2018998'}})
            self.assertEqual([call['action'] for call in calls], ['upload', 'complete'])
            self.assertEqual(uploaded[0][1], b'%PDF-1.4\n%%EOF')
            self.assertEqual(calls[-1]['result']['storagePath'], 'jobs/job-id/bundle.pdf')
            self.assertIn('saved.pdf', calls[-1]['result']['savedPath'])

    def test_private_upload_runs_while_onedrive_copy_is_in_progress(self):
        with tempfile.TemporaryDirectory() as root:
            folder = tempfile.TemporaryDirectory(dir=root)
            (Path(folder.name) / 'staff-bundle.pdf').write_bytes(b'%PDF-1.4\n%%EOF')
            worker = self.worker(root, lambda payload: (folder, {'items': [], 'missing': [], 'pages': 1}))
            upload_started = threading.Event()
            overlapped = []
            def save(source, number):
                overlapped.append(upload_started.wait(2))
                return Path(root) / 'saved.pdf'
            worker.save_bundle = save
            worker.upload = lambda url, source: upload_started.set()
            worker.request = lambda body: {'url': 'https://example.test/upload', 'path': 'jobs/job-id/bundle.pdf'} if body['action'] == 'upload' else {'ok': True}
            worker.execute({'id': 'job-id', 'lease': 'lease-id', 'kind': 'generate', 'payload': {'number': '2018998'}})
            self.assertEqual(overlapped, [True])

    def test_onedrive_sync_failure_does_not_hide_completed_private_pdf(self):
        with tempfile.TemporaryDirectory() as root:
            folder = tempfile.TemporaryDirectory(dir=root)
            (Path(folder.name) / 'staff-bundle.pdf').write_bytes(b'%PDF-1.4\n%%EOF')
            worker = self.worker(root, lambda payload: (folder, {'items': [], 'missing': [], 'pages': 1}))
            def fail_sync(saved):
                raise RuntimeError('クラウド同期に失敗')
            worker.sync_bundle = fail_sync
            worker.upload = lambda url, source: None
            calls = []
            worker.request = lambda body: calls.append(body) or ({'url': 'https://example.test/upload', 'path': 'jobs/job-id/bundle.pdf'} if body['action'] == 'upload' else {'ok': True})
            worker.execute({'id': 'job-id', 'lease': 'lease-id', 'kind': 'generate', 'payload': {'number': '2018998'}})
            self.assertEqual(calls[-1]['action'], 'complete')
            result = calls[-1]['result']
            self.assertFalse(result['cloudSynced'])
            self.assertIn('saved.pdf', result['savedPath'])
            self.assertIn('クラウド同期に失敗', result['saveError'])


if __name__ == '__main__':
    unittest.main()
