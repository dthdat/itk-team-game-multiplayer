#!/usr/bin/env python3
"""Install the movement correction fix without changing production config or schema."""
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIVE = pathlib.Path('/opt/prompt-works')
UNIT = pathlib.Path('/etc/systemd/system/prompt-works.service')
MANIFEST = json.loads((ROOT / 'release/production-release-manifest.json').read_text())
ARCHIVE = ROOT / MANIFEST['backendArchive']['path']


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def ready():
    for _ in range(100):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3000/readyz', timeout=2) as response:
                payload = json.load(response)
            if payload.get('ok') and payload.get('grading') == 'groq':
                return payload
        except Exception:
            pass
        time.sleep(.1)
    raise RuntimeError('Production readiness check failed')


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo; no secrets are requested or printed.')
    assert hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() == MANIFEST['backendArchive']['sha256']
    assert output('systemctl', 'show', 'prompt-works.service', '-p', 'WorkingDirectory', '--value') == str(LIVE)
    assert output('systemctl', 'show', 'prompt-works.service', '-p', 'User', '--value') == 'promptworks'
    assert '/opt/prompt-works/dist/server/index.js' in output('systemctl', 'show', 'prompt-works.service', '-p', 'ExecStart', '--value')
    assert output('systemctl', 'is-active', 'prompt-works.service') == 'active'
    assert ready().get('grading') == 'groq'

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    rollback = LIVE / f'rollback-movement-{stamp}'
    rollback.mkdir(mode=0o700)
    shutil.copytree(LIVE / 'dist', rollback / 'dist')
    shutil.copyfile(UNIT, rollback / 'prompt-works.service')
    subprocess.run(['systemctl', 'start', 'prompt-works-backup.service'], check=True)
    assert output('systemctl', 'show', 'prompt-works-backup.service', '-p', 'Result', '--value') == 'success'

    stage = pathlib.Path(tempfile.mkdtemp(prefix='.movement-fix-', dir=LIVE))
    old = LIVE / f'.dist-before-movement-{stamp}'
    changed = False
    try:
        with tarfile.open(ARCHIVE) as archive:
            archive.extractall(stage, filter='data')
        candidate = stage / 'dist'
        room_js = (candidate / 'server/room.js').read_text()
        assert 'safePlayerPosition' in room_js
        assert 'if (blocked(player.x, player.z))' in room_js

        subprocess.run(['systemctl', 'stop', 'prompt-works.service'], check=True)
        changed = True
        os.replace(LIVE / 'dist', old)
        os.replace(candidate, LIVE / 'dist')
        shutil.chown(LIVE / 'dist', 'promptworks', 'promptworks')
        for directory, names, files in os.walk(LIVE / 'dist'):
            shutil.chown(directory, 'promptworks', 'promptworks')
            os.chmod(directory, 0o755)
            for filename in files:
                path = pathlib.Path(directory) / filename
                shutil.chown(path, 'promptworks', 'promptworks')
                os.chmod(path, 0o644)
        subprocess.run(['systemctl', 'start', 'prompt-works.service'], check=True)
        health = ready()
        shutil.rmtree(old)
        report = {
            'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'result': 'PASS',
            'service': 'prompt-works.service',
            'listen': '127.0.0.1:3000',
            'grading': health['grading'],
            'databaseMigration': 'none',
            'environmentChanged': False,
            'databaseBackup': 'successful local backup service run',
            'rollbackDirectory': str(rollback),
            'archiveSha256': MANIFEST['backendArchive']['sha256']
        }
        report_path = ROOT / 'reports/movement-production-backend.json'
        report_path.write_text(json.dumps(report, indent=2) + '\n')
        shutil.chown(report_path, 'ubuntu', 'ubuntu')
        print('PASS: movement backend fix is healthy on localhost:3000; no environment change or schema migration. Previous dist and a verified local SQLite backup are preserved.')
    except Exception:
        if changed:
            subprocess.run(['systemctl', 'stop', 'prompt-works.service'], check=False)
            if (LIVE / 'dist').exists():
                shutil.rmtree(LIVE / 'dist')
            if old.exists():
                os.replace(old, LIVE / 'dist')
            subprocess.run(['systemctl', 'start', 'prompt-works.service'], check=False)
        raise
    finally:
        shutil.rmtree(stage, ignore_errors=True)


main()
