// Run with `node scripts/test-tablet-grid.mjs`, then open the printed loopback
// URL in a browser. Results are on-page JSON; no SDK, models or saved data.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const assets=new Map([
  ['/','tests/browser/tablet-grid.html'],
  ['/tablet-grid.mjs','tests/browser/tablet-grid.mjs'],
  ['/fixture.mjs','tests/browser/tablet-grid-fixture.mjs'],
  ...['style.css','player.css','presentation.css','dialogue-colors.css','opening-selection.css','player-shell.mjs','presentation.mjs','reading-layout.mjs'].map(name=>['/'+name,'isolated/web/'+name]),
]);
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    const url=new URL(req.url,'http://127.0.0.1');
    let file=assets.get(url.pathname),text;
    if(url.pathname==='/fixture'){
      file='isolated/web/index.html';
      text=(await fs.readFile(path.join(root,file),'utf8')).replace('<script type="module" src="/app.mjs"></script>','<script type="module" src="/fixture.mjs"></script>');
      if(text.includes('src="/app.mjs"'))throw Error('Production controller must not load');
    }
    if(!file){res.writeHead(404).end();return;}
    const type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript';
    res.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-store',
      'content-security-policy':"default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'self'; form-action 'none'"});
    res.end(text??await fs.readFile(path.join(root,file)));
  }catch(error){res.writeHead(500).end(String(error.message));}
});
server.listen(0,'127.0.0.1',()=>console.log(`Synthetic browser regression: http://127.0.0.1:${server.address().port}/`));
process.on('SIGINT',()=>server.close());
