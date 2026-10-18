"""Extract reviewed shipped SDK into this checkout only, for offline UI validation.
No installer, active Profile, credentials, user data or network is used.
"""
import argparse, hashlib, json, struct
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--asar',required=True)
a=p.parse_args()
root=Path(__file__).resolve().parents[1]
archive=Path(a.asar).resolve()
digest=lambda data:hashlib.sha256(data).hexdigest()
actual=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()
reviewed=json.loads((root/'dsh-compatibility.json').read_text())['reviewedAsarSHA256']['0.2.1-rc.2']
if actual!=reviewed:raise RuntimeError('Reviewed rc.2 archive required')
dest=root/'node_modules'
if dest.exists():raise RuntimeError('Use a fresh test dependency directory')
with archive.open('rb') as f:
 prefix=f.read(16)
 header_size=struct.unpack_from('<I',prefix,4)[0]
 json_size=struct.unpack_from('<I',prefix,12)[0]
 if not 0<json_size<=32*1024*1024 or header_size<json_size:raise RuntimeError('Invalid ASAR')
 tree=json.loads(f.read(json_size))
 index={}
 def walk(node,prefix=''):
  for name,value in node.get('files',{}).items():
   key=prefix+name
   if 'files' in value:walk(value,key+'/')
   else:index[key]=value
 walk(tree)
 rows=[];total=0
 for key,value in index.items():
  if not key.startswith('dsh/node_modules/') or 'link' in value:continue
  relative=key[len('dsh/node_modules/'):]
  if '..' in Path(relative).parts:raise RuntimeError('Invalid path')
  if value.get('unpacked'):
   data=Path(str(archive)+'.unpacked',key).read_bytes()
  else:
   f.seek(8+header_size+int(value['offset']));data=f.read(value['size'])
  total+=len(data)
  if total>500*1024*1024 or len(rows)>50000:raise RuntimeError('Bound exceeded')
  sha=digest(data)
  if value.get('integrity',{}).get('hash') and sha!=value['integrity']['hash']:raise RuntimeError('Integrity mismatch')
  out=dest/relative;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(data)
  rows.append({'path':relative,'sha256':sha})
out=root/'evidence/ui-layout';out.mkdir(parents=True,exist_ok=True)
(out/'sdk.json').write_text(json.dumps({'asarSHA256':actual,'files':rows,'bytes':total},indent=2),encoding='utf-8')
print(json.dumps({'sdkFiles':len(rows),'bytes':total,'asarSHA256':actual}))
