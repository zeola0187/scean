import { fail, clone } from './codec.js';

export const EXPRESSIONS = Object.freeze(['neutral','happy','angry','sad','embarrassed','surprised']);
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const DIMENSIONS = ['outfit','pose','location','lighting'];
const own = (o,k) => Object.hasOwn(o,k);
function object(o,name) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || ![Object.prototype,null].includes(Object.getPrototypeOf(o))) fail('VISUAL_CONTRACT', `${name} must be a plain object.`);
}
function keys(o,allowed,name) { object(o,name); for (const k of Object.keys(o)) if (!allowed.includes(k)) fail('VISUAL_CONTRACT', `Unknown ${name} field: ${k}`); }
function id(v,name) { if (typeof v !== 'string' || !ID.test(v) || ['__proto__','constructor','prototype'].includes(v)) fail('VISUAL_CONTRACT', `${name} must be a stable lowercase ID.`); }
function ids(a,name) { if (!Array.isArray(a) || !a.length || a.length > 64) fail('VISUAL_CONTRACT', `${name} needs 1–64 IDs.`); a.forEach(v=>id(v,name)); if (new Set(a).size !== a.length) fail('VISUAL_CONTRACT', `Duplicate ${name}.`); }
function integer(v,name,min=0) { if (!Number.isSafeInteger(v) || v < min) fail('VISUAL_CONTRACT', `${name} must be a safe integer ≥ ${min}.`); }
export function validateVisualContract(c) {
  keys(c,['schemaVersion','contractRevision','characters','scene'],'contract');
  if (c.schemaVersion !== 1) fail('VISUAL_CONTRACT','Unsupported schemaVersion.'); integer(c.contractRevision,'contractRevision',1);
  object(c.characters,'characters'); const cast = Object.entries(c.characters);
  if (!cast.length || cast.length > 16) fail('VISUAL_CONTRACT','Contract needs 1–16 characters.');
  for (const [character,p] of cast) {
    id(character,'character'); keys(p,['displayName','expressions','defaultExpression','dimensions','variants'],'character');
    if (p.displayName!==undefined && (typeof p.displayName!=='string' || !p.displayName.trim() || p.displayName.length>120)) fail('VISUAL_CONTRACT','displayName must be a nonempty string of at most 120 characters.');
    if (!Array.isArray(p.expressions) || p.expressions.length !== 6 || new Set(p.expressions).size !== 6 || EXPRESSIONS.some(v=>!p.expressions.includes(v))) fail('VISUAL_CONTRACT','Every character must declare exactly the six expressions.');
    if (p.defaultExpression !== 'neutral') fail('VISUAL_CONTRACT','The fallback expression must be neutral.');
    if (p.dimensions !== undefined) { keys(p.dimensions,DIMENSIONS,'dimensions'); for (const [k,v] of Object.entries(p.dimensions)) ids(v,k); }
    if (!Array.isArray(p.variants) || p.variants.length > 256) fail('VISUAL_CONTRACT','variants must be an array of at most 256 entries.');
    const seen = new Set();
    for (const v of p.variants) {
      keys(v,['expression','dimensions','assetId'],'variant'); if (!p.expressions.includes(v.expression)) fail('VISUAL_CONTRACT','Unknown variant expression.'); id(v.assetId,'assetId');
      if (v.dimensions !== undefined) { keys(v.dimensions,DIMENSIONS,'variant dimensions'); for (const [k,value] of Object.entries(v.dimensions)) if (!p.dimensions?.[k]?.includes(value)) fail('VISUAL_CONTRACT',`Unknown variant ${k}.`); }
      const signature = JSON.stringify([v.expression,...DIMENSIONS.map(k=>v.dimensions?.[k] ?? null)]);
      if (seen.has(signature)) fail('VISUAL_CONTRACT','Duplicate variant selector.'); seen.add(signature);
    }
  }
  if (c.scene !== undefined) { keys(c.scene,['locations','lighting'],'scene'); for (const [k,v] of Object.entries(c.scene)) ids(v,k); }
  if (Buffer.byteLength(JSON.stringify(c)) > 256*1024) fail('LIMIT','Visual contract exceeds 256 KiB.');
  return clone(c);
}
export function createVisualContract(input={}) {
  keys(input,['schemaVersion','contractRevision','characters','scene'],'contract input');
  const characters = input.characters ?? {character:{}}; object(characters,'characters');
  const filled = {};
  for (const [name,p] of Object.entries(characters)) { object(p,'character'); filled[name] = {expressions:[...EXPRESSIONS],defaultExpression:'neutral',variants:[],...clone(p)}; }
  return validateVisualContract({schemaVersion:1,contractRevision:1,...clone(input),characters:filled});
}
export function patchVisualContract(contract,changes) {
  const current=validateVisualContract(contract); keys(changes,['characters','scene'],'contract patch');
  const next={...current,...clone(changes),contractRevision:current.contractRevision+1};
  return validateVisualContract(next);
}
function defaults(c) { return {schemaVersion:1,contractRevision:c.contractRevision,sequence:0,characters:Object.fromEntries(Object.keys(c.characters).map(k=>[k,{expression:'neutral'}])),scene:{}}; }
function checkedState(c,p,base) {
  keys(p,['schemaVersion','contractRevision','sequence','mode','generation','characters','scene'],'state');
  if (p.schemaVersion !== undefined && p.schemaVersion !== 1) fail('VISUAL_STATE','Unsupported state schemaVersion.');
  if (p.contractRevision !== undefined && p.contractRevision !== c.contractRevision) fail('VISUAL_STATE','State contract revision is stale.');
  if (p.mode !== undefined && !['patch','snapshot'].includes(p.mode)) fail('VISUAL_STATE','Unknown state mode.');
  if (p.sequence !== undefined) integer(p.sequence,'sequence');
  if (p.generation !== undefined) integer(p.generation,'generation');
  const result = p.mode==='snapshot' ? defaults(c) : clone(base);
  if (p.characters !== undefined) {
    object(p.characters,'state characters');
    for (const [name,update] of Object.entries(p.characters)) {
      if (!own(c.characters,name)) fail('VISUAL_STATE','Unknown character ID.');
      if (update===null) { result.characters[name]={expression:'neutral'}; continue; }
      keys(update,['expression',...DIMENSIONS],'character state'); const target={...result.characters[name]}, definition=c.characters[name];
      for (const [k,v] of Object.entries(update)) {
        if (k==='expression') { if (!definition.expressions.includes(v)) fail('VISUAL_STATE','Unknown expression.'); target.expression=v; }
        else if (v===null) delete target[k];
        else { if (!definition.dimensions?.[k]?.includes(v)) fail('VISUAL_STATE',`Unknown state ${k}.`); target[k]=v; }
      }
      result.characters[name]=target;
    }
  }
  if (p.scene !== undefined) {
    if (p.scene===null) result.scene={};
    else { keys(p.scene,['location','lighting'],'state scene'); for (const [k,v] of Object.entries(p.scene)) { if (v===null) delete result.scene[k]; else { if (!c.scene?.[k==='location'?'locations':'lighting']?.includes(v)) fail('VISUAL_STATE','Unknown scene ID.'); result.scene[k]=v; } } }
  }
  result.schemaVersion=1; result.contractRevision=c.contractRevision; result.sequence=p.sequence??base.sequence;
  if (p.generation!==undefined) result.generation=p.generation;
  return result;
}
export function validateVisualState(contract,proposal,{previous,sequence,generation}={}) {
  const c=validateVisualContract(contract); let base=defaults(c);
  // A supplied previous state is untrusted too; normalize it from a clean state.
  if (previous!==undefined) { try { base=checkedState(c,{...previous,mode:'snapshot'},base); } catch {} }
  const refuse=(code,message,stale=false)=>{
    const state=clone(stale?base:defaults(c));
    // Reset visuals safely without resetting the anti-replay watermark.
    state.sequence=base.sequence;if(base.generation!==undefined)state.generation=base.generation;
    return {accepted:false,state,sequence:base.sequence,diagnostics:[{code,message}]};
  };
  try {
    object(proposal,'state');
    const seq=proposal.sequence??sequence;
    if (seq!==undefined) integer(seq,'sequence');
    if (proposal.generation!==undefined) integer(proposal.generation,'generation');
    if (sequence!==undefined) integer(sequence,'sequence');
    if (generation!==undefined) integer(generation,'generation');
    if (proposal.sequence!==undefined && sequence!==undefined && proposal.sequence!==sequence) return refuse('SEQUENCE_MISMATCH','Proposal sequence differs from the expected sequence.',true);
    if (proposal.generation!==undefined && generation!==undefined && proposal.generation!==generation) return refuse('STALE_GENERATION','Preview generation changed.',true);
    if (proposal.generation!==undefined && generation===undefined && base.generation!==undefined && proposal.generation!==base.generation) return refuse('STALE_GENERATION','Preview generation changed.',true);
    if (proposal.contractRevision!==undefined && proposal.contractRevision!==c.contractRevision) return refuse('STALE_CONTRACT','State contract revision changed.',true);
    if (seq!==undefined && previous!==undefined && seq<=base.sequence) return refuse('STALE_SEQUENCE','State sequence must increase.',true);
    const state=checkedState(c,{...proposal,...(seq===undefined?{}:{sequence:seq}),...(generation===undefined?{}:{generation})},base);
    return {accepted:true,state,sequence:state.sequence,diagnostics:[]};
  } catch (e) { return refuse(e.code??'VISUAL_STATE',e.message); }
}
export function resolveVisualState(contract,state,assetManifest={}) {
  const c=validateVisualContract(contract), checked=validateVisualState(c,state); const s=checked.state;
  const records=assetManifest.assets??assetManifest;
  const assets=Array.isArray(records)?Object.fromEntries(records.map(record=>[record.assetId,record])):records;
  object(assets,'asset manifest');
  const available = assetId => own(assets,assetId) && /^[a-f0-9]{64}$/.test(assets[assetId]?.sha256??assets[assetId]?.digest??'') && ['image/png','image/jpeg','image/webp'].includes(assets[assetId]?.mediaType);
  const resolved={};
  for (const [name,p] of Object.entries(c.characters)) {
    const value=s.characters[name];
    const exact=p.variants.find(v=>v.expression===value.expression && DIMENSIONS.every(k=>(v.dimensions?.[k]??null)===(value[k]??null)) && available(v.assetId));
    const neutral=p.variants.find(v=>v.expression==='neutral' && !Object.keys(v.dimensions??{}).length && available(v.assetId));
    resolved[name]={assetId:exact?.assetId??neutral?.assetId??null,fallback:exact?'exact':neutral?'neutral':'placeholder'};
  }
  return {state:s,characters:resolved,diagnostics:checked.diagnostics};
}
