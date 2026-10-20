import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../sources/card-studio/cardstudio-bundle/client-template.js',import.meta.url),'utf8');
const helpers=source.split('/* EDITOR_VIEW_STATE_START */')[1].split('/* EDITOR_VIEW_STATE_END */')[0];
function runtime(){const cache=new Map();const api=vm.runInNewContext(helpers+';({createEditorView,sessionView,diagnosisHandoff})',{viewCache:cache,emptyList:{items:[],total:0,offset:0,limit:50}});return {...api,cache};}
test('a cold diagnosis handoff receives a complete editor view before first mount',()=>{
 const r=runtime();r.cache.set('session-A',{...r.sessionView('session-A'),route:'diagnosis',diagnosisRun:'run-A'});
 const view=r.sessionView('session-A');assert.equal(view.route,'diagnosis');assert.equal(view.diagnosisRun,'run-A');assert.equal(view.doc,null);
 assert.equal(view.files.map(String).length,0);assert.equal(view.documents.items.map(String).length,0);assert.equal(view.allDocuments.items.length,0);assert.equal(view.entries.length,0);assert.equal(view.diagnosis,undefined);
});
test('legacy partial cache is repaired on reopening without discarding the diagnostic Run',()=>{
 const r=runtime();r.cache.set('session-A',{route:'diagnosis',diagnosisRun:'old-run'});
 const view=r.sessionView('session-A');assert.equal(view.diagnosisRun,'old-run');assert.equal(view.documents.offset,0);assert.equal(view.files.length,0);assert.equal(r.sessionView('session-A'),view,'stable identity prevents render loops');
});
test('absent or invalid cached containers have a recoverable empty view',()=>{
 const r=runtime();for(const cached of [undefined,null,[],42,'invalid']){const view=r.createEditorView(cached);assert.equal(view.doc,null);assert.equal(view.documents.items.length,0);assert.equal(view.entries.length,0);}
});
test('normalization retains unsaved draft bytes, card identity and settings',()=>{
 const r=runtime(),doc={id:'card-A',revision:8,card:{data:{description:'saved'}}},draft={route:'field',doc,text:'unsaved\nkeep exactly',field:'description',sceanCharacters:'[{"id":"a"}]',authoring:{source:'unsaved HTML'},files:undefined,documents:{total:4,items:null},allDocuments:null};
 const view=r.createEditorView(draft);assert.equal(view.doc,doc);assert.equal(view.text,draft.text);assert.equal(view.authoring,draft.authoring);assert.equal(view.sceanCharacters,draft.sceanCharacters);assert.equal(view.documents.total,4);assert.equal(view.documents.items.length,0);assert.equal(draft.documents.items,null,'input unchanged');
});
test('a second Session never inherits diagnostic identity or cached draft',()=>{
 const r=runtime();r.cache.set('session-A',{route:'diagnosis',diagnosisRun:'run-A',text:'private synthetic draft'});
 const a=r.sessionView('session-A'),b=r.sessionView('session-B');assert.notEqual(a,b);assert.equal(b.diagnosisRun,undefined);assert.equal(b.text,'');assert.equal(a.diagnosisRun,'run-A');
});
test('malformed or cross-Session handoffs are rejected before updating view state',()=>{
 const {diagnosisHandoff:accept}=runtime();assert.equal(accept({authoringSessionId:'a',runId:'run-a'},'a'),true);
 for(const detail of [null,{}, {authoringSessionId:'b',runId:'run-a'},{authoringSessionId:'a',runId:''},{authoringSessionId:'a',runId:{}},{authoringSessionId:'a',runId:'x'.repeat(161)}])assert.equal(accept(detail,'a'),false);
 assert.equal(accept({authoringSessionId:'a',runId:'run-a'},undefined),false);
});
test('the local render boundary keeps recovery controls and retries without resetting a draft',()=>{
 const begin=source.indexOf('class StudioPanelBoundary'),end=source.indexOf('const controller=new WorkspaceClient',begin),panels=[],events=[];
 class Component{constructor(props){this.props=props;}setState(value){this.state={...this.state,...value};}}
 const Boundary=vm.runInNewContext(source.slice(begin,end)+';StudioPanelBoundary',{React:{Component},h:(type,props,...children)=>({type,props,children}),ctx:{layout:{selectPanel:p=>panels.push(p)}},mark:(...x)=>events.push(x)});
 const draft={text:'unsaved synthetic draft'},view=new Boundary({children:draft});assert.equal(view.render(),draft);
 view.state=Boundary.getDerivedStateFromError(new Error('synthetic render error'));view.componentDidCatch();const fallback=view.render();assert.equal(fallback.props['data-editor-recovery'],true);
 fallback.children.find(x=>x.type==='button'&&x.children[0]==='回到對話').props.onClick();assert.deepEqual(panels,[null]);
 fallback.children.find(x=>x.type==='button'&&x.children[0]==='重新開啟編輯室').props.onClick();assert.equal(view.render(),draft);assert.equal(draft.text,'unsaved synthetic draft');assert.equal(events.length,1);
});
