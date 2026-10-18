import { fail } from './codec.js';
export const retrievalCapabilities=Object.freeze({lexical:true,vector:'unavailable',embedding:'unavailable'});
/**
 * Future optional readonly retriever contract (no implementation/provider in 0.1.6):
 * retrieve(query, {limit, signal}) -> {hits, coverage, retrieval_sources}
 * hit = {item_id, source_sha256, locator, retriever_rank}
 * Candidates must be revalidated with LibraryIndex.readEvidence before judgment.
 */
export const optionalVectorRetriever=null;
// Optional future retrievers use source ID + hash + locator hits. No provider or DB here.
export const normalize=value=>value.normalize('NFKC').toLocaleLowerCase();
export function queryTerms(query,expanded=[]) {
  if(typeof query!=='string'||!query.trim()||query.length>500||!Array.isArray(expanded)||expanded.length>12||expanded.some(x=>typeof x!=='string'||!x.trim()||x.length>100))fail('QUERY','Query is 1..500 characters with at most 12 expansion terms of 1..100 characters.');
  let tokens=[];
  if(typeof Intl.Segmenter==='function')tokens=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(query)].filter(x=>x.isWordLike).map(x=>x.segment);
  else tokens=query.match(/[\p{L}\p{N}]+/gu)??[];
  return [...new Set([query.trim(),...expanded,...tokens].map(normalize))].slice(0,32);
}
export function retrieveLexical(query,rows,{query_terms=[],limit=8}={}) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>20)fail('BUDGET','Search limit is 1..20.');
  const terms=queryTerms(query,query_terms),hits=[];
  for(const row of rows){
    let score=0;const evidence=[];
    for(const segment of row.segments){
      const text=normalize(segment.text),matches=terms.filter(term=>text.includes(term));if(!matches.length)continue;
      score+=matches.length*(segment.field==='name'?4:segment.field==='tags'?3:1);
      if(evidence.length>=4)continue;
      // Snippet is exact raw text with raw offsets, even if NFKC changes match offsets.
      const lower=segment.text.toLocaleLowerCase(),literal=matches.map(term=>lower.indexOf(term)).find(n=>n>=0);
      const start=Math.max(0,(literal??0)-100),snippet=segment.text.slice(start,start+240);
      evidence.push({...segment,text:snippet,raw_start:start,raw_end:start+snippet.length,matched_terms:matches.slice(0,8),text_complete:segment.text_complete&&start===0&&snippet.length===segment.text.length});
    }
    if(score)hits.push({row,score,evidence});
  }
  return {hits:hits.sort((a,b)=>b.score-a.score||a.row.item_id.localeCompare(b.row.item_id)).slice(0,limit),terms,retrieval_sources:['lexical'],capabilities:retrievalCapabilities,judgment:'Lexical candidates only. Counts, same-scene relations, negation, timing and prerequisites require source evidence and Agent judgment; synonym hits do not verify facts.'};
}
