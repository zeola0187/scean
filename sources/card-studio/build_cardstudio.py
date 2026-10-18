"""Rebuild only the generated Client. Bundled skills are versioned inputs."""
from pathlib import Path
import sys

if sys.argv[1:] not in ([], ['--client-only']):
    raise SystemExit('Supported option: --client-only')
bundle = Path(__file__).resolve().parent / 'cardstudio-bundle'
template = (bundle / 'client-template.js').read_text(encoding='utf-8')
for marker, source, declaration in [
    ('/* MATERIAL_CLIENT */', 'lib/client-materials.js', 'export function createMaterialComponents'),
    ('/* LIBRARY_CLIENT */', 'lib/client-library.js', 'export function createLibraryComponents'),
    ('/* WORKSPACE_CLIENT */', 'lib/client-controller.js', 'export class WorkspaceClient'),
    ('/* CARDSTUDIO_REMOTE */', 'lib/bridge-protocol.js', 'export const cardstudioRemote'),
]:
    assert template.count(marker) == 1
    body = (bundle / source).read_text(encoding='utf-8').replace(declaration, declaration.removeprefix('export '))
    template = template.replace(marker, body)
(bundle / 'client.js').write_text(template, encoding='utf-8', newline='\r\n')
print('Client rebuilt; bundled and user skill files unchanged.')
