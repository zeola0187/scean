"""Create hash-pinned installation TGZs locally; never publish or install."""
from pathlib import Path
import argparse, fnmatch, gzip, hashlib, io, json, tarfile

ROOT=Path(__file__).resolve().parents[1]
sha=lambda b:hashlib.sha256(b).hexdigest()

def package(source, output):
 source=source.resolve();output=output.resolve()
 if output.exists() or source==output or source in output.parents:raise ValueError('Use a fresh output directory outside source')
 spec=json.loads((source/'EXPORT-MANIFEST.json').read_text(encoding='utf-8'))
 pinned={row['path']:row for row in spec['files']}
 payload={}
 for name,row in pinned.items():
  p=source/name
  if p.is_symlink() or not p.resolve().is_relative_to(source):raise ValueError('Linked/escaped input')
  b=p.read_bytes()
  if len(b)!=row['bytes'] or sha(b)!=row['sha256']:raise ValueError('Input hash mismatch: '+name)
  payload[name]=b
 output.mkdir(parents=True)
 result=[]
 for label,prefix in [('suite',''),('scean','packages/scean/'),('studio','packages/studio/')]:
  manifest=json.loads(payload[prefix+'package.json']);patterns=manifest.get('files',[])
  selected={name[len(prefix):]:b for name,b in payload.items() if name.startswith(prefix) and (name==prefix+'package.json' or any(name[len(prefix):]==p or name[len(prefix):].startswith(p.rstrip('/')+'/') or fnmatch.fnmatchcase(name[len(prefix):],p) for p in patterns))}
  required=['LICENSE','COPYRIGHT','LICENSE-SCOPE.md','THIRD-PARTY-LICENSES.json','SOURCE-AVAILABILITY.md','release-source.json']
  if any(n not in selected for n in required):raise ValueError('Missing license/source-offer payload: '+label)
  raw=io.BytesIO()
  with tarfile.open(fileobj=raw,mode='w',format=tarfile.PAX_FORMAT) as archive:
   for name,b in sorted(selected.items()):
    info=tarfile.TarInfo('package/'+name);info.size=len(b);info.mtime=0;info.mode=0o644;info.uid=info.gid=0;info.uname=info.gname='';archive.addfile(info,io.BytesIO(b))
  compressed=io.BytesIO()
  with gzip.GzipFile(filename='',mode='wb',fileobj=compressed,mtime=0,compresslevel=9) as z:z.write(raw.getvalue())
  data=compressed.getvalue();name=f'scean-{label}-candidate.tgz';(output/name).write_bytes(data)
  result.append({'name':name,'bytes':len(data),'sha256':sha(data),'files':len(selected),'license':'AGPL-3.0-only','exception':'advanced-tavern-card-authoring remains MIT where included','licenseSha256':sha(selected['LICENSE'])})
 report={'schemaVersion':1,'status':'LOCAL_PACKAGES_NOT_PUBLISHED','sourceManifestSha256':sha((source/'EXPORT-MANIFEST.json').read_bytes()),'packages':result,'fullCorrespondingSource':'Separate matching clean source ZIP; do not substitute installation TGZ for full source.','sourceAvailability':json.loads(payload['release-source.json'])}
 (output/'PACKAGE-MANIFEST.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');return report

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',default=str(ROOT));p.add_argument('--output',required=True);a=p.parse_args();print(json.dumps(package(Path(a.source),Path(a.output)),indent=2))
