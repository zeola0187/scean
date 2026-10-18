// Acceptance-only guard: deny outgoing non-loopback HTTP, fetch and sockets.
const net=require('node:net'),http=require('node:http'),https=require('node:https');
const local=host=>host===undefined||['localhost','127.0.0.1','::1','[::1]'].includes(host);
function check(input){
  if(typeof input==='number')return;
  if(typeof input==='string'&&!input.includes('://'))return;
  const value=typeof input==='string'||input instanceof URL?new URL(input):input;
  if(value?.path&&!value?.host&&!value?.hostname&&!value?.port)return;
  if(!local(value?.hostname??value?.host))throw Error('W19_EXTERNAL_NETWORK_FORBIDDEN');
}
for(const [obj,key]of [[http,'request'],[http,'get'],[https,'request'],[https,'get']]){const original=obj[key];obj[key]=function(...args){check(args[0]);return original.apply(this,args);};}
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  let values=args;if(Array.isArray(values[0]))values=values[0];
  if(typeof values[0]==='object')check(values[0]);else if(typeof values[1]==='string'&&!local(values[1]))throw Error('W19_EXTERNAL_NETWORK_FORBIDDEN');
  return connect.apply(this,args);
};
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...args){check(input&&typeof input==='object'&&'url'in input?input.url:input);return originalFetch(input,...args);};
