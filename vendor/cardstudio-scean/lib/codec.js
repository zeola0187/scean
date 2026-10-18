import { tavernBookIssues, legacyAliasWarnings } from './tavern-compatibility.js';
import { createHash } from 'node:crypto';
import { inflateSync, deflateSync } from 'node:zlib';

export class CardError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
export function fail(code, message, details) { throw new CardError(code, message, details); }
export const clone = value => JSON.parse(JSON.stringify(value));
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const equal = (a, b) => canonical(a) === canonical(b);
function numberKey(text) {
  let [mantissa, exp = '0'] = text.toLowerCase().split('e');
  let negative = mantissa.startsWith('-'); if (negative) mantissa = mantissa.slice(1);
  let [a, b = ''] = mantissa.split('.'); let digits = (a + b).replace(/^0+/, '');
  let exponent = Number(exp) - b.length;
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); exponent++; }
  return digits ? `${negative ? '-' : ''}${digits}e${exponent}` : '0';
}
/** Refuse duplicate JSON keys and numbers that JSON.parse/stringify would silently round. */
export function strictJson(text,{maxBytes=16*1024*1024}={}) {
  if (Buffer.byteLength(text) > maxBytes) fail('LIMIT', 'JSON exceeds its configured byte limit.');
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  function string() {
    const start = i++; let escape = false;
    while (i < text.length) {
      const c = text[i++];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') return JSON.parse(text.slice(start, i));
    }
    fail('JSON', 'Unterminated JSON string.');
  }
  function value(depth) {
    if (depth > 128) fail('LIMIT', 'JSON nesting exceeds 128.'); ws();
    if (text[i] === '"') { string(); return; }
    if (text[i] === '{') {
      i++; ws(); const keys = new Set(); if (text[i] === '}') { i++; return; }
      for (;;) {
        ws(); if (text[i] !== '"') fail('JSON', 'Expected object key.');
        const key = string(); if (keys.has(key)) fail('DUPLICATE_KEY', `Duplicate JSON key: ${key}`); keys.add(key);
        ws(); if (text[i++] !== ':') fail('JSON', 'Expected colon.'); value(depth + 1); ws();
        const c = text[i++]; if (c === '}') return; if (c !== ',') fail('JSON', 'Expected comma.');
      }
    }
    if (text[i] === '[') {
      i++; ws(); if (text[i] === ']') { i++; return; }
      for (;;) { value(depth + 1); ws(); const c = text[i++]; if (c === ']') return; if (c !== ',') fail('JSON', 'Expected array comma.'); }
    }
    const token = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i))?.[0];
    if (!token) fail('JSON', `Invalid JSON at ${i}.`); i += token.length;
    if (!['true', 'false', 'null'].includes(token)) {
      const n = Number(token);
      if (!Number.isFinite(n) || Object.is(n,-0) || numberKey(token) !== numberKey(JSON.stringify(n))) fail('NUMBER_PRECISION', `Number cannot round-trip safely: ${token}`);
    }
  }
  try { value(0); ws(); if (i !== text.length) fail('JSON', 'Unexpected JSON suffix.'); return JSON.parse(text); }
  catch (e) { if (e instanceof CardError) throw e; fail('JSON', e.message); }
}
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii'), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function textKeyword(type, data) {
  if (!['tEXt','zTXt','iTXt'].includes(type)) return;
  const end = data.indexOf(0); if (end < 1 || end > 79) fail('PNG', 'Malformed text keyword.');
  const key = data.subarray(0, end).toString('latin1').toLowerCase();
  return ['chara','ccv3'].includes(key) ? key : undefined;
}
function textChunk(type, data) {
  const key=textKeyword(type,data);if(!key)return;
  const end=data.indexOf(0);
  let payload, prefix;
  if (type === 'tEXt') { prefix = data.subarray(0, end + 1); payload = data.subarray(end + 1); }
  if (type === 'zTXt') {
    if (data[end + 1] !== 0) fail('PNG', 'Unsupported text compression.'); prefix = data.subarray(0, end + 2);
    payload = inflateSync(data.subarray(end + 2), { maxOutputLength: 12 * 1024 * 1024 });
  }
  if (type === 'iTXt') {
    const flag = data[end + 1], method = data[end + 2];
    if (![0,1].includes(flag) || method !== 0) fail('PNG', 'Malformed international text.');
    const language = data.indexOf(0, end + 3), translated = data.indexOf(0, language + 1);
    if (language < 0 || translated < 0) fail('PNG', 'Malformed international text fields.');
    prefix = data.subarray(0, translated + 1); const body = data.subarray(translated + 1);
    payload = flag ? inflateSync(body, { maxOutputLength: 12 * 1024 * 1024 }) : body;
  }
  // Native decode + exact byte round trip avoids a recursive RegExp on large
  // metadata and rejects whitespace, nonzero padding bits and high-bit bytes.
  const decoded = Buffer.from(payload.toString('latin1'), 'base64');
  if (!Buffer.from(decoded.toString('base64'),'ascii').equals(payload)) fail('PNG', 'Card metadata is not canonical base64.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  return { key, prefix, compressed: type === 'zTXt' || (type === 'iTXt' && data[end + 1] === 1), value: strictJson(text) };
}
export function validateCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) fail('CARD', 'Card must be an object.');
  if (!['chara_card_v2','chara_card_v3'].includes(card.spec)) fail('CARD_VERSION', 'Only CCv2/CCv3 cards are supported; no guessed conversion.');
  if (card.spec_version !== (card.spec === 'chara_card_v2' ? '2.0' : '3.0')) fail('CARD_VERSION', 'Unsupported spec_version.');
  if (!card.data || typeof card.data !== 'object' || Array.isArray(card.data)) fail('CARD', 'Missing card.data.');
  for (const k of ['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions','creator','character_version']) {
    if (typeof card.data[k] !== 'string') fail('CARD_FIELD', `data.${k} must be a string.`);
  }
  for (const k of ['alternate_greetings','tags']) if (!Array.isArray(card.data[k]) || card.data[k].some(x => typeof x !== 'string')) fail('CARD_FIELD', `data.${k} must be a string array.`);
  if (!card.data.extensions || typeof card.data.extensions !== 'object' || Array.isArray(card.data.extensions)) fail('CARD_FIELD', 'data.extensions must be an object.');
  if (card.data.character_book != null) validateBook(card.data.character_book,{version:card.spec==='chara_card_v2'?2:3});
}
// Preservation compatibility only: imported optional nulls are retained, not
// interpreted as zero/false or claimed to satisfy the normative CC interface.
export const nullableBookSettings = ['scan_depth','token_budget','recursive_scanning'];
export function compatibilityWarnings(card) {
  return [...legacyAliasWarnings(card),...tavernBookIssues(card.data?.character_book).map(issue=>({...issue,path:'/data/character_book/entries',exportBlocked:true})),...nullableBookSettings.filter(k=>card.data?.character_book?.[k]===null)
    .map(k=>({code:'PRESERVED_NULL_BOOK_SETTING',path:'/data/character_book/'+k}))];
}
export function validateBook(book,{version=3}={}) {
  if (!book || typeof book !== 'object' || Array.isArray(book) || !Array.isArray(book.entries)) fail('BOOK', 'Worldbook requires entries array.');
  const ids = new Set();
  for (const e of book.entries) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) fail('ENTRY', 'Entry must be an object.');
    for (const k of ['keys']) if (!Array.isArray(e[k]) || e[k].some(x => typeof x !== 'string')) fail('ENTRY', `Entry ${k} must be string array.`);
    if (typeof e.content !== 'string' || typeof e.enabled !== 'boolean' || !Number.isFinite(e.insertion_order)) fail('ENTRY', 'Entry needs content, enabled, insertion_order.');
    if (e.id !== undefined) { if (!((typeof e.id==='number'&&Number.isFinite(e.id)) || (version===3&&typeof e.id==='string'))) fail('ENTRY_ID', 'CCv2 entry id must be numeric; CCv3 may also use a string.'); if (ids.has(e.id)) fail('DUPLICATE_ID', `Duplicate entry id: ${e.id}`); ids.add(e.id); }
    if (e.secondary_keys !== undefined && (!Array.isArray(e.secondary_keys) || e.secondary_keys.some(x => typeof x !== 'string'))) fail('ENTRY', 'secondary_keys must be string array.');
    if (e.extensions !== undefined && (!e.extensions || typeof e.extensions !== 'object' || Array.isArray(e.extensions))) fail('ENTRY', 'extensions must be object.');
  }
  for (const k of ['scan_depth','token_budget']) if (book[k] != null && (!Number.isSafeInteger(book[k]) || book[k] < 0)) fail('BOOK_CONFIG', `${k} must be a nonnegative integer.`);
  if (book.recursive_scanning != null && typeof book.recursive_scanning !== 'boolean') fail('BOOK_CONFIG', 'recursive_scanning must be boolean.');
}
export function decodeCard(bytes) {
  if (bytes.length > 32 * 1024 * 1024) fail('LIMIT', 'Card exceeds 32 MiB.');
  if (!bytes.subarray(0, 8).equals(signature)) {
    const card = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')); validateCard(card);
    return { kind: 'json', card, original: bytes, originals: { primary: clone(card) } };
  }
  const chunks = []; let offset = 8, ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail('PNG', 'Truncated PNG chunk.');
    const size = bytes.readUInt32BE(offset); if (size > 32 * 1024 * 1024 || offset + size + 12 > bytes.length) fail('PNG', 'Invalid PNG chunk length.');
    const raw = bytes.subarray(offset, offset + size + 12), type = raw.subarray(4,8).toString('ascii'), data = raw.subarray(8,-4);
    if (crc32(raw.subarray(4,-4)) !== raw.readUInt32BE(raw.length - 4)) fail('PNG_CRC', `CRC failed: ${type}`);
    const key = textKeyword(type, data);
    chunks.push({ type, raw, key }); offset += size + 12;
    if (type === 'IEND') { ended = true; break; }
  }
  if (!ended || chunks[0]?.type !== 'IHDR' || chunks[0].raw.length!==25 || chunks.filter(c=>c.type==='IHDR').length!==1 || !chunks.some(c=>c.type==='IDAT') || chunks.at(-1).raw.length!==12) fail('PNG', 'Missing or invalid PNG structure.');
  // Match the pinned SillyTavern reader: first ccv3 tEXt, otherwise first chara
  // tEXt. Compressed-only cards remain readable locally but fail PNG export's
  // existing Tavern compatibility guard. Never fall through an invalid primary.
  const find=(key,textOnly)=>chunks.findIndex(c=>c.key===key&&(!textOnly||c.type==='tEXt'));
  const primaryIndex=[find('ccv3',true),find('chara',true),find('ccv3',false),find('chara',false)].find(i=>i>=0);
  if(primaryIndex===undefined)fail('PNG_CARD','PNG has no chara/ccv3 card chunk.');
  const primary=chunks[primaryIndex];primary.text=textChunk(primary.type,primary.raw.subarray(8,-4));
  validateCard(primary.text.value);
  if(primary.key==='ccv3'&&primary.text.value.spec!=='chara_card_v3')fail('PNG_CARD','ccv3 chunk is not CCv3.');
  let secondaryCount=0,differingSecondaryCount=0,invalidSecondaryCount=0;
  for(let index=0;index<chunks.length;index++){
    const chunk=chunks[index];if(index===primaryIndex||!chunk.key)continue;secondaryCount++;
    try{
      chunk.text=textChunk(chunk.type,chunk.raw.subarray(8,-4));validateCard(chunk.text.value);
      if(chunk.key==='ccv3'&&chunk.text.value.spec!=='chara_card_v3')fail('PNG_CARD','ccv3 chunk is not CCv3.');
      if(!equal(chunk.text.value,primary.text.value))differingSecondaryCount++;
    }catch(error){chunk.text={key:chunk.key,invalid:true,errorCode:error.code??'PNG_METADATA'};invalidSecondaryCount++;}
  }
  const pngMetadata={primaryIndex,key:primary.key,selection:primary.type==='tEXt'?'sillytavern-first-text':'compressed-local-only',secondaryCount,differingSecondaryCount,invalidSecondaryCount};
  const warnings=differingSecondaryCount||invalidSecondaryCount?[{code:'PNG_ALTERNATE_METADATA',...pngMetadata}]:[];
  return {kind:'png',card:clone(primary.text.value),chunks,primaryIndex,pngMetadata,warnings,trailer:bytes.subarray(offset),original:bytes};
}
export function encodeCard(doc, card) {
  validateCard(card);
  if (card.spec !== doc.card.spec || card.spec_version !== doc.card.spec_version) fail('CARD_VERSION', 'Changing card format is not a local edit.');
  if (doc.kind === 'json') return Buffer.from(JSON.stringify(card, null, 2) + '\n');
  if(equal(doc.card,card))return Buffer.from(doc.original);
  const chunks = doc.chunks.map((chunk,index) => {
    if(index!==doc.primaryIndex)return chunk.raw;
    const {prefix,compressed}=chunk.text;
    const encoded = Buffer.from(Buffer.from(JSON.stringify(card)).toString('base64'), 'ascii');
    return pngChunk(chunk.type, Buffer.concat([prefix, compressed ? deflateSync(encoded) : encoded]));
  });
  const bytes = Buffer.concat([signature,...chunks,doc.trailer]);
  const reread = decodeCard(bytes); if (!equal(reread.card, card)) fail('VERIFY', 'Encoded card does not match requested data.');
  return bytes;
}
export function pointer(root, path) {
  if (typeof path !== 'string' || !path.startsWith('/data/')) fail('PATH', 'Only /data/... JSON pointers are editable.');
  const parts = path.slice(1).split('/').map(x => x.replace(/~1/g,'/').replace(/~0/g,'~'));
  if (parts.some(x => ['__proto__','constructor','prototype'].includes(x))) fail('PATH', 'Unsafe pointer component.');
  let parent = root;
  for (const k of parts.slice(0,-1)) { if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent,k)) fail('PATH', `Missing pointer parent: ${k}`); parent = parent[k]; }
  return { parent, key: parts.at(-1) };
}
export function patchValue(root, patches) {
  const next = clone(root);
  if (!Array.isArray(patches) || !patches.length || patches.length > 100) fail('PATCH', 'Provide 1–100 local patches.');
  for (const p of patches) {
    const { parent, key } = pointer(next, p.path);
    if (p.op === 'test') { if (!equal(parent[key],p.value)) fail('CONFLICT', `Test failed: ${p.path}`); continue; }
    if (!['replace','add','remove'].includes(p.op)) fail('PATCH', 'Only test/add/replace/remove supported.');
    if (p.op !== 'add' && !Object.hasOwn(parent,key)) fail('PATH', `Missing field: ${p.path}`);
    if (Array.isArray(parent)) {
      if (key === '-' && p.op === 'add') { parent.push(clone(p.value)); continue; }
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > parent.length || (p.op !== 'add' && Number(key) === parent.length)) fail('PATH', 'Invalid array index.');
      if (p.op === 'remove') parent.splice(Number(key),1); else if (p.op === 'add') parent.splice(Number(key),0,clone(p.value)); else parent[key] = clone(p.value);
    } else if (p.op === 'remove') delete parent[key]; else parent[key] = clone(p.value);
  }
  validateCard(next); return next;
}
