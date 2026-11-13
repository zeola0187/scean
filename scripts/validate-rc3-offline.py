"""Run rc.3 SDK regression tests with synthetic providers and isolated data paths.
Prepare the reviewed SDK and build generated inputs before invoking this script.
"""
from pathlib import Path
import argparse,json,os,re,socket,subprocess,tempfile,time,sys
parser=argparse.ArgumentParser()
parser.add_argument('--node',default='node',help='Node 24 executable, or reviewed Desktop executable in Node mode')
parser.add_argument('--focused',action='store_true')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
assert (root/'node_modules/@deepseek-ai/dsh-app-boot/package.json').is_file(),'Prepare the reviewed SDK first'
assert json.loads((root/'node_modules/@deepseek-ai/dsh-app-boot/package.json').read_text())['version']=='0.2.2-rc.3'
home=Path(tempfile.mkdtemp(prefix='scean-rc3-offline-')).resolve()
env={k:v for k,v in os.environ.items() if k.upper() in ['SYSTEMROOT','WINDIR','PATH','PATHEXT','COMSPEC','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']}
for key in ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','DSH_HOME','TEMP','TMP']:env[key]=str(home)
env.update(SDK_ROOT=str(root),NODE_OPTIONS='--require "'+(root/'scripts/w19-offline-network.cjs').as_posix()+'"',SCEAN_PRIMARY_MACHINE=socket.gethostname(),RC3_TEST_SDK='dsh-0.2.2-rc.3',SCEAN_TEST_EVIDENCE_ROOT=str(home/'receipts'),ELECTRON_RUN_AS_NODE='1')
patterns=['tests/*.test.mjs','authoring/tests/*.test.mjs','addons/openrouter-output-default/*.test.mjs']
if args.focused:patterns=['tests/dsh-version-compatibility.test.mjs','tests/deepseek-flash-compatibility.test.mjs','tests/w01-sdk.test.mjs','tests/plugin-native-sdk.test.mjs','authoring/tests/agent-integration.test.mjs','authoring/tests/w02-agent-integration.test.mjs','addons/openrouter-output-default/*.test.mjs']
files=sorted({p.relative_to(root).as_posix() for pattern in patterns for p in root.glob(pattern)})
excluded='tests/legacy-fixture-tool.test.mjs'
if excluded in files:files.remove(excluded)
command=[args.node,'--test','--test-reporter=tap','--test-concurrency=2','--test-skip-pattern=actual timecal4 reader refuses new schema13|actual sealed timecal3 reader rejects new v12',*files]
start=time.monotonic()
with (home/'tests.log').open('wb') as log:result=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=900)
counts={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped) (\d+)$',(home/'tests.log').read_text(encoding='utf8',errors='replace'),re.M)}
report={'exitCode':result.returncode,'counts':counts,'seconds':round(time.monotonic()-start,2),'syntheticOnly':True,'outboundNetworkBlocked':True,'isolatedHome':str(home),'files':files,'historicalExclusions':[excluded,'actual timecal4 reader refuses new schema13','actual sealed timecal3 reader rejects new v12']}
(home/'result.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2));sys.exit(result.returncode)
