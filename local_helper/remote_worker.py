"""Outbound-only worker for the staff interview-material job queue."""
from __future__ import annotations

import json
import time
import threading
from pathlib import Path
from urllib.request import Request, urlopen


class RemoteWorker:
    def __init__(self, root: Path, roots, preview_bundle, make_bundle, save_bundle, sync_bundle, index_status):
        self.config_path = root / 'worker.json'
        self.roots = roots
        self.preview_bundle = preview_bundle
        self.make_bundle = make_bundle
        self.save_bundle = save_bundle
        self.sync_bundle = sync_bundle
        self.index_status = index_status
        self.root = root

    def request(self, body: dict) -> dict:
        config = json.loads(self.config_path.read_text(encoding='utf-8-sig'))
        url = config['server'].rstrip('/') + '/api/material-worker'
        if not url.startswith('https://') or not isinstance(config['id'], str) or len(config['token']) != 64:
            raise ValueError('作成PCの接続設定を確認してください。')
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        request = Request(url, data=data, method='POST', headers={
            'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['token'],
            'x-material-worker': config['id'], 'User-Agent': 'BentanMaterialWorker/1',
        })
        with urlopen(request, timeout=25) as response:
            return json.load(response)

    def ready(self) -> bool:
        try:
            paths = self.roots()
            return all(path.is_dir() for path in paths) and self.index_status.get('completed', 0) > 0
        except Exception:
            return False

    def upload(self, url: str, source: Path) -> None:
        if not url.startswith('https://') or source.stat().st_size > 52_428_800:
            raise RuntimeError('完成PDFが50MBを超えたか、保存先が不正です。')
        data = source.read_bytes()
        for attempt in range(3):
            try:
                request = Request(url, data=data, method='PUT', headers={
                    'Content-Type': 'application/pdf', 'x-upsert': 'true',
                })
                with urlopen(request, timeout=180) as response:
                    if response.status not in (200, 201):
                        raise RuntimeError('PDFを保管できません。')
                return
            except Exception:
                if attempt == 2:
                    raise RuntimeError('完成PDFの非公開保管に失敗しました。')
                time.sleep(2 ** attempt)

    def execute(self, job: dict) -> None:
        id_, lease = job['id'], job['lease']
        payload = job['payload']
        keep_renewing = threading.Event()
        lost_lease = threading.Event()

        def renew():
            while not keep_renewing.wait(15):
                try:
                    self.request({'action': 'heartbeat', 'ready': self.ready(), 'status': {'busy': True}})
                    if not self.request({'action': 'renew', 'id': id_, 'lease': lease}).get('ok'):
                        lost_lease.set()
                        return
                except Exception:
                    # A transient network fault may recover before the 45-second lease ends.
                    pass

        thread = threading.Thread(target=renew, daemon=True)
        thread.start()
        try:
            if job['kind'] == 'preview':
                paths = self.roots()
                result = self.preview_bundle(paths, payload)
            else:
                folder, manifest = self.make_bundle(payload)
                try:
                    source = Path(folder.name) / 'staff-bundle.pdf'
                    save_error = None
                    saved = None
                    cloud_synced = False
                    try:
                        saved = self.save_bundle(source, str(payload['number']))
                        cloud_synced = self.sync_bundle(saved)
                    except Exception as exc:
                        save_error = str(exc)[:200]
                    upload = self.request({'action': 'upload', 'id': id_, 'lease': lease})
                    self.upload(upload['url'], source)
                    result = {**manifest, 'storagePath': upload['path'],
                              'savedPath': str(saved) if saved else None, 'cloudSynced': cloud_synced,
                              'saveError': save_error}
                finally:
                    folder.cleanup()
            if lost_lease.is_set():
                return
            self.request({'action': 'complete', 'id': id_, 'lease': lease, 'result': result})
        except Exception as exc:
            try:
                if not lost_lease.is_set():
                    self.request({'action': 'fail', 'id': id_, 'lease': lease, 'error': str(exc)[:200]})
            except Exception:
                pass
        finally:
            keep_renewing.set()
            thread.join(timeout=2)

    def run(self) -> None:
        while True:
            if not self.config_path.is_file():
                time.sleep(15)
                continue
            try:
                ready = self.ready()
                self.request({'action': 'heartbeat', 'ready': ready,
                              'status': {'hokushinIndexed': self.index_status.get('completed', 0)}})
                if ready:
                    job = self.request({'action': 'claim'}).get('job')
                    if job:
                        self.execute(job)
            except Exception:
                # Keep the local bridge alive and retry outbound HTTPS after outages.
                pass
            time.sleep(5)
