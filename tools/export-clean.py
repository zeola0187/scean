"""Copy exactly hash-pinned source inputs and optionally make a deterministic ZIP."""
from pathlib import Path,PurePosixPath
import argparse,json,hashlib,shutil,zipfile
p=argparse.ArgumentParser();p.add_argument('--source',default=str(Path(__file__).resolve().parents[1]));p.add_argument('--output',required=True);p.add_argument('--zip');a=p.parse_args()
source=Path(a.source).resolve();dest=Path(a.output).resolve()
if dest==source or source in dest.parents or dest.exists():raise RuntimeError('Use a new output directory outside the input tree')
manifest=source/'EXPORT-MANIFEST.json'
spec=json.loads(manifest.read_text(encoding='utf-8'))
files=[];seen=set()
for row in spec['files']:
 rel=PurePosixPath(row['path'])
 if not row['path'] or '\\' in row['path'] or ':' in row['path'] or rel.is_absolute() or '..' in rel.parts or str(rel)!=row['path'] or row['path'].casefold() in seen:raise RuntimeError('Unsafe or duplicate allowlist path')
 seen.add(row['path'].casefold())
 if any(part in ['.git','node_modules','.env','.test-data','evidence','.integration'] or part.startswith('build-suite-source') for part in rel.parts):raise RuntimeError('Private/build input in export allowlist')
 src=source.joinpath(*rel.parts)
 if not src.resolve().is_relative_to(source):raise RuntimeError('Allowlist input escaped source root')
 for ancestor in [src,*src.parents]:
  if ancestor==source.parent:break
  if ancestor.is_symlink():raise RuntimeError('Linked allowlist input refused')
 data=src.read_bytes()
 if len(data)!=row['bytes'] or hashlib.sha256(data).hexdigest()!=row['sha256']:raise RuntimeError('Input hash mismatch: '+row['path'])
 files.append((row['path'],data))
files.append(('EXPORT-MANIFEST.json',manifest.read_bytes()))
dest.mkdir(parents=True)
for rel,data in files:
 target=dest/rel
 if not target.resolve().is_relative_to(dest):raise RuntimeError('Export path escaped output root')
 target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
if a.zip:
 archive=Path(a.zip).resolve()
 if archive.exists() or dest in archive.parents:raise RuntimeError('ZIP must be a new file outside output')
 archive.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for rel,data in sorted(files):
   info=zipfile.ZipInfo('scean-candidate/'+rel,(2026,10,18,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100644<<16
   z.writestr(info,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
 print(json.dumps({'files':len(files),'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'archiveBytes':archive.stat().st_size}))
else:print(json.dumps({'files':len(files),'exported':True}))
