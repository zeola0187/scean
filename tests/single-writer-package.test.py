"""Run against a reviewed clean source projection; no SDK, provider or install."""
from pathlib import Path
import hashlib, importlib.util, io, json, tarfile, tempfile, unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('single_writer_pack',ROOT/'scripts/package-candidate.py')
pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack)

class SingleWriterPackages(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temporary=tempfile.TemporaryDirectory(prefix='scean-single-package-')
  cls.out=Path(cls.temporary.name)/'packages'
  cls.report=pack.package(ROOT,cls.out)
 @classmethod
 def tearDownClass(cls):cls.temporary.cleanup()
 def payload(self,name):
  with tarfile.open(self.out/name,'r:gz') as archive:
   self.assertTrue(all(m.isfile() and m.name.startswith('package/') for m in archive))
   return {m.name.removeprefix('package/'):archive.extractfile(m).read() for m in archive}
 def test_standalone_runtime_contains_all_four_fixed_methods(self):
  files=self.payload('scean-scean-candidate.tgz')
  for name in ['scene-materials','scene-writing','single-director','single-writer']:
   key='runtime-skills/'+name+'/SKILL.md'
   self.assertIn(key,files)
   self.assertEqual(files[key],(ROOT/key).read_bytes())
  self.assertIn('runtime-skills',json.loads(files['package.json'])['files'])
 def test_suite_preserves_every_built_runtime_input_including_methods(self):
  files=self.payload('scean-suite-candidate.tgz')
  mapping=json.loads((ROOT/'BUILD-MAP.json').read_text('utf8'))['runtime']
  for row in mapping:
   self.assertIn(row['path'],files)
   self.assertEqual(hashlib.sha256(files[row['path']]).hexdigest(),hashlib.sha256((ROOT/row['source']).read_bytes()).hexdigest(),row['path'])

if __name__=='__main__':unittest.main()
