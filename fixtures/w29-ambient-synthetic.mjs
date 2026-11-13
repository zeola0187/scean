import {routineFixture} from './w29-routine-synthetic.mjs';
export const ambientPolicy={schemaVersion:2,calendar:false,forum:true,medium:{id:'public-board',label:'Synthetic public town board'},ambientPosts:{schemaVersion:1,enabled:true,publicContext:'A small synthetic harbor town with a public noticeboard. Public daily life only.'}};
export const ambientProposal=()=>({schemaVersion:2,kind:'forum_post',author:{kind:'ambient',displayName:'路人甲'},decision:'publish',title:'Harbor weather chatter',text:'I think the wind feels gentler near the harbor. This is only my impression.',epistemic:'belief'});
export async function ambientFixture({count=4,policy={},snapshot={},onCall,...options}={}){
 const characters=Array.from({length:count},(_,i)=>({id:i<26?String.fromCharCode(97+i):'actor-'+i,name:'Actor '+i,description:'OWNER_ONLY_BACKGROUND_'+i,publicDescription:'A public town resident',private:{visibility:'private',text:'OWNER_SECRET_CANARY_'+i}}));
 return routineFixture({...options,policy:{...ambientPolicy,...policy},snapshot:{characters,...snapshot},onCall:async a=>{
  if(onCall){const result=await onCall(a);if(result)return result;}
  if(a.stage==='forum_post')return{text:JSON.stringify(a.input.author?.kind==='ambient'?ambientProposal():{schemaVersion:1,kind:'forum_post',authorId:a.input.character.id,decision:'decline',title:'',text:'',epistemic:'subjective'})};
 }});
}
