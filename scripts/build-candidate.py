"""Deterministic canonical-source build, without deployment, SDKs or models."""
from pathlib import Path
import subprocess,shutil,json,hashlib,sys
root=Path(__file__).resolve().parents[1]
if root.is_symlink():raise RuntimeError('Linked source root refused')
args=sys.argv[1:]
stage_name=next((x.split('=',1)[1] for x in args if x.startswith('--stage=')),'build-suite-source-candidate')
if not stage_name.startswith('build-suite-source') or not all(c.isalnum() or c=='-' for c in stage_name):raise RuntimeError('Fresh local build label required')
stage=root/stage_name
if stage.exists():raise RuntimeError('Build output exists; use --stage=build-suite-source-NEW')
canonical=root/'sources/card-studio/cardstudio-bundle'
blocked=['opening-narrative-crafter','palette-personality-reconstruction','character-design-deepener','lorebook-architect','dialogue-and-prompt-tuner','frontend-presentation-optimizer']
def reject_payload(base):
 if any(p.name in blocked for p in base.rglob('*')):raise RuntimeError('WITHHELD_OR_RETIRED_SKILL_REINTRODUCED')
 for name in ['catalog.json','sources.json']:
  p=base/'skills'/name
  if p.exists() and any(r.get('name',r.get('skill')) in blocked for r in json.loads(p.read_text(encoding='utf-8'))):raise RuntimeError('INACTIVE_SKILL_IN_CATALOG')
reject_payload(canonical)
subprocess.run(['python','-X','utf8',str(root/'sources/card-studio/build_cardstudio.py'),'--client-only'],check=True)
subprocess.run(['node',str(root/'scripts/build-player-native.mjs')],check=True)
spec=json.loads((root/'BUILD-MAP.json').read_text(encoding='utf-8'))
rows=[]
for item in spec['runtime']:
 source=root/item['source'];target=root/item['path']
 if not source.is_file() or source.is_symlink():raise RuntimeError('Missing or linked source '+item['source'])
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
 rows.append({**item,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'exact':source.read_bytes()==target.read_bytes()})
expected={r['path'] for r in rows}
actual={p.relative_to(root).as_posix() for p in (root/'packages').rglob('*') if p.is_file()}
if actual!=expected:raise RuntimeError('Unexpected runtime file set: '+str(sorted(actual^expected)))
for base in [root/'packages/studio']:reject_payload(base)
# Compatibility imports for retained offline tests are generated from the same
# current source, never from installed or historical packages.
for destination in [root/'studio/cardstudio-bundle',root/'authoring/.integration/cardstudio']:
 if destination.exists():
  for p in destination.rglob('*'):
   if p.is_symlink():raise RuntimeError('Linked compatibility output refused')
 shutil.copytree(canonical,destination,dirs_exist_ok=True)
stage.mkdir()
report={'schemaVersion':1,'status':'PASS','files':rows,'runtimeFileCount':len(rows),'sdkIncluded':False,'modelCalls':0,'productionWrites':0,'historicalOverlaysRequired':False,'withheldSkillsAbsent':True}
(stage/'rebuild-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='files'}))
