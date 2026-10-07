"""Reject a release executable if any operational Python module is stale."""
import json
import marshal
import sys
import types
from pathlib import Path

from PyInstaller.archive.readers import CArchiveReader


def normalized(code):
    return code.replace(co_filename='', co_consts=tuple(normalized(value) if isinstance(value, types.CodeType) else value for value in code.co_consts))


def verify(executable):
    archive = CArchiveReader(str(executable))
    pyz_name = next(name for name, entry in archive.toc.items() if entry[-1] == 'z')
    pyz = archive.open_embedded_archive(pyz_name)
    matches = {}
    for module in ('helper', 'remote_worker', 'daily_auto'):
        embedded = marshal.loads(archive.extract(module)) if module == 'helper' else pyz.extract(module)
        source = compile((Path(__file__).parent / f'{module}.py').read_text(encoding='utf-8'), '', 'exec')
        matches[module] = marshal.dumps(normalized(embedded)) == marshal.dumps(normalized(source))
    print(json.dumps({'modulesMatchCurrentSource': matches, 'bytes': executable.stat().st_size}))
    if not all(matches.values()):
        raise RuntimeError('配布用アプリに古いソースが含まれています。再ビルドしてください。')


if __name__ == '__main__':
    verify(Path(sys.argv[1]))
