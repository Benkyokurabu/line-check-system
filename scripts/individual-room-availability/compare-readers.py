"""Run the existing journal reader on isolated copies; never write originals."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parents[2] / '.private' / 'kobetsu-20261021'
legacy_dir = Path.home() / 'OneDrive' / 'デスクトップ' / '【完成版】授業日誌システム'
sys.path.insert(0, str(legacy_dir))
import export_schedule_json as journal_reader

summary = []
for month in ['2026-10', '2026-11']:
    local = root / f'{month}.xlsm'
    cloud = root / f'cloud-{month}.xlsm'
    source_hash = hashlib.sha256(cloud.read_bytes()).hexdigest()
    if source_hash != hashlib.sha256(local.read_bytes()).hexdigest():
        raise RuntimeError(f'{month}: local and cloud source differ; refresh JS extraction first')
    stage = root / 'legacy-reader' / month
    stage.mkdir(parents=True, exist_ok=True)
    target = stage / f'{month[:4]}年{int(month[5:])}月スケジュール.xlsm'
    shutil.copyfile(cloud, target)
    os.chdir(stage)
    output = journal_reader.export_month_schedule_json(str(target))
    legacy = json.loads(Path(output).read_text(encoding='utf-8'))
    javascript = json.loads((root / f'lessons-{month}.json').read_text(encoding='utf-8'))
    encode = lambda row: json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    left = set(map(encode, legacy))
    right = set(map(encode, javascript))
    result = {'month': month, 'source_sha256': source_hash, 'python_count': len(legacy),
              'javascript_count': len(javascript), 'python_only': len(left-right),
              'javascript_only': len(right-left), 'identical': left == right,
              'python_only_examples': [json.loads(x) for x in sorted(left-right)[:5]],
              'javascript_only_examples': [json.loads(x) for x in sorted(right-left)[:5]]}
    summary.append(result)
    if hashlib.sha256(cloud.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError('Source copy changed')
(root / 'reader-comparison.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
