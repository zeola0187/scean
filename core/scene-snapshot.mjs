
const allowedFields=['actorId','position','posture','action','clothing','items'];
const idSet=characters=>new Set(['player',...characters.map(x=>x.id)]);
const max=12,fieldMax=140;
export function sceneSchema(characters){
 const str={type:'string',minLength:1,maxLength:fieldMax};
 return {type:'array',maxItems:max,items:{type:'object',additionalProperties:false,required:['actorId'],properties:{actorId:{enum:[...idSet(characters)]},...Object.fromEntries(allowedFields.slice(1).map(k=>[k,str]))}}};
}
export function validScene(v,characters){
 if(!Array.isArray(v)||v.length>max)return false;
 const ids=idSet(characters),seen=new Set();
 for(const row of v){
  if(!row||Object.getPrototypeOf(row)!==Object.prototype||Object.keys(row).some(k=>!allowedFields.includes(k))||Object.keys(row).length<2||!ids.has(row.actorId)||seen.has(row.actorId))return false;
  seen.add(row.actorId);
  if(allowedFields.slice(1).some(k=>Object.hasOwn(row,k)&&(typeof row[k]!=='string'||!row[k].trim()||row[k].length>fieldMax||!row[k].isWellFormed()||/[\x00-\x1f\x7f]/.test(row[k]))))return false;
 }
 return true;
}
export function makeScene(v,characters){return validScene(v,characters)?structuredClone(v):null;}
export function currentScene(run){
 const latest=run.turns?.at(-1);
 const source=run.turns?.findLast(t=>Array.isArray(t.sceneSnapshot));
 return source?{turn:source.turn,commitId:source.commitId,stale:source!==latest,actors:structuredClone(source.sceneSnapshot)}:null;
}
