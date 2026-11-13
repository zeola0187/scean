"""Offline root/subdirectory package installation and permission-fenced native SDK smoke."""
from pathlib import Path
import hashlib, json, os, shutil, subprocess, tempfile, tarfile

ROOT=Path(__file__).resolve().parents[1]
BASE=Path(tempfile.mkdtemp(prefix='cardstudio-portable-pack-',dir=ROOT))
NPM=shutil.which('npm.cmd');NODE=shutil.which('node')
assert NPM and NODE
# Do not read a user's npm credentials/configuration or pass model secrets.
env={key:value for key,value in os.environ.items() if key.upper() in {'SYSTEMROOT','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS'}}
for name in ['user.npmrc','global.npmrc']:(BASE/name).write_text('',encoding='utf-8')
env.update({'NPM_CONFIG_USERCONFIG':str(BASE/'user.npmrc'),'NPM_CONFIG_GLOBALCONFIG':str(BASE/'global.npmrc'),'NPM_CONFIG_CACHE':str(BASE/'cache'),'NPM_CONFIG_UPDATE_NOTIFIER':'false','DSH_HOME':str(BASE/'Clean Windows user 空白'/'Harness Home')})
def run(args,cwd=ROOT):
    result=subprocess.run(args,cwd=cwd,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
    if result.returncode:raise RuntimeError('Command failed: '+str(args[0])+'\n'+result.stdout+'\n'+result.stderr)
    return result.stdout
def hashes(root):
    return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
def package(source,destination):
    destination.mkdir()
    rows=json.loads(run([NPM,'pack','--offline','--ignore-scripts','--json','--pack-destination',str(destination)],source))
    row=rows[0];archive=destination/row['filename'];names={x['path'] for x in row['files']}
    prefix='cardstudio-bundle/' if source==ROOT else ''
    expected={prefix+x for x in ['index.js','client.js','cordis.patch.yml','package.json','README.md','THIRD-PARTY-NOTICES.txt']}
    expected.update(prefix+p.relative_to(ROOT/'cardstudio-bundle').as_posix() for folder in ['lib','locale','skills'] for p in (ROOT/'cardstudio-bundle'/folder).rglob('*') if p.is_file())
    if prefix:expected.update({'package.json','README.md'})
    assert names==expected,{'unexpected':sorted(names-expected),'missing':sorted(expected-names)}
    with tarfile.open(archive,'r:gz') as tar:
        for member in tar.getmembers():
            assert member.isfile() and member.name.startswith('package/') and '..' not in Path(member.name).parts
            if member.name.endswith(('.js','.json','.yml')) and '/skills/' not in member.name:
                data=tar.extractfile(member).read().decode('utf-8')
                assert 'E:\\' not in data and 'E:/' not in data and 'C:' + chr(92) + 'Users' + chr(92) not in data,member.name
    return archive,{'files':sorted(names),'fileCount':len(names),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
def worker(profile,phase):
    package_root=profile/'node_modules/@local/dsh-card-studio'
    Path(env['DSH_HOME']).mkdir(parents=True,exist_ok=True)
    allowed=[ROOT/'tests',ROOT/'cardstudio-test-runtime',package_root,Path(env['DSH_HOME'])]
    command=[NODE,'--permission',*[f'--allow-fs-read={p}' for p in allowed],f"--allow-fs-write={env['DSH_HOME']}",'--import',(ROOT/'tests/bootstrap.js').as_uri(),str(ROOT/'tests/portable-package-worker.js'),str(package_root),phase]
    output=run(command);return json.loads(output.strip().splitlines()[-1])
def data_hashes():
    root=Path(env['DSH_HOME'])/'card-studio/workspace'
    return {k:v for k,v in hashes(root).items() if k!='.cardstudio/runtime-status.json'}
try:
    root_archive,root_audit=package(ROOT,BASE/'root-package')
    child_archive,child_audit=package(ROOT/'cardstudio-bundle',BASE/'child-package')
    profile=BASE/'profile';profile.mkdir();(profile/'package.json').write_text('{"name":"synthetic-dsh-profile","private":true}',encoding='utf-8')
    phases=[]
    for archive,phase in [(root_archive,'first'),(child_archive,'subdirectory-upgrade'),(root_archive,'root-rollback'),(root_archive,'reinstall')]:
        before=data_hashes() if phase!='first' else None
        # Real package extraction/dependency installation, offline and without lifecycle scripts.
        run([NPM,'install','--prefix',str(profile),'--offline','--ignore-scripts','--no-audit','--no-fund',str(archive)])
        package_root=profile/'node_modules/@local/dsh-card-studio';assets_before=hashes(package_root)
        phases.append(worker(profile,phase));assert hashes(package_root)==assets_before,'Plugin mutated its installed assets'
        if before is not None:assert data_hashes()==before,'Installation/reload changed existing user data'
    report={'version':json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version'],'platform':'Windows','dshFixtureVersion':'0.2.0-rc.2','installation':'Actual offline npm tarball installation into a fresh synthetic profile; root and legacy subdirectory entry packages','host':'Actual DSH Cordis, WorkspaceRegistry, DomainFacility, tools and skill registry; synthetic JSON storage medium and agent identity','phases':phases,'rootPackage':root_audit,'subdirectoryPackage':child_audit,'mutableDataPreserved':True,'sourceOriginalHashes':25,'references':phases[0]['references'],'modelCalls':0,'liveDesktopTouched':False,'privateGithubInstallTested':False,'limitations':['No fresh OS/VM or authenticated private GitHub fetch','SDK/services are extracted official fixtures; no live Desktop transport or credentials','Rollback means root/subdirectory package-layout rollback with the same candidate data engine; sealed v0.1.2 is unchanged and its live downgrade is not exercised']}
    baseline=ROOT.parent/'cardstudio-release-012'
    report['sealedBaseline']='625969d58c371ec5ed5dc6fc96aed0b51ae5976a'
    report['unchangedCoreSha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'cardstudio-bundle/lib').glob('*.js') if (baseline/'cardstudio-bundle/lib'/p.name).is_file() and p.read_bytes()==(baseline/'cardstudio-bundle/lib'/p.name).read_bytes()} if baseline.is_dir() else {}
    (ROOT/'test-evidence/portable-bundle.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if '--retain' in __import__('sys').argv or '--retain-dir' in __import__('sys').argv:
        arguments=__import__('sys').argv
        deliver=(ROOT/arguments[arguments.index('--retain-dir')+1]).resolve() if '--retain-dir' in arguments else ROOT/'candidate-artifacts'
        assert deliver.is_relative_to((ROOT/'candidate-artifacts').resolve())
        deliver.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(root_archive,deliver/f'cardstudio-{report["version"]}-root.tgz')
        shutil.copyfile(child_archive,deliver/f'cardstudio-{report["version"]}-bundle.tgz')
    print(json.dumps({'rootFiles':root_audit['fileCount'],'subdirectoryFiles':child_audit['fileCount'],'phases':phases,'dataPreserved':True},ensure_ascii=False))
finally:
    assert BASE.resolve().parent==ROOT and BASE.name.startswith('cardstudio-portable-pack-')
    shutil.rmtree(BASE)
