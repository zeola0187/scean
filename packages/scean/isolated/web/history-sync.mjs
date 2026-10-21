// A read projection has its own acknowledgement; accepting a Run is not loading its text.
export class HistorySync {
  constructor({now=()=>Date.now()}={}){this.now=now;this.reset();}
  reset(){this.runId=null;this.desiredHead=null;this.desiredVersion=null;this.loadedHead=null;this.loadedForHead=null;this.loadedForVersion=null;this.dirty=false;this.historical=false;this.failures=0;this.retryAt=0;}
  want(run){
    if(this.runId!==run.runId){this.reset();this.runId=run.runId;}
    const head=run.head??null;
    if(this.desiredHead!==head||this.desiredVersion!==run.version){this.desiredHead=head;this.desiredVersion=run.version;this.dirty=true;this.retryAt=0;}
  }
  accepts(page){return page?.runId===this.runId&&page.head===this.desiredHead&&(page.version===undefined||page.version===this.desiredVersion);}
  loaded(page,{historical=false}={}){
    if(!this.accepts(page))return false;
    const tail=page.turns?.at(-1)?.commitId??null;
    if(!historical&&tail!==this.desiredHead)return false;
    this.loadedHead=tail;this.loadedForHead=page.head;this.loadedForVersion=this.desiredVersion;this.historical=historical;this.dirty=false;this.failures=0;this.retryAt=0;return true;
  }
  failed(){this.dirty=true;this.failures=Math.min(6,this.failures+1);this.retryAt=this.now()+Math.min(30000,500*2**this.failures);}
  due(force=false){return this.dirty&&(force||this.now()>=this.retryAt);}
  get newAvailable(){return this.historical&&this.loadedHead!==this.desiredHead;}
}
