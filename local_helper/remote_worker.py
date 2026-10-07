"""Outbound-only worker for the staff interview-material job queue."""
from __future__ import annotations

import json
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from daily_auto import DailyFolder, fingerprint


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
        self.daily_scan_at = 0.0
        self.daily_scanning = threading.Event()
        self.daily_status = {}

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
        try:
            with urlopen(request, timeout=70 if body.get('action') in ('daily-scan', 'daily-prepare', 'daily-verify') else 25) as response:
                return json.load(response)
        except HTTPError as exc:
            try:
                error = json.loads(exc.read(4096)).get('error')
            except (ValueError, AttributeError):
                error = None
            raise RuntimeError(error[:300] if isinstance(error, str) and error else f'作成サーバーとの通信に失敗しました（HTTP {exc.code}）。') from None

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
                    self.request({'action': 'heartbeat', 'ready': self.ready(), 'status': {'busy': True,
                                  'capabilities': ['daily-offline-v1'], 'daily': self.daily_status}})
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
                automatic = isinstance(payload.get('autoDaily'), dict)
                prepared = None
                daily_folder = None
                input_hash = None
                if automatic:
                    prepared = self.request({'action': 'daily-prepare', 'id': id_, 'lease': lease})
                    payload = prepared['payload']
                    preview = self.preview_bundle(self.roots(), payload)
                    if preview.get('hokushin', {}).get('indexing'):
                        raise RuntimeError('北辰の索引を作成中です。資料は更新せず、次回巡回で再試行します。')
                    selected_ids = [item['id'] for item in preview['materials']]
                    if not selected_ids or 'guide' not in selected_ids:
                        raise RuntimeError('本人の指導簿を含む資料一式を確認できません。')
                    payload = {**payload, 'selectedMaterialIds': selected_ids}
                    input_hash = fingerprint(prepared, preview, self.root)
                    daily_folder = DailyFolder(prepared)
                    if daily_folder.unchanged(input_hash):
                        if not self.request({'action': 'daily-verify', 'id': id_, 'lease': lease, 'sourceHash': prepared['sourceHash']}).get('ok'):
                            raise RuntimeError('元の回答・面談記録・生徒情報が更新されました。以前の資料は保持しています。')
                        if fingerprint(prepared, self.preview_bundle(self.roots(), prepared['payload']), self.root) != input_hash:
                            raise RuntimeError('元の資料が確認中に更新されました。以前の資料は保持しています。')
                        self.request({'action': 'complete', 'id': id_, 'lease': lease,
                                      'result': {'skipped': True, 'savedFolder': str(daily_folder.folder), 'inputHash': input_hash}})
                        return
                folder, manifest = self.make_bundle(payload)
                try:
                    source = Path(folder.name) / 'staff-bundle.pdf'
                    def save_and_sync():
                        saved = None
                        try:
                            saved = self.save_bundle(source, str(payload['number']))
                            return saved, self.sync_bundle(saved), None
                        except Exception as exc:
                            return saved, False, str(exc)[:200]

                    # Keep the printable bundle and each material separate in private storage.
                    # Uploads and the local OneDrive copy can run at the same time.
                    with ThreadPoolExecutor(max_workers=3) as pool:
                        local_copy = pool.submit(save_and_sync)
                        upload = self.request({'action': 'upload', 'id': id_, 'lease': lease,
                                               'parts': len(manifest['items'])})
                        part_uploads = upload.get('parts', [])
                        if len(part_uploads) != len(manifest['items']):
                            raise RuntimeError('資料ごとのPDF保存先を取得できませんでした')
                        transfers = [pool.submit(self.upload, upload['url'], source)]
                        for index, part in enumerate(part_uploads):
                            transfers.append(pool.submit(self.upload, part['url'], Path(folder.name) / f'material-{index}.pdf'))
                        for transfer in transfers:
                            transfer.result()
                        saved, cloud_synced, save_error = local_copy.result()
                    for item, part in zip(manifest['items'], part_uploads):
                        item['storagePath'] = part['path']
                    result = {**manifest, 'storagePath': upload['path'],
                              'savedPath': str(saved) if saved else None, 'cloudSynced': cloud_synced,
                              'saveError': save_error}
                    if automatic:
                        def authorize():
                            if not self.request({'action': 'daily-verify', 'id': id_, 'lease': lease, 'sourceHash': prepared['sourceHash']}).get('ok'):
                                raise RuntimeError('作成中に回答・面談記録・生徒情報が更新されました。以前の資料は保持しています。')
                            refreshed = self.preview_bundle(self.roots(), prepared['payload'])
                            if fingerprint(prepared, refreshed, self.root) != input_hash:
                                raise RuntimeError('作成中に元の資料が更新されました。以前の資料は保持しています。')
                            if lost_lease.is_set() or not self.request({'action': 'renew', 'id': id_, 'lease': lease}).get('ok'):
                                raise RuntimeError('作成権限の期限が切れました。以前の資料は保持しています。')
                        result['savedFolder'] = daily_folder.publish(Path(folder.name), manifest, input_hash, authorize)
                        result['inputHash'] = input_hash
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
                              'status': {'hokushinIndexed': self.index_status.get('completed', 0),
                                         'capabilities': ['daily-offline-v1'], 'daily': self.daily_status}})
                if ready and time.monotonic() - self.daily_scan_at >= 60 and not self.daily_scanning.is_set():
                    self.daily_scan_at = time.monotonic()
                    self.daily_scanning.set()
                    def scan():
                        try:
                            self.daily_status = self.request({'action': 'daily-scan'})
                        except Exception as exc:
                            self.daily_status = {'ok': False, 'error': str(exc)[:200]}
                        finally:
                            self.daily_scanning.clear()
                    threading.Thread(target=scan, daemon=True).start()
                if ready:
                    job = self.request({'action': 'claim'}).get('job')
                    if job:
                        self.execute(job)
            except Exception:
                # Keep the local bridge alive and retry outbound HTTPS after outages.
                pass
            time.sleep(5)
