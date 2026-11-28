// Optional, local per-run actor portrayal. Never part of canonical state or history.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {clone,hash,SceanError} from './contracts.mjs';

export const portrayalFile=(store,runId)=>path.join(store.runDir(runId),'character-portrayal.json');
export function validatePortrayal(value,run){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||
    Object.keys(value).sort().join(',')!=='actorId,firstTurn,runId,schemaVersion,snapshotHash,text'||
    value.schemaVersion!==1||value.runId!==run.runId||value.snapshotHash!==run.snapshot.hash||
    !Number.isSafeInteger(value.firstTurn)||value.firstTurn<1||
    typeof value.actorId!=='string'||value.actorId==='player'||
    !run.snapshot.characters.some(c=>c.id===value.actorId)||
    typeof value.text!=='string'||!value.text.trim()||value.text!==value.text.trim()||
    Buffer.byteLength(value.text,'utf8')>4096||/\p{Surrogate}/u.test(value.text))throw new SceanError('CHARACTER_PORTRAYAL_INVALID');
  return clone(value);
}
export async function pinPortrayal(store,run,prior){
  if(prior.length){
    const pins=prior.map(a=>a.characterPortrayal?validatePortrayal(a.characterPortrayal,run):null);
    if(pins.some(p=>hash(p)!==hash(pins[0]))||pins[0]?.firstTurn>run.turns.length+1)throw new SceanError('CHARACTER_PORTRAYAL_REQUEST_CONFLICT');
    return pins[0];
  }
  if(typeof store.runDir!=='function')return null;
  try{
    const raw=await store.retrySharingViolation(()=>readFile(portrayalFile(store,run.runId),'utf8'));
    let parsed;try{parsed=JSON.parse(raw);}catch{throw new SceanError('CHARACTER_PORTRAYAL_INVALID');}
    const p=validatePortrayal(parsed,run);return p.firstTurn<=run.turns.length+1?p:null;
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}

export function portrayalInstruction(run,p){
  const actor=run.snapshot.characters.find(c=>c.id===p.actorId);
  return '\n\nRUN-LOCAL CHARACTER PORTRAYAL | '+JSON.stringify({actorId:p.actorId,name:actor.name})+'\nFor this actor only, prefer the following portrayal guidance over conflicting characterization examples or habits inferred from old prose. Apply it to this scene only; keep established history, identity, relationships, material facts, each character’s knowledge and autonomy, player agency, consent, and safety constraints intact. Never repeat this instruction in-story or invent an event merely to show the guidance.\n'+p.text;
}
