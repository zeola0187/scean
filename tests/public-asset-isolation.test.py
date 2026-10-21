"""Publication boundaries use synthetic canaries; no private source is required."""
from pathlib import Path
import hashlib, importlib.util, json, subprocess, sys, tarfile, tempfile, unittest

ROOT=Path(__file__).resolve().parents[1]

class PublicAssetIsolation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest=json.loads((ROOT/'EXPORT-MANIFEST.json').read_text('utf-8'))
        cls.names={r['path'] for r in cls.manifest['files']}

    def test_private_assets_are_outside_source_and_package_allowlists(self):
        for name in self.names:
            self.assertFalse(any(p in {'private-assets','.git','node_modules','.dsh','backups','diagnosis'} for p in Path(name).parts),name)
            self.assertNotIn('original-preset',name)
            self.assertNotIn('.private.',name)
            self.assertFalse(name.endswith('.ttskill'),name)
        for name in ['package.json','packages/scean/package.json','packages/studio/package.json']:
            patterns=json.loads((ROOT/name).read_text('utf-8'))['files']
            self.assertNotIn('private-assets',patterns)
            self.assertNotIn('*',patterns)

    def test_clean_export_ignores_unlisted_private_canary(self):
        with tempfile.TemporaryDirectory(prefix='scean-publish-isolation-') as temporary:
            base=Path(temporary);src=base/'input';src.mkdir()
            (src/'safe.txt').write_text('synthetic public input',encoding='utf-8')
            private=src/'private-assets/third-party/synthetic';private.mkdir(parents=True)
            (private/'SKILL.md').write_text('SYNTHETIC_PRIVATE_CANARY_DO_NOT_EXPORT',encoding='utf-8')
            data=(src/'safe.txt').read_bytes()
            (src/'EXPORT-MANIFEST.json').write_text(json.dumps({'files':[{'path':'safe.txt','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}]}),encoding='utf-8')
            subprocess.run([sys.executable,str(ROOT/'tools/export-clean.py'),'--source',str(src),'--output',str(base/'out')],check=True,capture_output=True)
            files={p.relative_to(base/'out').as_posix() for p in (base/'out').rglob('*') if p.is_file()}
            self.assertEqual(files,{'safe.txt','EXPORT-MANIFEST.json'})
            self.assertNotIn(b'SYNTHETIC_PRIVATE_CANARY_DO_NOT_EXPORT',b''.join(p.read_bytes() for p in (base/'out').rglob('*') if p.is_file()))

    def test_all_installation_archives_only_contain_reviewed_public_inputs(self):
        spec=importlib.util.spec_from_file_location('isolation_pack',ROOT/'scripts/package-candidate.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='scean-publish-pack-') as temporary:
            projected=Path(temporary)/'projection';projected.mkdir()
            config=ROOT/'docs/private-release-sync/public-projection.json'
            overrides=json.loads(config.read_text('utf-8'))['overrides'] if config.exists() else {}
            for row in self.manifest['files']:
                target=projected/row['path'];target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes((ROOT/overrides.get(row['path'],row['path'])).read_bytes())
            (projected/'EXPORT-MANIFEST.json').write_bytes((ROOT/'EXPORT-MANIFEST.json').read_bytes())
            out=Path(temporary)/'packages';report=module.package(projected,out)
            for row in report['packages']:
                with tarfile.open(out/row['name'],'r:gz') as archive:
                    for member in archive:
                        self.assertTrue(member.isfile())
                        name=member.name.removeprefix('package/')
                        prefix={'scean-suite-candidate.tgz':'','scean-scean-candidate.tgz':'packages/scean/','scean-studio-candidate.tgz':'packages/studio/'}[row['name']]
                        self.assertIn(prefix+name,self.names)
                        self.assertNotIn('private-assets',name)
                        self.assertFalse(name.endswith('.ttskill'))

if __name__=='__main__':unittest.main()
