"""Fetch a small, pinned official-source oracle; never install or run SillyTavern."""
from pathlib import Path
import argparse, hashlib, json, urllib.request

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--verify-only', action='store_true', help='Check existing files without network')
args = parser.parse_args()
manifest = json.loads((root / 'docs/compatibility-sources.json').read_text(encoding='utf-8'))
required = {'LICENSE', 'public/scripts/world-info.js', 'src/endpoints/characters.js', 'src/character-card-parser.js'}
destination = root / 'evidence/sillytavern-1.19.0'
rows = [row for row in manifest['sources'] if row['repo'] == 'SillyTavern/SillyTavern' and row['path'] in required]
assert len(rows) == len(required)
for row in rows:
    target = destination / row['path']
    assert target.resolve().is_relative_to(destination.resolve())
    if args.verify_only:
        raw = target.read_bytes()
    else:
        expected = 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/' + manifest['sillyTavernCommit'] + '/'
        assert row['url'] == expected + row['path']
        with urllib.request.urlopen(row['url'], timeout=30) as response:
            assert response.geturl() == row['url'], 'Unexpected source redirect'
            raw = response.read(1024 * 1024 + 1)
        assert len(raw) <= 1024 * 1024, 'Unexpected fixture size'
    assert hashlib.sha256(raw).hexdigest() == row['sha256'], 'Source hash mismatch: ' + row['path']
    if not args.verify_only:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
print(json.dumps({'filesVerified': len(rows), 'version': '1.19.0', 'network': not args.verify_only, 'applicationExecuted': False}))
