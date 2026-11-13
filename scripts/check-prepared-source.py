"""Verify local corresponding-source proof without publishing or claiming network checks."""
from pathlib import Path, PurePosixPath
from html.parser import HTMLParser
import argparse
import hashlib
import importlib.util
import json
import re
import stat
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parents[1]
class SourceProofError(ValueError):
    pass
def require(value,code):
    if not value:
        raise SourceProofError(code)
def digest(value):
    return hashlib.sha256(value).hexdigest()
class NoticeParser(HTMLParser):
    def __init__(self):
        super().__init__();self.active=False;self.links=[]
    def handle_starttag(self,tag,attrs):
        values=dict(attrs)
        if tag=='p' and values.get('id')=='scean-source-offer':self.active=True
        if self.active and tag=='a':self.links.append(values.get('href'))
    def handle_endtag(self,tag):
        if tag=='p':self.active=False
def check_notices(files,url):
    for name in ['isolated/web/index.html','plugin/client.js','packages/scean/plugin/client.js']:
        parser=NoticeParser();parser.feed(files[name].decode('utf-8').replace('\\"','"'))
        require(parser.links==[url],'PLAYER_SOURCE_NOTICE_TARGET_MISMATCH:'+name)
    for name in ['sources/card-studio/cardstudio-bundle/client-template.js','sources/card-studio/cardstudio-bundle/client.js',
                 'packages/studio/client-template.js','packages/studio/client.js']:
        text=files[name].decode('utf-8')
        match=re.search(r"id:'studio-source-offer'\},'([^']*)',h\('a',\{href:'([^']*)'",text)
        require(match and match.group(2)==url,'STUDIO_SOURCE_NOTICE_TARGET_MISMATCH:'+name)
        require('AGPL-3.0-only' in match.group(1) and 'SCEAN' in match.group(1),'STALE_STUDIO_SOURCE_LABEL:'+name)
    return 7
def check(receipt_path,repository=None):
    receipt_path=Path(receipt_path).resolve();require(receipt_path.stat().st_size<=1024*1024,'RECEIPT_TOO_LARGE');receipt=json.loads(receipt_path.read_text(encoding='utf-8'))
    require(receipt.get('license')=='AGPL-3.0-only','SOURCE_LICENSE_MISMATCH')
    version=receipt.get('version','');revision=receipt.get('revision','')
    require(re.fullmatch(r'[A-Za-z0-9.-]+',version),'SOURCE_VERSION_INVALID')
    require(re.fullmatch(r'[0-9a-f]{40}',str(revision)),'EXACT_SOURCE_REVISION_REQUIRED')
    url='https://github.com/zeola0187/scean/tree/v'+version
    require(receipt.get('sourceUrl')==url,'IMMUTABLE_SOURCE_URL_MISMATCH')
    archives=[row for row in receipt.get('assets',[]) if row['name'].endswith('-source.zip')]
    require(len(archives)==1,'EXACTLY_ONE_SOURCE_ARCHIVE_REQUIRED')
    require(1<=len(receipt['assets'])<=16 and len({row['name'] for row in receipt['assets']})==len(receipt['assets']),'ASSET_COUNT_OR_DUPLICATE')
    for row in receipt['assets']:
        require(Path(row['name']).name==row['name'] and '/' not in row['name'] and '\\' not in row['name'],'ASSET_PATH_INVALID')
        require(isinstance(row['bytes'],int) and 0<=row['bytes']<=256*1024*1024,'ASSET_SIZE_INVALID')
        require((receipt_path.parent/row['name']).stat().st_size==row['bytes'],'ASSET_SIZE_MISMATCH')
        content=(receipt_path.parent/row['name']).read_bytes()
        require(digest(content)==row['sha256'] and len(content)==row['bytes'],'ASSET_HASH_MISMATCH:'+row['name'])
    source=receipt_path.parent/archives[0]['name']
    require(digest(source.read_bytes())==receipt['sourceArchiveSha256'],'CORRESPONDING_SOURCE_ARCHIVE_HASH_MISMATCH')
    files={};prefix='SCEAN-'+version+'-source/'
    with zipfile.ZipFile(source) as archive:
        require(len(archive.infolist())<=20000 and sum(item.file_size for item in archive.infolist())<=256*1024*1024,'SOURCE_ARCHIVE_LIMIT')
        for item in archive.infolist():
            require(item.file_size<=64*1024*1024,'SOURCE_FILE_SIZE_LIMIT')
            require(item.filename.startswith(prefix),'SOURCE_ARCHIVE_PREFIX_MISMATCH')
            name=item.filename[len(prefix):];rel=PurePosixPath(name)
            require(name and str(rel)==name and not rel.is_absolute() and '..' not in rel.parts and '\\' not in name and ':' not in name,'SOURCE_ARCHIVE_PATH_INVALID')
            require(name not in files and not item.is_dir() and not stat.S_ISLNK(item.external_attr>>16),'SOURCE_ARCHIVE_DUPLICATE_OR_LINK')
            files[name]=archive.read(item)
    manifest=files['EXPORT-MANIFEST.json'];require(digest(manifest)==receipt['sourceManifestSha256'],'SOURCE_MANIFEST_HASH_MISMATCH')
    rows=json.loads(manifest)['files'];require(set(files)=={row['path'] for row in rows}|{'EXPORT-MANIFEST.json'},'SOURCE_ARCHIVE_FILE_SET_MISMATCH')
    for row in rows:
        require(digest(files[row['path']])==row['sha256'] and len(files[row['path']])==row['bytes'],'SOURCE_FILE_HASH_MISMATCH:'+row['path'])
    require(json.loads(files['package.json'])['version']==version,'PACKAGE_SOURCE_VERSION_MISMATCH')
    notices=check_notices(files,url)
    revision_verified=False
    if repository is not None:
        tree=subprocess.check_output(['git','-C',str(repository),'ls-tree','-rz','--full-tree',revision])
        blobs={}
        for row in tree.split(b'\0'):
            if not row:continue
            info,name=row.split(b'\t',1);mode,kind,sha=info.split()
            require(kind==b'blob' and mode in [b'100644',b'100755'],'GIT_SOURCE_TREE_TYPE_INVALID')
            blobs[name.decode('utf-8')]=sha.decode()
        require(set(files)==set(blobs),'GIT_SOURCE_FILE_SET_MISMATCH')
        for name,data in files.items():
            require(hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==blobs[name],'GIT_SOURCE_BLOB_MISMATCH:'+name)
        revision_verified=True
    return {'status':'LOCAL_SOURCE_PROOF_COMPLETE_PUBLICATION_STILL_ON_HOLD' if revision_verified else 'LOCAL_ARCHIVE_PROOF_COMPLETE_REVISION_LOOKUP_NOT_PERFORMED','revision':revision,
      'sourceArchiveSha256':receipt['sourceArchiveSha256'],'sourceFilesVerified':len(files),
      'sourceManifestVerified':True,'gitRevisionVerified':revision_verified,'sourceNoticeTargetsVerified':notices,
      'assetsVerified':len(receipt['assets']),'networkAccessPerformed':False,'publicMutationPerformed':False,
      'anonymousSourceAccessVerified':False,'networkSourceNoticeReady':False,
      'remaining':['Anonymous access to the exact new public tag/source archive','Rendered source notice and its live public destination after authorized publication']}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--receipt',required=True);parser.add_argument('--repository',type=Path)
    args=parser.parse_args();print(json.dumps(check(args.receipt,args.repository),indent=2))
