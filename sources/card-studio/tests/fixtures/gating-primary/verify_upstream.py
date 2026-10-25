"""Compare the bounded local plugin-source fixtures with their pinned upstream."""
from pathlib import Path
import hashlib
import json
import urllib.request

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
for row in manifest:
    if not row['file'].startswith(('pt-', 'PT-')):
        continue
    url = row['source'].replace('https://github.com/', 'https://raw.githubusercontent.com/').replace('/blob/', '/')
    raw = urllib.request.urlopen(url, timeout=30).read()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != row['sha256']:
        raise RuntimeError('Pinned upstream differs: ' + row['file'])
    row['upstreamVerified'] = True
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print('All four installed plugin fixtures match pinned upstream bytes.')
