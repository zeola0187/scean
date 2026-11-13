"""Actual fixed-package inspection and negative export-boundary checks."""
from pathlib import Path
import hashlib
import importlib.util
import json
import tarfile
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepared_release', ROOT / 'scripts/prepare-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class PreparedRelease(unittest.TestCase):
    def test_complete_packages_are_deterministic_and_keep_source_and_grants(self):
        with tempfile.TemporaryDirectory(prefix='scean-prepared-') as directory:
            temp = Path(directory).resolve()
            self.assertTrue(temp.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            first = release.prepare(temp / 'a')
            second = release.prepare(temp / 'b')
            self.assertEqual(first, second)
            self.assertFalse(first['publicationPerformed'])
            self.assertFalse(first['anonymousSourceAccessVerified'])
            for row in first['assets']:
                data = (temp / 'a' / row['name']).read_bytes()
                self.assertEqual(data, (temp / 'b' / row['name']).read_bytes())
                self.assertEqual(hashlib.sha256(data).hexdigest(), row['sha256'])
                if row['name'].endswith('.tgz'):
                    with tarfile.open(temp / 'a' / row['name']) as archive:
                        names = archive.getnames()
                        self.assertTrue(all(member.isfile() for member in archive.getmembers()))
                        self.assertIn('package/LICENSE', names)
                        self.assertIn('package/SOURCE-AVAILABILITY.md', names)
                        self.assertFalse(any('/node_modules/' in name or '/profiles/' in name for name in names))
                        if row.get('package') == '@local/dsh-scean-suite':
                            self.assertFalse(any(name.startswith('package/addons/') for name in names))
                        if row.get('package') == '@local/dsh-scean-openrouter-output-default':
                            self.assertEqual(json.load(archive.extractfile('package/package.json'))['version'], '0.1.0-local.5')
                            self.assertIn('package/THIRD-PARTY-NOTICES.md', names)
                else:
                    with zipfile.ZipFile(temp / 'a' / row['name']) as archive:
                        names = archive.namelist()
                        self.assertTrue(any(name.endswith('/scripts/prepare-release.py') for name in names))
                        self.assertTrue(any(name.endswith('/addons/openrouter-output-default/guard.mjs') for name in names))
                        self.assertFalse(any('/node_modules/' in name or '/.git/' in name for name in names))

    def test_unsafe_and_private_manifest_paths_are_rejected_before_reading(self):
        with tempfile.TemporaryDirectory(prefix='scean-export-negative-') as directory:
            root = Path(directory).resolve()
            self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            for path in ['../escape', '/absolute', 'Private/value.json', 'node_modules/sdk.js', '.credentials.yaml', '.env.local', 'story.sqlite', 'profile/session.zstd']:
                (root / 'EXPORT-MANIFEST.json').write_text(json.dumps({'files':[{'path':path,'sha256':'0'*64,'bytes':0}]}))
                with self.assertRaises(ValueError, msg=path):
                    release.read_payload(root)

    def test_changed_pinned_input_is_refused(self):
        with tempfile.TemporaryDirectory(prefix='scean-export-drift-') as directory:
            root = Path(directory).resolve()
            self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            (root / 'source.txt').write_bytes(b'changed')
            (root / 'EXPORT-MANIFEST.json').write_text(json.dumps({'files':[{'path':'source.txt','sha256':hashlib.sha256(b'original').hexdigest(),'bytes':8}]}))
            with self.assertRaisesRegex(ValueError, 'Input hash mismatch'):
                release.read_payload(root)

if __name__ == '__main__':
    unittest.main()
