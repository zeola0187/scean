import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {committedMessages} from '../isolated/web/view-model.mjs';
test('actual story renderer never reuses a different Run opening node when switching saved stories',async()=>{
  const source=await readFile(new URL('../isolated/web/app.mjs',import.meta.url),'utf8');
  const render=source.match(/function renderChat\(\)\{[\s\S]*?\n\}/)[0];
  class Element {
    constructor(tag,text=''){this.tag=tag;this.text=text;this.children=[];this.dataset={};this.parent=null;}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    querySelectorAll(){return this.children.filter(child=>child.tag==='article'&&child.dataset.messageKey);}
    get firstElementChild(){return this.children[0]??null;}
    get nextElementSibling(){return this.parent?.children[this.parent.children.indexOf(this)+1]??null;}
    insertBefore(child,next){child.remove();child.parent=this;const index=this.children.indexOf(next);this.children.splice(index<0?this.children.length:index,0,child);}
    remove(){if(this.parent){const rows=this.parent.children;rows.splice(rows.indexOf(this),1);this.parent=null;}}
    get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  }
  const history=[],chat=new Element('div'),state={run:null},context={shell:{story(){}},narrativeData:null,state,loadedTurns:[],historyPageState:null,committedMessages,cardFrontend:{history:value=>history.push(value)},$:()=>chat,node:(tag,text)=>new Element(tag,text)};
  vm.createContext(context);vm.runInContext(render,context);
  const make=(runId,text)=>({runId,snapshot:{opening:{text}},turns:[]}),a=make('run-A','Alternative A.'),b=make('run-B','Alternative B.');
  for(const run of [a,b,a]){state.run=run;vm.runInContext('renderChat()',context);assert.equal(chat.children.length,1);assert(chat.textContent.includes(run.snapshot.opening.text));assert(!chat.textContent.includes(run===a?'Alternative B.':'Alternative A.'));assert.equal(history.at(-1).runId,run.runId);assert.equal(history.at(-1).head,null);}
  assert.equal(a.snapshot.opening.text,'Alternative A.');assert.equal(b.snapshot.opening.text,'Alternative B.');
});
