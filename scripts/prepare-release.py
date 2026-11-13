"""Prepare deterministic local release files from the audited source manifest.

This command never installs, uploads, merges, creates tags or changes Latest.
The public-source attestation deliberately remains on hold.
"""
from pathlib import Path, PurePosixPath
import argparse
import fnmatch
import gzip
import hashlib
import io
import json
import re
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sha = lambda value: hashlib.sha256(value).hexdigest()

def read_payload(source):
    spec = json.loads((source / 'EXPORT-MANIFEST.json').read_text(encoding='utf-8'))
    payload = {}
    for row in spec['files']:
        raw = row['path']
        rel = PurePosixPath(raw)
        if not raw or rel.is_absolute() or '..' in rel.parts or str(rel) != raw or '\\' in raw or ':' in raw or raw in payload:
            raise ValueError('Unsafe or duplicate source path')
        blocked = {'.git', 'node_modules', 'private', '.test-home', '.test-data', '.integration', 'profiles', 'sessions', 'runs'}
        if any(part.casefold() in blocked or part.casefold().startswith(('.credentials', '.env')) for part in rel.parts) or rel.suffix.casefold() in {'.db', '.sqlite', '.sqlite3', '.asar', '.zstd', '.pid', '.log'}:
            raise ValueError('Private or runtime data in source manifest')
        p = source.joinpath(*rel.parts)
        if not p.resolve().is_relative_to(source) or p.is_symlink():
            raise ValueError('Linked/escaped source input')
        for ancestor in [p, *p.parents]:
            if ancestor == source.parent:
                break
            if getattr(ancestor.lstat(), 'st_file_attributes', 0) & 0x400:
                raise ValueError('Reparse-point source input')
        data = p.read_bytes()
        if sha(data) != row['sha256'] or len(data) != row['bytes']:
            raise ValueError('Input hash mismatch: ' + raw)
        payload[raw] = data
    payload['EXPORT-MANIFEST.json'] = (source / 'EXPORT-MANIFEST.json').read_bytes()
    return payload

def tar_bytes(payload):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w', format=tarfile.PAX_FORMAT) as archive:
        for name, data in sorted(payload.items()):
            info = tarfile.TarInfo('package/' + name)
            info.size = len(data)
            info.mtime = 0
            info.mode = 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            archive.addfile(info, io.BytesIO(data))
    out = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=out, mtime=0, compresslevel=9) as compressed:
        compressed.write(raw.getvalue())
    return out.getvalue()

def prepare(output, revision=None):
    source = ROOT.resolve()
    output = Path(output).resolve()
    if output.exists() or output == source or source in output.parents:
        raise ValueError('Use a fresh output directory outside the source tree')
    if revision is not None and not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Prepared source revision must be an exact Git SHA')
    payload = read_payload(source)
    version = json.loads(payload['package.json'])['version']
    output.mkdir(parents=True)
    records = []
    required = ['LICENSE', 'COPYRIGHT', 'LICENSE-SCOPE.md', 'THIRD-PARTY-LICENSES.json',
                'SOURCE-AVAILABILITY.md', 'release-source.json']
    for label, prefix in [('suite', ''), ('runtime', 'packages/scean/'), ('studio', 'packages/studio/'),
                          ('guard', 'addons/openrouter-output-default/')]:
        metadata = json.loads(payload[prefix + 'package.json'])
        selected = {}
        for path, data in payload.items():
            if not path.startswith(prefix):
                continue
            relative = path[len(prefix):]
            if relative == 'package.json' or any(relative == p or relative.startswith(p.rstrip('/') + '/') or fnmatch.fnmatchcase(relative, p)
                                                 for p in metadata['files']):
                selected[relative] = data
        if any(name not in selected for name in required):
            raise ValueError('Missing source/license payload: ' + label)
        if label == 'suite' and any(name.startswith('addons/') for name in selected):
            raise ValueError('Guard must remain separately installed')
        name = ('SCEAN-OpenRouter-output-default-' + metadata['version'] + '.tgz' if label == 'guard'
                else 'SCEAN-' + version + '-' + label + '.tgz')
        data = tar_bytes(selected)
        (output / name).write_bytes(data)
        records.append({'name': name, 'sha256': sha(data), 'bytes': len(data), 'files': len(selected),
                        'package': metadata['name'], 'version': metadata['version']})
    name = 'SCEAN-' + version + '-source.zip'
    with zipfile.ZipFile(output / name, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path, data in sorted(payload.items()):
            info = zipfile.ZipInfo('SCEAN-' + version + '-source/' + path, (2026, 11, 13, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    source_data = (output / name).read_bytes()
    records.append({'name': name, 'sha256': sha(source_data), 'bytes': len(source_data), 'files': len(payload)})
    offer = json.loads(payload['release-source.json'])
    receipt = {
        'schemaVersion': 1, 'status': 'LOCAL_FILES_PREPARED_PUBLICATION_ON_HOLD',
        'version': version, 'license': 'AGPL-3.0-only', 'sourceUrl': offer['sourceUrl'],
        'revision': revision, 'sourceArchiveSha256': sha(source_data),
        'sourceManifestSha256': sha(payload['EXPORT-MANIFEST.json']),
        'anonymousSourceAccessVerified': False, 'networkSourceNoticeReady': False,
        'publicationPerformed': False, 'userDataIncluded': False, 'hostSdkIncluded': False,
        'paidModelCalls': 0, 'guardAutomaticallyInstalled': False, 'assets': records,
        'localVerification': json.loads(payload['RELEASE-VERIFICATION.json']),
        'note': 'Prepared source and packages only. Exact public source access, tag/release publication and remote attachment hashes require separate authorization and verification.'
    }
    receipt_name = 'SCEAN-' + version + '-source-receipt.json'
    data = (json.dumps(receipt, indent=2) + '\n').encode('utf-8')
    (output / receipt_name).write_bytes(data)
    sums = records + [{'name': receipt_name, 'sha256': sha(data)}]
    (output / 'SHA256SUMS.txt').write_text(''.join(row['sha256'] + '  ' + row['name'] + '\n' for row in sums), encoding='utf-8')
    return receipt

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--revision')
    args = parser.parse_args()
    print(json.dumps(prepare(args.output, args.revision), indent=2))
