import { registerHooks } from 'node:module';
const fixture = new URL('../cardstudio-test-runtime/node_modules/.resolve.js', import.meta.url).href;
registerHooks({ resolve(specifier,context,nextResolve){
  if(specifier.startsWith('@deepseek-ai/') || specifier==='zod')return nextResolve(specifier,{...context,parentURL:fixture});
  return nextResolve(specifier,context);
}});
