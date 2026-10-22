import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { cardstudioRemote } from './bridge-protocol.js';

export class CardStudioBridge extends TypertRemoteService {
  constructor(ctx,dispatch,setAuthoringScope,reviewMaterials,setCharacterMethod,setLibraryRoot) {
    super(ctx,'cardstudioSceanBridge',{namespace:'cardstudioScean'});
    this.dispatch=dispatch;this.humanScope=setAuthoringScope;this.humanMaterials=reviewMaterials;
    this.humanMethod=setCharacterMethod;this.humanLibrary=setLibraryRoot;
    ctx.typert.register({package:cardstudioRemote.package,face:'host',schemas:[],invocations:cardstudioRemote.descriptors});
  }
  async setAuthoringScope(agent,request,signal){return this.humanScope(agent,request,signal);}
  async reviewMaterials(agent,request,signal){return this.humanMaterials(agent,request,signal);}
  async setCharacterMethod(agent,request,signal){return this.humanMethod(agent,request,signal);}
  async setLibraryRoot(agent,request,signal){return this.humanLibrary(agent,request,signal);}
  async sceanControl(agent,request,signal){return this.humanScean(agent,request,signal);}
  async downloadExport(agent,request,signal){return this.humanDownload(agent,request,signal);}
  async savedPanelPreview(agent,request,signal){return this.humanPanelPreview(agent,request,signal);}
  async request(agent,request,signal) { return this.dispatch(agent,request,signal); }
}
