"""Rebuild only the generated Client. Bundled skills are versioned inputs."""
from pathlib import Path
import sys
import re

if sys.argv[1:] not in ([], ['--client-only']):
    raise SystemExit('Supported option: --client-only')
bundle = Path(__file__).resolve().parent / 'cardstudio-bundle'
template = (bundle / 'client-template.js').read_text(encoding='utf-8')
web = bundle.parents[2] / 'isolated' / 'web'
presentation = re.sub(r'^export\s+', '', (web / 'presentation.mjs').read_text(encoding='utf-8'), flags=re.M)
appearance = (bundle / 'lib/scean-appearance.js').read_text(encoding='utf-8').replace('export function ', 'function ')
tokens = '\n'.join(re.findall(r':root(?:\[[^\]]+\])*\{[^}]+\}', (web / 'presentation.css').read_text(encoding='utf-8'))).replace(':root', '.scean-workspace')
import json
template = template.replace('/* SCEAN_APPEARANCE */', 'const sceanPresentation=(()=>{\n'+presentation+'\nreturn {normalizePresentation,loadPresentation,savePresentation,presentationTheme,presentationKey};})();\n'+appearance+'\nconst productAppearance=createSceanAppearance({React,h,presentation:sceanPresentation});\nconst productAppearanceCss='+json.dumps(tokens,ensure_ascii=False)+';')
for marker, source, declaration in [
    ('/* MATERIAL_CLIENT */', 'lib/client-materials.js', 'export function createMaterialComponents'),
    ('/* CHAT_PANEL_PREVIEW */', 'lib/chat-panel-preview.js', 'export '),
    ('/* LIBRARY_CLIENT */', 'lib/client-library.js', 'export function createLibraryComponents'),
    ('/* AUTHORING_NAVIGATION */', 'lib/authoring-navigation.js', 'export class AuthoringNavigation'),
    ('/* WORKSPACE_CLIENT */', 'lib/client-controller.js', 'export class WorkspaceClient'),
    ('/* CARDSTUDIO_REMOTE */', 'lib/bridge-protocol.js', 'export const cardstudioRemote'),
]:
    assert template.count(marker) == 1
    body = (bundle / source).read_text(encoding='utf-8').replace(declaration, declaration.removeprefix('export '))
    template = template.replace(marker, body)
(bundle / 'client.js').write_text(template, encoding='utf-8', newline='\r\n')
print('Client rebuilt; bundled and user skill files unchanged.')
