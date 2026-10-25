"""Publication-only integrity checks; no SDK, network, model or user data."""
from pathlib import Path
import hashlib,json,re,unittest
R=Path(__file__).resolve().parents[1]
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
class Release(unittest.TestCase):
 def test_exact_accepted_runtime_fingerprint(self):
  rows=[]
  for d in ['core','adapters','plugin']:
   for p in sorted((R/d).glob('*.mjs')):rows.append([d+'/'+p.name,digest(p)])
  for n in ['single-director','single-writer']:rows.append(['runtime-skills/'+n,digest(R/'runtime-skills'/n/'SKILL.md')])
  self.assertEqual(hashlib.sha256(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'8ce9b4be820feece11bf9dab42c813121e1e99fcb4a17e2d66d70e9ce57d1dbd')
 def test_current_exact_manifest_versions(self):
  for n in ['package.json','packages/scean/package.json','packages/studio/package.json']:
   j=json.loads((R/n).read_text(encoding='utf-8'));self.assertEqual(j['version'],'1.6.2-local.w29.2d.rc3.1');self.assertIn('0.2.1-rc.3',j['engines']['dsh']);self.assertEqual(j['homepage'],'https://github.com/zeola0187/scean')
 def test_canonical_build_and_file_set(self):
  m=json.loads((R/'BUILD-MAP.json').read_text(encoding='utf-8'))['runtime'];self.assertEqual(len(m),263)
  for row in m:self.assertEqual((R/row['path']).read_bytes(),(R/row['source']).read_bytes(),row['path'])
 def test_export_hashes_and_no_private_domains(self):
  m=json.loads((R/'EXPORT-MANIFEST.json').read_text(encoding='utf-8'));paths=[x['path']for x in m['files']];self.assertEqual(len(paths),len(set(paths)))
  forbidden={'.git','node_modules','private','private-assets','evidence','sessions','store','runs','ui-evidence','.integration'}
  for row in m['files']:
   p=Path(row['path']);self.assertFalse(set(p.parts)&forbidden,row['path']);self.assertEqual(digest(R/p),row['sha256']);self.assertEqual((R/p).stat().st_size,row['bytes'])
 def test_no_actual_credentials_or_personal_home_paths(self):
  patterns=[re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[A-Za-z0-9_-]{30,})'),re.compile(r'(?:[A-Za-z]:[\\/]+Users[\\/]|/Users/|Documents[\\/]Codex|AppData[\\/])',re.I)]
  for row in json.loads((R/'EXPORT-MANIFEST.json').read_text(encoding='utf-8'))['files']:
   try:t=(R/row['path']).read_text(encoding='utf-8')
   except UnicodeError:continue
   # This scanner's own regex is an inert detection rule, not a personal path.
   if row['path']==Path(__file__).relative_to(R).as_posix():continue
   for p in patterns:self.assertIsNone(p.search(t),row['path'])
 def test_necessary_license_bytes(self):
  self.assertEqual(digest(R/'LICENSE'),'0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0')
  for base in ['packages/studio','sources/card-studio/cardstudio-bundle']:
   self.assertIn('Permission is hereby granted',(R/base/'skills/advanced-tavern-card-authoring/SOURCE.txt').read_text(encoding='utf-8'))
 def test_explicit_history_and_prerelease_provenance(self):
  p=json.loads((R/'W29-RELEASE-PROVENANCE.json').read_text(encoding='utf-8'));self.assertEqual(p['targetDsh'],'0.2.1-rc.3');self.assertFalse(p['userDataIncluded']);self.assertFalse(p['hostSdkIncluded']);self.assertEqual(p['paidCallsThisPublication'],0)
if __name__=='__main__':unittest.main()
