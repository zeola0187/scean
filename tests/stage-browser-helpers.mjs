import fs from 'node:fs/promises';
export async function stageDocuments(){
 const source=await fs.readFile(new URL('../plugin/client.js',import.meta.url),'utf8'),mark="})(require('react'),",start=source.indexOf(mark)+mark.length;
 if(start<mark.length||source[start]!=='{')throw Error('Compiled Stage documents missing');let depth=0,string=false,escape=false;
 for(let i=start;i<source.length;i++){const c=source[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&!--depth)return JSON.parse(source.slice(start,i+1));}
 throw Error('Compiled Stage documents incomplete');
}
