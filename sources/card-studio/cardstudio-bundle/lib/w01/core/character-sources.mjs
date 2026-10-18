import { createHash } from 'node:crypto';

// Portable creation-time contract, shared byte-for-byte with Card Studio.
// Hashes attest source bytes/selection, not the semantic correctness of attribution.
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => plain(v) && Object.keys(v).every(k => allowed.includes(k));
const nonempty = v => typeof v === 'string' && !!v.trim();
function sourceText(card, worldbook, selector) {
  if (!plain(selector)) fail('CHARACTER_SOURCE_SELECTOR');
  if (selector.kind === 'card_field') {
    if (!keys(selector, ['kind', 'path', 'sha256']) || !nonempty(selector.path) || !selector.path.startsWith('/data/')) fail('CHARACTER_SOURCE_SELECTOR');
    const parts = selector.path.slice(1).split('/').map(x => x.replaceAll('~1','/').replaceAll('~0','~'));
    if (parts.some(x => ['__proto__','constructor','prototype','character_book','sourceBindings'].includes(x)) || parts.slice(0,4).join('/') === 'data/extensions/scean/characters') fail('CHARACTER_SOURCE_SELECTOR');
    let value=card;
    for (const part of parts) { if (!plain(value) || !Object.hasOwn(value,part)) fail('CHARACTER_SOURCE_MISSING'); value=value[part]; }
    if (!nonempty(value)) fail('CHARACTER_SOURCE_TEXT_REQUIRED');
    return value;
  }
  if (selector.kind === 'worldbook_entry') {
    if (!keys(selector, ['kind','entryId','sha256']) || !(nonempty(selector.entryId) || Number.isSafeInteger(selector.entryId))) fail('CHARACTER_SOURCE_SELECTOR');
    const entries = Array.isArray(worldbook?.entries) ? worldbook.entries : Object.values(worldbook?.entries ?? {});
    const matches=entries.filter(e => (e.id ?? e.uid) === selector.entryId);
    if (matches.length !== 1 || !nonempty(matches[0].content)) fail('CHARACTER_SOURCE_ENTRY');
    return matches[0].content;
  }
  fail('CHARACTER_SOURCE_SELECTOR');
}
export function bindCharacterSources(actor, selectors, {card,worldbook}) {
  if (!plain(actor) || !nonempty(actor.id) || !nonempty(actor.description) || !Array.isArray(selectors) || !selectors.length || selectors.length>50) fail('CHARACTER_SOURCE_BINDING');
  const sources=selectors.map(selector => {
    const text=sourceText(card,worldbook,selector);
    const locator=selector.kind==='card_field' ? {kind:selector.kind,path:selector.path} : {kind:selector.kind,entryId:selector.entryId};
    return {...locator,sha256:digest(text)};
  });
  if(new Set(sources.map(s=>JSON.stringify(s))).size!==sources.length)fail('CHARACTER_SOURCE_DUPLICATE');
  return {...structuredClone(actor),sourceBindings:{schemaVersion:1,characterId:actor.id,descriptionHash:digest(actor.description),sources}};
}
export function validateCharacterSources(actor, context) {
  if (actor.sourceBindings === undefined) return; // Legacy explicitly authored backgrounds remain supported.
  const binding=actor.sourceBindings;
  if (!keys(binding,['schemaVersion','characterId','descriptionHash','sources']) || binding.schemaVersion!==1 || binding.characterId!==actor.id || !Array.isArray(binding.sources) || binding.sources.some(s=>!/^[a-f0-9]{64}$/.test(s?.sha256))) fail('CHARACTER_SOURCE_BINDING');
  const expected=bindCharacterSources(actor,binding.sources,context).sourceBindings;
  if(binding.descriptionHash!==expected.descriptionHash || binding.sources.some((s,i)=>s.sha256!==expected.sources[i].sha256))fail('CHARACTER_SOURCE_DRIFT');
}
