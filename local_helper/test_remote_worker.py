import tempfile
import unittest
from pathlib import Path

from remote_worker import RemoteWorker


class RemoteWorkerTests(unittest.TestCase):
    def worker(self, root, make_bundle=None):
        return RemoteWorker(
            Path(root), lambda: [Path(root)],
            lambda paths, schools: [{'rank': 1, 'name': schools[0], 'found': True, 'files': []}],
            lambda *args: {'found': False}, lambda *args: {'found': False},
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


if __name__ == '__main__':
    unittest.main()
