"""Negative source-offer checks and real deterministic package inspection."""
from pathlib import Path
import hashlib, importlib.util, json, tarfile, tempfile, unittest

ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
gate=module('release_gate','check-release.py');pack=module('candidate_pack','package-candidate.py')

class Distribution(unittest.TestCase):
 def test_unconfigured_source_stays_on_hold(self):
  c=json.loads((ROOT/'release-source.json').read_text());c['sourceUrl']=None;r=gate.check(c)
  self.assertEqual(r['status'],'HOLD');self.assertIn('PUBLIC_SOURCE_URL_REQUIRED',r['issues']);self.assertFalse(r['publicationPerformed'])
 def test_private_source_is_never_a_public_offer(self):
  c=json.loads((ROOT/'release-source.json').read_text());c['sourceUrl']='https://github.com/zeola0187/scean-dev';self.assertIn('KNOWN_PRIVATE_REPOSITORY_NOT_PUBLIC_SOURCE',gate.check(c)['issues'])
 def test_network_flags_are_required(self):
  c={'license':'AGPL-3.0-only','sourceUrl':'https://synthetic.invalid/source','revision':'1'*40,'sourceArchiveSha256':'2'*64}
  r=gate.check(c);self.assertIn('NONPUBLIC_SOURCE_ENDPOINT',r['issues']);self.assertIn('PROMINENT_NETWORK_SOURCE_OFFER_NOT_VERIFIED',r['issues'])
 def test_credentials_are_rejected(self):
  c=json.loads((ROOT/'release-source.json').read_text());c['sourceUrl']='https://user:password@synthetic.invalid/source?key=fixture';self.assertIn('PUBLIC_SOURCE_URL_INVALID',gate.check(c)['issues'])
 def test_actual_install_packages_keep_all_grants(self):
  with tempfile.TemporaryDirectory(prefix='scean-license-') as tmp:
   a=Path(tmp)/'a';b=Path(tmp)/'b';ra=pack.package(ROOT,a);rb=pack.package(ROOT,b)
   self.assertEqual(ra,rb)
   for row in ra['packages']:
    self.assertEqual((a/row['name']).read_bytes(),(b/row['name']).read_bytes())
    with tarfile.open(a/row['name'],'r:gz') as z:
     data={n:z.extractfile(n).read() for n in z.getnames()}
     self.assertEqual(data['package/LICENSE'],(ROOT/'LICENSE').read_bytes())
     self.assertEqual(json.loads(data['package/package.json'])['license'],'AGPL-3.0-only')
     if row['name']!='scean-scean-candidate.tgz':
      mit=[v for n,v in data.items() if n.endswith('/advanced-tavern-card-authoring/SOURCE.txt')]
      self.assertTrue(mit);self.assertTrue(all(b'Copyright (c) 2026 Card Studio contributors' in x and b'Permission is hereby granted' in x for x in mit))
 def test_memory_provenance_is_qualified(self):
  j=json.loads((ROOT/'licenses/zeolas-source-snippets.json').read_text());q=j['provenanceQualification'];self.assertIn('not established',q['authorshipConclusion']);self.assertIn('not a release blocker',q['missingEvidence']);self.assertTrue((ROOT/'core/memory.mjs').read_text().startswith('// SPDX-License-Identifier: AGPL-3.0-only'))

if __name__=='__main__':unittest.main()
