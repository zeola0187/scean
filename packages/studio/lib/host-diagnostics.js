import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const PACKAGE='@local/dsh-card-studio-scean-test';
const EXPECTED=['@deepseek-ai/dsh-client-ui-conversation','@deepseek-ai/dsh-client-ui-workspace','@deepseek-ai/dsh-client-ui-commands'];

/** Observe only this package's public graph facts; never emit other entries or paths. */
export async function clientRegistryFacts(registry,ownClientFile) {
  const graph=registry.graph(),row=graph.entries.find(entry=>entry.id===PACKAGE);
  const advertisedPath=registry.clientPath(PACKAGE);
  const ownPath=await fs.realpath(ownClientFile);
  let ownBundlePathMatches=false;
  if(advertisedPath!==undefined){
    try{ownBundlePathMatches=(await fs.realpath(advertisedPath))===ownPath;}catch{}
  }
  return {available:true,advertised:!!row,immediately:row?.immediately===true,
    declaredDependenciesPresent:!!row&&EXPECTED.every(id=>row.inject?.includes(id)&&graph.entries.some(entry=>entry.id===id)),
    ownBundlePathMatches,ownBundleSha256:createHash('sha256').update(await fs.readFile(ownClientFile)).digest('hex')};
}

/** Optional native service injection; no new endpoint, timer, required service or dependency. */
export function observeClientRegistry(ctx,ownClientFile,publish) {
  return ctx.inject(['clientModules'],function cardstudioRegistryDiagnostic(scope){
    let active=true,queue=Promise.resolve(),previous;
    const sample=()=>{
      queue=queue.then(async()=>{
        if(!active)return;
        let facts;
        try{facts=await clientRegistryFacts(scope.clientModules,ownClientFile);}
        catch{facts={available:true,readFailed:true};}
        if(!active)return;
        const encoded=JSON.stringify(facts);
        if(encoded===previous)return;
        previous=encoded;
        await publish(facts);
      }).catch(()=>{scope.logger.warn('Card Studio diagnostic status could not be saved.');});
    };
    const unsubscribe=scope.clientModules.onGraphChanged(sample);
    scope.effect(()=>async()=>{active=false;unsubscribe();await queue;},'cardstudio registry diagnostics');
    sample();
  });
}
