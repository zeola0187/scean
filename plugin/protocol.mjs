// Source-mode Typert descriptors: authenticated DSH connection only, no HTTP listener.
export const sceanRemote = {
  package: '@local/dsh-scean',
  descriptors: [{
    id: '@local/dsh-scean#scean/request', service: 'scean', namespace: 'scean', method: 'request',
    invocation: {kind:'direct'},
    parameters: [{name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@local/dsh-scean#Request',create:()=>({parse(value){
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.action !== 'string') throw new TypeError('Expected SCEAN action object.');
      return value;
    }})}}], cancellation:{parameter:'signal'}, result:{mode:'src-json'},
  }],
};
