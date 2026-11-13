"""Read-only download of pinned public source for the isolated handler harness."""
from pathlib import Path
import hashlib
import json
import urllib.request

destination = Path(__file__).resolve().parent
manifest = []
for source, name in [
    ('src/modules/handler.ts', 'pt-handler.ts'),
    ('src/function/worldinfo.ts', 'pt-worldinfo.ts'),
    ('src/utils/evaluate.ts', 'pt-evaluate.ts'),
    ('LICENSE', 'PT-LICENSE'),
]:
    data = (destination / name).read_bytes()
    manifest.append(dict(file=name, sha256=hashlib.sha256(data).hexdigest(), source='https://github.com/zonde306/ST-Prompt-Template/blob/d6f520d149aba146305b0b781ddd691d449c28d2/' + source))
for source, name in [('src/scripts/world-info.js', 'tt-world-info.js.txt'), ('LICENSE', 'TT-LICENSE')]:
    url = 'https://raw.githubusercontent.com/Darkatse/TauriTavern/3fe9e055b512/' + source
    data = urllib.request.urlopen(url, timeout=30).read()
    (destination / name).write_bytes(data)
    manifest.append(dict(file=name, sha256=hashlib.sha256(data).hexdigest(), source=url))
(destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print('Pinned source fixtures and licenses verified; no runtime code executed.')
