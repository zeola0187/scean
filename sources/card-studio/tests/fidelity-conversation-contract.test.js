// Pure rendering contract; actual SDK/session/draft proof lives in the browser fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../cardstudio-bundle/client-template.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('      function StudioConversation('),source.indexOf('      function Dock('));
function render({sessionId='synthetic-session',session,blank=false,activeTargets=new Set()}={}){
 const captured=[];const context=vm.createContext({React:{useRef:value=>({current:value}),useEffect:()=>{}},h:(tag,props,...children)=>({tag,props,children})});
 const component=vm.runInContext(body+';StudioConversation',context);
 const node=component({sessionId,useSession:fn=>fn(session),useSessions:fn=>fn({byId:{[sessionId]:{blank}}}),useConversation:fn=>fn({activeTargets}),renderFactorySlot:(name,props)=>{captured.push({name,props});return 'real-sdk-factory';}});
 assert.equal(node.props['data-workbench-conversation'],true);assert.equal(captured.length,1);assert.equal(captured[0].name,'conversation.content');assert.equal(captured[0].props.variant,'embedded');return captured[0].props;
}
test('Workbench native conversation preserves SDK blank workspace hero guard',()=>{const r=render({session:{blank:true,openState:'open'}});assert.equal(r.hero,true);assert.equal(r.phase,'hero');});
test('Workbench native conversation preserves loading-settlement guard',()=>{const r=render({session:{blank:true,openState:'loading'},blank:false});assert.equal(r.hero,false);assert.equal(r.phase,'settling');});
test('Workbench native conversation preserves pending subagent parent guard',()=>{const r=render({session:{blank:false,openState:'open',subagent:{address:{mode:'continuable'}}}});assert.equal(r.phase,'settling');});
test('Workbench native conversation presents running and existing message stream as active',()=>{for(const session of [{blank:true,running:true,openState:'open'},{blank:false,openState:'open'}]){const r=render({session});assert.equal(r.hero,false);assert.equal(r.phase,'active');}});
test('Workbench native conversation uses active targets and first prompt attempt',()=>{for(const input of [{session:{blank:true,openState:'open'},activeTargets:new Set(['turn'])},{session:{blank:true,promptAttempted:true,openState:'open'}}]){const r=render(input);assert.equal(r.hero,false);assert.equal(r.phase,'active');}});
test('Workbench native conversation retains sessionless composer guard',()=>{const context=vm.createContext({React:{useRef:value=>({current:value}),useEffect:()=>{}},h:(tag,props,...children)=>({tag,props,children})});let options;vm.runInContext(body+';StudioConversation',context)({sessionId:undefined,useSession:f=>f(undefined),useConversation:f=>f(undefined),useSessions:f=>f({byId:{}}),renderFactorySlot:(_,props)=>{options=props;}});assert.equal(options.hero,true);assert.equal(options.phase,'hero');});

test('Native settled signal carries exact Session and never fires while a real turn is active',()=>{
 for(const [session,activeTargets,expected] of [[{openState:'open',running:true},new Set(),0],[{openState:'open',running:false},new Set(['tool']),0],[{openState:'loading'},new Set(),0],[{openState:'open',running:false},new Set(),1]]){
  const calls=[],context=vm.createContext({React:{useRef:value=>({current:value}),useEffect:fn=>fn()},h:()=>null});
  vm.runInContext(body+';StudioConversation',context)({sessionId:'exact-synthetic-session',useSession:f=>f(session),useConversation:f=>f({activeTargets}),useSessions:f=>f({byId:{}}),renderFactorySlot:()=>null,onSettled:id=>calls.push(id)});
  assert.equal(calls.length,expected);if(expected)assert.equal(calls[0],'exact-synthetic-session');
 }
});
