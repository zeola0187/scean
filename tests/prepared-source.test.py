from pathlib import Path
import importlib.util
import hashlib
import json
import tempfile
import zipfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('source_proof',ROOT/'scripts/check-prepared-source.py')
proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)
URL='https://github.com/zeola0187/scean/tree/vsynthetic-version'
def notices():
    player=(f'<p id="scean-source-offer"><a href="{URL}">Source</a></p>').encode()
    studio=("h('p',{id:'studio-source-offer'},'SCEAN · AGPL-3.0-only · ',h('a',{href:'"+URL+"'}))").encode()
    return {**{name:player for name in ['isolated/web/index.html','plugin/client.js','packages/scean/plugin/client.js']},
      **{name:studio for name in ['sources/card-studio/cardstudio-bundle/client-template.js','sources/card-studio/cardstudio-bundle/client.js','packages/studio/client-template.js','packages/studio/client.js']}}
class SourceNotices(unittest.TestCase):
    def test_all_seven_actual_notice_locations_must_point_to_exact_source(self):
        self.assertEqual(proof.check_notices(notices(),URL),7)
    def test_wrong_player_destination_is_refused(self):
        files=notices();files['plugin/client.js']=files['plugin/client.js'].replace(URL.encode(),b'https://example.invalid/old')
        with self.assertRaisesRegex(proof.SourceProofError,'PLAYER_SOURCE_NOTICE_TARGET_MISMATCH'):proof.check_notices(files,URL)
    def test_wrong_studio_destination_is_refused(self):
        files=notices();files['packages/studio/client.js']=files['packages/studio/client.js'].replace(URL.encode(),b'https://example.invalid/old')
        with self.assertRaisesRegex(proof.SourceProofError,'STUDIO_SOURCE_NOTICE_TARGET_MISMATCH'):proof.check_notices(files,URL)
    def test_stale_version_label_is_refused(self):
        files=notices();files['packages/studio/client.js']=files['packages/studio/client.js'].replace('SCEAN'.encode(),b'1.5.0')
        with self.assertRaisesRegex(proof.SourceProofError,'STALE_STUDIO_SOURCE_LABEL'):proof.check_notices(files,URL)
    def test_receipt_cannot_escape_its_asset_directory(self):
        with tempfile.TemporaryDirectory(prefix='scean-source-proof-') as directory:
            root=Path(directory).resolve();self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            receipt={'license':'AGPL-3.0-only','version':'synthetic-version','revision':'1'*40,'sourceUrl':URL,
                     'assets':[{'name':'../escape-source.zip','bytes':0,'sha256':'0'*64}]}
            path=root/'receipt.json';path.write_text(json.dumps(receipt))
            with self.assertRaisesRegex(proof.SourceProofError,'ASSET_PATH_INVALID'):proof.check(path)
    def test_archive_hash_must_match_detached_source_hash(self):
        with tempfile.TemporaryDirectory(prefix='scean-source-proof-') as directory:
            root=Path(directory).resolve();self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            data=b'no decompression is permitted before hash verification';name='synthetic-source.zip';(root/name).write_bytes(data)
            receipt={'license':'AGPL-3.0-only','version':'synthetic-version','revision':'1'*40,'sourceUrl':URL,'sourceArchiveSha256':'0'*64,
                     'assets':[{'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}]}
            path=root/'receipt.json';path.write_text(json.dumps(receipt))
            with self.assertRaisesRegex(proof.SourceProofError,'CORRESPONDING_SOURCE_ARCHIVE_HASH_MISMATCH'):proof.check(path)
    def test_local_verification_never_claims_external_attestations(self):
        with tempfile.TemporaryDirectory(prefix='scean-source-proof-') as directory:
            root=Path(directory).resolve();self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            files=notices();files['package.json']=json.dumps({'version':'synthetic-version'}).encode()
            manifest=json.dumps({'files':[{'path':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)} for name,data in files.items()]}).encode()
            files['EXPORT-MANIFEST.json']=manifest;name='synthetic-source.zip'
            with zipfile.ZipFile(root/name,'w') as archive:
                for path,data in files.items():archive.writestr('SCEAN-synthetic-version-source/'+path,data)
            data=(root/name).read_bytes();sha=hashlib.sha256(data).hexdigest()
            receipt={'license':'AGPL-3.0-only','version':'synthetic-version','revision':'1'*40,'sourceUrl':URL,
              'sourceArchiveSha256':sha,'sourceManifestSha256':hashlib.sha256(manifest).hexdigest(),
              'anonymousSourceAccessVerified':True,'networkSourceNoticeReady':True,
              'assets':[{'name':name,'bytes':len(data),'sha256':sha}]}
            path=root/'receipt.json';path.write_text(json.dumps(receipt));result=proof.check(path)
            self.assertFalse(result['anonymousSourceAccessVerified']);self.assertFalse(result['networkSourceNoticeReady'])
            self.assertFalse(result['gitRevisionVerified']);self.assertEqual(result['sourceNoticeTargetsVerified'],7)
if __name__=='__main__':unittest.main()
