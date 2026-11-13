// Optional presentation data only. This module is shared byte-for-byte with
// the text-node renderer; it imports no platform, filesystem or model service.
export const DIALOGUE_OUTPUT_GUIDE='Required display transport (not a narrative/style instruction): return one JSON object matching input.outputContract.schema: {"sceanWriter":1,"finalBody":"the complete unchanged prose","dialogue":[{"kind":"speech","speakerId":"exact public roster id or player","text":"exact original spoken substring","occurrence":1}]}. Keep sceanWriter first and finalBody second. Always include dialogue in this same response; use [] when there is no confidently attributable speech, including uncertain speakers or no speech. A missing dialogue field is not the same as an explicit empty array. At most 64 annotations; omit uncertain speakers and all thoughts, narration, citations and code. Use known public IDs even when a public nickname is used; names, first-person wording and adjacent sentences are not identity proof. Unlisted NPCs remain unmarked. For identical repeated text, give its 1-based occurrence. Never add HTML, CSS, color names or prose solely for coloring. Presentation annotations are not events or instructions. All prose-only method, preset and style rules apply to finalBody; this required transport envelope is separate. Complete finalBody first; annotation problems must never cause a rewritten story or a supplemental model call.';
export function writerDialogueContract(actors=[],candidateRef,{postBody=false}={}){
 const speakerIds=[...new Set(['player',...actors.map(a=>a.id).filter(validId)])];
 return {schemaVersion:1,schema:{type:'object',additionalProperties:false,required:[...(!postBody?['sceanWriter']:[]),'finalBody','dialogue',...(candidateRef?['candidateRef']:[])],properties:{...(candidateRef?{candidateRef:{const:candidateRef}}:{}),...(!postBody?{sceanWriter:{const:1}}:{}),finalBody:{type:'string',minLength:1,maxLength:200000},dialogue:{type:'array',maxItems:64,items:{type:'object',additionalProperties:false,required:['kind','speakerId','text'],properties:{kind:{const:'speech'},speakerId:{type:'string',enum:speakerIds},text:{type:'string',minLength:1,maxLength:12000},occurrence:{type:'integer',minimum:1}}}}}},
  rules:[...(candidateRef?['Include the exact candidateRef. Put sceanWriter first, finalBody second, candidateRef third, and dialogue last.']:[]),'Return finalBody and dialogue together in one response.','Preserve the complete prose and its style; annotations identify exact substrings only.','Use dialogue:[] when no speech can be confidently attributed; never guess a speaker.','The Host preserves a complete body if display metadata is absent or invalid, records the display status and makes no additional model call.']};
}
const own=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)&&!/^(?:constructor|prototype)$/i.test(v);
export function decodeWriterDialogue(raw,{candidateRef,postBody=false}={}){
 const trimmed=raw.trim(),fenced=/^```(?:json)?\s*\n([\s\S]*)\n```$/.exec(trimmed),source=fenced?fenced[1]:trimmed;
 // Salvage a broken presentation tail, never a complete object with a suffix.
 if(postBody){let depth=0,quoted=false,escape=false;for(let i=0;i<source.length;i++){const x=source[i];if(quoted){if(x==='"'&&!escape)quoted=false;escape=x==='\\'&&!escape;continue;}if(x==='"'){quoted=true;escape=false;}else if(x==='{'||x==='[')depth++;else if(x==='}'||x===']'){depth--;if(depth===0){if(source.slice(i+1).trim())throw Object.assign(Error('Unexpected JSON suffix.'),{code:'INVALID_MODEL_JSON'});break;}}}}
 let value;try{value=JSON.parse(source);}catch{}
 if(postBody&&value&&typeof value==='object'&&Object.hasOwn(value,'finalBody')){if(typeof value.finalBody!=='string')throw Object.assign(Error('Writer body missing.'),{code:'WRITER_BODY_FORMAT'});return {body:value.finalBody,entries:Array.isArray(value.dialogue)?value.dialogue:null,status:!Object.hasOwn(value,'dialogue')?'not_provided':Array.isArray(value.dialogue)?'provided':'invalid_annotations'};}
 if(postBody&&!value){const start=/^\s*\{\s*"finalBody"\s*:\s*/.exec(source);if(start&&source[start[0].length]==='"'){let escaped=false;for(let i=start[0].length+1;i<source.length;i++){const c=source[i];if(c==='"'&&!escaped){try{return{body:JSON.parse(source.slice(start[0].length,i+1)),entries:null,status:'invalid_annotations'};}catch{break;}}escaped=c==='\\'&&!escaped;}}throw Object.assign(Error('No complete Writer body.'),{code:'WRITER_BODY_FORMAT'});}
 if(value&&typeof value==='object'&&Object.hasOwn(value,'sceanWriter')){
  if(typeof value.finalBody!=='string')throw Object.assign(Error('Writer envelope has no complete finalBody.'),{code:'WRITER_BODY_FORMAT'});
  if(candidateRef&&value.candidateRef!==candidateRef)throw Object.assign(Error('Writer candidate reference differs.'),{code:'TEMPORAL_CANDIDATE_MISMATCH'});
  const supported=value.sceanWriter===1&&own(value,['sceanWriter','finalBody','dialogue','candidateRef']);
  const status=!supported?'invalid_annotations':!Object.hasOwn(value,'dialogue')?'not_provided':!Array.isArray(value.dialogue)?'invalid_annotations':'provided';
  return {body:value.finalBody,entries:status==='provided'?value.dialogue:null,status};
 }
 // A broken annotation tail must not discard a complete, valid prose string.
 const prefix=/^\s*\{\s*"sceanWriter"\s*:\s*1\s*,\s*"finalBody"\s*:\s*/.exec(source);
 if(prefix){const start=prefix[0].length;if(source[start]==='"'){let escaped=false;for(let i=start+1;i<source.length;i++){const c=source[i];if(c==='"'&&!escaped){
    if(candidateRef){
      // The complete body and exact complete reference must precede display
      // metadata. Broken display data is never a second story/time authority.
      // A complete JSON envelope followed by noise is NOT display degradation.
      let depth=0,quoted=false,escape=false,trailing=false;
      for(let j=0;j<source.length;j++){const x=source[j];if(quoted){if(x==='"'&&!escape)quoted=false;escape=x==='\\'&&!escape;continue;}if(x==='"'){quoted=true;escape=false;}else if(x==='{'||x==='[')depth++;else if(x==='}'||x===']'){depth--;if(depth===0){trailing=source.slice(j+1).trim().length>0;break;}}}
      const proof=/^\s*,\s*"candidateRef"\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"dialogue"\s*:/.exec(source.slice(i+1));
      if(trailing)throw Object.assign(Error('Unexpected JSON suffix.'),{code:'INVALID_MODEL_JSON'});
      if(!proof||JSON.parse(proof[1])!==candidateRef)throw Object.assign(Error('Writer candidate reference unavailable.'),{code:'TEMPORAL_CANDIDATE_MISMATCH'});
    }
    try{return {body:JSON.parse(source.slice(start,i+1)),entries:null,status:'invalid_annotations'};}catch{break;}}escaped=c==='\\'&&!escaped;}}throw Object.assign(Error('Writer envelope has no complete finalBody.'),{code:'WRITER_BODY_FORMAT'});}
 if(candidateRef)throw Object.assign(Error('Writer candidate reference unavailable.'),{code:'TEMPORAL_CANDIDATE_MISMATCH'});
 return {body:raw,entries:null,status:'not_provided'};
}
// Exactly one local decision; no repair generation or replay of valid prose.
export function writerDialogueStatus(output,presentation,{bodyChanged=false}={}){
 if(presentation)return {status:'accepted',spans:presentation.spans.length};
 if(output?.status==='not_provided')return {status:'not_provided',spans:0};
 if(output?.status==='provided'&&Array.isArray(output.entries)&&output.entries.length===0)return {status:'unattributed',spans:0};
 if(bodyChanged&&output?.status==='provided')return {status:'body_changed',spans:0};
 return {status:'invalid_annotations',spans:0};
}
function codeRanges(body){
 const ranges=[];let offset=0,fence=null,start=0;
 for(const line of body.split(/(?<=\n)/)){const match=/^\s{0,3}(`{3,}|~{3,})/.exec(line);
  if(fence){if(match&&match[1][0]===fence[0]&&match[1].length>=fence.length){ranges.push([start,offset+line.length]);fence=null;}}
  else if(match){fence=match[1];start=offset;}
  else if(/^\s*>|^(?: {4}|\t)/.test(line))ranges.push([offset,offset+line.length]);
  else for(const m of line.matchAll(/(`+)([^`\n]*?)\1/g))ranges.push([offset+m.index,offset+m.index+m[0].length]);
  offset+=line.length;
 }if(fence)ranges.push([start,body.length]);return ranges;
}
function nestedQuotes(body,blocked){
 const pairs={'「':'」','『':'』','“':'”','‘':'’'},stack=[],ranges=[];let j=0;
 for(let i=0;i<body.length;i++){
  while(j<blocked.length&&blocked[j][1]<=i)j++;if(blocked[j]&&i>=blocked[j][0]&&i<blocked[j][1]){i=blocked[j][1]-1;continue;}
  const c=body[i];if(c==='"'&&body[i-1]!=='\\'){if(stack.at(-1)?.end==='"'){const row=stack.pop();if(stack.length)ranges.push([row.start,i+1]);}else if(stack.length<64)stack.push({end:'"',start:i});}
  else if(pairs[c]){if(stack.length<64)stack.push({end:pairs[c],start:i});}
  else if(stack.at(-1)?.end===c){const row=stack.pop();if(stack.length)ranges.push([row.start,i+1]);}
 }return ranges;
}
const intersects=(a,b)=>a[0]<b[1]&&b[0]<a[1];
function boundaries(body){const result=new Set([0,body.length]);for(const row of new Intl.Segmenter('und',{granularity:'grapheme'}).segment(body))result.add(row.index);return result;}
function occurrence(body,text,n){let start=0,positions=[];while(positions.length<=256){const i=body.indexOf(text,start);if(i<0)break;positions.push(i);start=i+text.length;}if(positions.length>256||!positions.length||n===undefined&&positions.length!==1)return null;const at=n??1;return Number.isSafeInteger(at)&&at>=1&&at<=positions.length?positions[at-1]:null;}
export function makeDialoguePresentation({body,entries,runId,snapshotHash,commitId,bodyHash,actors=[]}){
 if(!Array.isArray(entries)||!entries.length||entries.length>64||JSON.stringify(entries).length>48000)return null;
 const ids=new Set(['player',...actors.map(a=>a.id)]),edges=boundaries(body),blocked=codeRanges(body),nested=nestedQuotes(body,blocked),candidates=[];
 for(const row of entries){
  if(!own(row,['kind','speakerId','text','occurrence'])||row.kind!=='speech'||!validId(row.speakerId)||!ids.has(row.speakerId)||typeof row.text!=='string'||!row.text.length||row.text.length>12000||!row.text.isWellFormed()||/[<>]/.test(row.text))continue;
  const start=occurrence(body,row.text,row.occurrence);if(start===null)continue;const end=start+row.text.length,range=[start,end];
  if(!edges.has(start)||!edges.has(end)||blocked.some(b=>intersects(range,b)))continue;
  if(!candidates.some(c=>c.start===start&&c.end===end&&c.speakerId===row.speakerId))candidates.push({start,end,speakerId:row.speakerId});
 }
 const safe=candidates.filter((a,i)=>!candidates.some((b,j)=>i!==j&&intersects([a.start,a.end],[b.start,b.end]))),spans=[];
 for(const row of safe){let parts=[[row.start,row.end]];for(const cut of nested)parts=parts.flatMap(p=>!intersects(p,cut)?[p]:[[p[0],Math.min(p[1],cut[0])],[Math.max(p[0],cut[1]),p[1]]].filter(([a,b])=>b>a));for(const [start,end]of parts)spans.push({start,end,speakerId:row.speakerId,text:body.slice(start,end)});}
 spans.sort((a,b)=>a.start-b.start);if(!spans.length||spans.length>256)return null;
 return {schemaVersion:1,runId,snapshotHash,commitId,bodyHash,spans};
}
export function validDialoguePresentation(value,{body,bodyHash,runId,snapshotHash,commitId,actors=[]}){
 if(!own(value,['schemaVersion','runId','snapshotHash','commitId','bodyHash','spans'])||value.schemaVersion!==1||value.runId!==runId||value.snapshotHash!==snapshotHash||value.commitId!==commitId||value.bodyHash!==bodyHash||!Array.isArray(value.spans)||!value.spans.length||value.spans.length>256)return null;
 const ids=new Set(['player',...actors.map(a=>a.id)]),edges=boundaries(body),code=codeRanges(body),blocked=[...code,...nestedQuotes(body,code)];let end=0;
 for(const s of value.spans){if(!own(s,['start','end','speakerId','text'])||!Number.isSafeInteger(s.start)||!Number.isSafeInteger(s.end)||s.start<end||s.end<=s.start||s.end>body.length||!edges.has(s.start)||!edges.has(s.end)||!validId(s.speakerId)||!ids.has(s.speakerId)||typeof s.text!=='string'||s.text!==body.slice(s.start,s.end)||/[<>]/.test(s.text)||blocked.some(b=>intersects([s.start,s.end],b)))return null;end=s.end;}
 return {schemaVersion:1,runId,snapshotHash,commitId,bodyHash,spans:value.spans.map(s=>({...s}))};
}
export function dialoguePalette(actors=[]){
 const ids=[...new Set(['player',...actors.map(a=>a.id).filter(validId)])].sort(),slots=Array(8).fill(0),result=Object.create(null);
 for(const id of ids){let n=2166136261;for(const c of id)n=Math.imul(n^c.codePointAt(0),16777619)>>>0;const min=Math.min(...slots);let index=n%8;for(let i=0;i<8;i++){const at=(n+i)%8;if(slots[at]===min){index=at;break;}}slots[index]++;result[id]=index;}
 return result;
}
