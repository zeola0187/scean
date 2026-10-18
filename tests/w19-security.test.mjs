// Official rc.2 connection/auth service exercised with synthetic credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createHmac} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import * as Connection from '@deepseek-ai/dsh-client-connection';

async function fixture(){
  const ctx=new Context();let record;
  ctx.provide('credentials',{async modifyRecord(_key,change){const value=await change(record);if(value!==undefined)record=value;return record;}});
  await ctx.plugin(WebServer,{host:'127.0.0.1',port:0});
  await ctx.plugin(Connection,{trustedHosts:[],cookieMaxAgeDays:1});
  const connection=ctx.connection,origin=ctx.webServer.getOrigin(),authority=new URL(origin).host;
  ctx.webServer.register({kind:'exact',path:'/',handler(req,res){if(connection.authorizeIndex(req,res)){res.writeHead(200,{'content-type':'text/plain'});res.end('synthetic fixture');}}});
  async function get(target='/',headers={},method='GET'){
    return new Promise((resolve,reject)=>{const req=request(new URL(target,origin),{method,headers},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();});
  }
  let auth;try{auth=await get(connection.authenticatedUrl(origin+'/'));}catch(error){await ctx.fiber.dispose();throw error;}
  const cookie=auth.headers['set-cookie'][0].split(';')[0];
  return {ctx,connection,origin,authority,get,auth,cookie,record:()=>record,close:()=>ctx.fiber.dispose()};
}

test('W19 SEC01 official rc2 HTTP requires valid cookie, rejects malformed token and clears launch URL',async()=>{
  const f=await fixture();try{
    assert.equal((await f.get('/')).status,401);
    assert.equal((await f.get('/?token=invalid')).status,401);
    assert.equal((await f.get('/?token=invalid&token=invalid')).status,401);
    assert.equal((await f.get('/api/remote.mux')).status,401);
    assert.equal((await f.get('/api/remote.mux',{cookie:f.cookie+'tamper'})).status,401);
    assert.equal(f.auth.status,303);assert.equal(f.auth.headers.location,'./');
    assert.equal(f.auth.headers['cache-control'],'no-store');assert.equal(f.auth.headers['referrer-policy'],'no-referrer');
    assert.match(f.auth.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);
    assert.equal((await f.get('/',{cookie:f.cookie})).status,200);
  }finally{await f.close();}
});

test('W19 SEC01 expired and future-dated signed synthetic cookies are rejected',async()=>{
  const f=await fixture();try{
    const [name,value]=f.cookie.split('=');const payload=JSON.parse(Buffer.from(value.split('.')[1],'base64url'));
    function signed(overrides){const body=Buffer.from(JSON.stringify({...payload,...overrides})).toString('base64url');return name+'=v1.'+body+'.'+createHmac('sha256',Buffer.from(f.record().payload.secret,'base64url')).update(body).digest('base64url');}
    const now=Date.now();
    assert.equal((await f.get('/api/remote.mux',{cookie:signed({issuedAt:now-2000,expiresAt:now-1000})})).status,401);
    assert.equal((await f.get('/api/remote.mux',{cookie:signed({issuedAt:now+10000,expiresAt:now+20000})})).status,401);
  }finally{await f.close();}
});

test('W19 SEC02 official HTTP fence rejects hostile Host, Origin, port, null, and cross-site',async()=>{
  const f=await fixture();try{
    for(const extra of [{host:'rebinding.invalid'},{origin:'https://evil.invalid'},{origin:'null'},{origin:'http://127.0.0.1:1'},{'sec-fetch-site':'cross-site'}]){
      const reply=await f.get('/api/remote.mux',{cookie:f.cookie,...extra});assert.equal(reply.status,403,JSON.stringify(extra));assert.equal(reply.headers['access-control-allow-origin'],undefined);
    }
    assert.equal(f.connection.admit({headers:{host:f.authority,cookie:f.cookie,origin:f.origin}}).peer,f.connection.browserPeer);
    assert.equal(f.connection.admit({headers:{host:f.authority,cookie:f.cookie,origin:'https://evil.invalid'}}).rejection,403);
    assert.equal(f.connection.admit({headers:{host:f.authority}}).rejection,401);
  }finally{await f.close();}
});

test('W19 SEC02 characterize upstream same-authority scheme limitation without weakening fence',async()=>{
  const f=await fixture();try{
    const admission=f.connection.admit({headers:{host:f.authority,cookie:f.cookie,origin:'https://'+f.authority}});
    assert.equal(admission.peer,f.connection.browserPeer,'upstream compares authority, not complete scheme origin');
    // A reverse proxy must impose the canonical external scheme itself.
  }finally{await f.close();}
});

test('W19 SEC03 TLS protocol seam mints Secure cookie and binds audience to HTTPS',async()=>{
  const ctx=new Context();let record;
  ctx.provide('credentials',{async modifyRecord(_key,change){const value=await change(record);if(value!==undefined)record=value;return record;}});
  const routes=[];ctx.provide('webServer',{host:'127.0.0.1',protocol:'https:',register(route){routes.push(route);return ()=>{};}});
  await ctx.plugin(Connection,{trustedHosts:[],cookieMaxAgeDays:1});
  try{
    const launch=new URL(ctx.connection.authenticatedUrl('https://127.0.0.1:19449/'));
    let status,headers;const res={writeHead(code,h){status=code;headers=h;},end(){}};
    ctx.connection.authorizeIndex({method:'GET',url:launch.pathname+launch.search,headers:{host:launch.host}},res);
    assert.equal(status,303);assert.match(headers['set-cookie'],/; Secure$/);
    const cookie=headers['set-cookie'].split(';')[0];
    const payload=JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[1],'base64url'));
    assert.equal(payload.authority,'https://127.0.0.1:19449');
    assert.equal(ctx.connection.admit({headers:{host:launch.host,cookie,origin:launch.origin}}).peer,ctx.connection.browserPeer);
    assert.equal(ctx.connection.admit({headers:{host:'127.0.0.1:19450',cookie}}).rejection,401);
  }finally{await ctx.fiber.dispose();}
});
