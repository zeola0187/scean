"""Release support contracts: no external calls or installed-user data."""
from pathlib import Path
import hashlib,importlib.util,json,re,unittest
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('release_check',ROOT/'scripts/check-release.py');gate=importlib.util.module_from_spec(s);s.loader.exec_module(gate)
class ReleaseSupport(unittest.TestCase):
 def test_private_rename_aliases_are_rejected(self):
  base={'license':'AGPL-3.0-only','revision':'1'*40,'sourceArchiveSha256':'2'*64,'anonymousSourceAccessVerified':True,'networkSourceNoticeReady':True}
  for suffix in ['scean-dev','SCEAN-DEV.git','scean%2Ddev/tree/main']:
   c={**base,'sourceUrl':'https://github.com/zeola0187/'+suffix};self.assertIn('KNOWN_PRIVATE_REPOSITORY_NOT_PUBLIC_SOURCE',gate.check(c)['issues'])
 def test_public_source_is_distinct_from_private_development(self):
  c={'license':'AGPL-3.0-only','sourceUrl':'https://github.com/zeola0187/scean/tree/v1.4.1','revision':'1'*40,'sourceArchiveSha256':'2'*64,'anonymousSourceAccessVerified':True,'networkSourceNoticeReady':True}
  self.assertEqual(gate.check(c)['issues'],[])
 def test_visible_offer_and_detached_receipt(self):
  j=json.loads((ROOT/'release-source.json').read_text());url='https://github.com/zeola0187/scean/tree/v1.4.1';self.assertEqual(j['sourceUrl'],url);self.assertIsNone(j['sourceArchiveSha256']);self.assertEqual(gate.check(j)['status'],'HOLD')
  self.assertIn(url,(ROOT/'isolated/web/index.html').read_text(encoding='utf-8'));self.assertIn('studio-source-offer',(ROOT/'sources/card-studio/cardstudio-bundle/client-template.js').read_text(encoding='utf-8'))
 def test_package_identity_version_and_development_commands(self):
  for n,name in [('package.json','@local/dsh-scean-suite'),('packages/scean/package.json','@local/dsh-scean'),('packages/studio/package.json','@local/dsh-card-studio-scean-test')]:
   j=json.loads((ROOT/n).read_text());self.assertEqual(j['name'],name);self.assertEqual(j['version'],'1.4.1');self.assertEqual(j['license'],'AGPL-3.0-only');self.assertEqual(j['homepage'],'https://github.com/zeola0187/scean')
   if n!='package.json':self.assertNotIn('scripts',j)
  self.assertGreater((1,4,1),(1,3,0))
  self.assertEqual((ROOT/'cordis.patch.yml').read_text(),'- insert:\n    - id: local-scean-host\n      name: ./packages/scean/plugin/index.js\n      config: {}\n    - id: local-cardstudio-scean-workspace-loader\n      name: ./packages/studio/index.js\n      config: {}\n')
 def test_included_docs_have_no_broken_local_links(self):
  for p in [ROOT/'README.md',*(ROOT/'docs').glob('*.md')]:
   for target in re.findall(r'\]\(([^)]+)\)',p.read_text(encoding='utf-8')):
    if ':' in target or target.startswith('#'):continue
    target=target.split('#')[0]
    if target:self.assertTrue((p.parent/target).exists(),str(p.relative_to(ROOT))+': '+target)
 def test_current_document_commands_are_shipped(self):
  for p in [ROOT/'README.md',*(ROOT/'docs').glob('*.md')]:
   for n in re.findall(r'(?<![\w./])scripts/[\w.-]+\.(?:py|mjs|cjs|ps1)',p.read_text(encoding='utf-8')):self.assertTrue((ROOT/n).is_file(),str(p.relative_to(ROOT))+': '+n)
 def test_necessary_license_and_original_opening_bytes_remain(self):
  self.assertEqual(hashlib.sha256((ROOT/'LICENSE').read_bytes()).hexdigest(),'0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0')
  for base in ['sources/card-studio/cardstudio-bundle','packages/studio']:
   mit=(ROOT/base/'skills/advanced-tavern-card-authoring/SOURCE.txt').read_text();self.assertIn('Copyright (c) 2026 Card Studio contributors',mit);self.assertIn('Permission is hereby granted',mit)
   skill=ROOT/base/'skills/scean-opening-authoring';j=json.loads((skill/'SOURCE.json').read_text())
   for n,digest in j['files'].items():self.assertEqual(hashlib.sha256((skill/n).read_bytes()).hexdigest(),digest,n)
 def test_private_assessment_is_not_an_export(self):
  self.assertFalse((ROOT/'PRIVATE-USE-NOTICE.md').exists())
  m=json.loads((ROOT/'EXPORT-MANIFEST.json').read_text());self.assertNotIn('PRIVATE-USE-NOTICE.md',[x['path'] for x in m['files']]);self.assertNotIn('PRIVATE-USE-NOTICE.md',json.loads((ROOT/'package.json').read_text())['files'])
if __name__=='__main__':unittest.main()
