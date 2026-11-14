// Interactive helper for exploring the Desktop preview: runs one async body against the attached window.
// node scripts/desktop-step.mjs --desktop=<label> "<async body using b, S, sleep, shot>" [shotName]
import path from 'node:path';
import fs from 'node:fs/promises';
import {attach, STAGE_FRAME} from './cdp-driver.mjs';
import {desktopLaunch} from './stage-next-flow.mjs';
const label = process.argv.find(a => a.startsWith('--desktop=')).slice(10), [rawBody, name] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const body = rawBody.startsWith('@') ? await fs.readFile(rawBody.slice(1), 'utf8') : rawBody;
const l = await desktopLaunch(label), b = await attach({port: l.cdp}), S = {frame: STAGE_FRAME}, sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = path.resolve(import.meta.dirname, '..', 'evidence', 'desktop', label, 'explore'); await fs.mkdir(dir, {recursive: true});
const shot = async n => b.shot(path.join(dir, `${Date.now().toString(36)}-${n}.png`));
try { const r = await (new Function('b', 'S', 'sleep', 'shot', 'STAGE_FRAME', `return (async()=>{${body}})()`))(b, S, sleep, shot, STAGE_FRAME); if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1)); }
catch (e) { console.log('ERROR', e.message); }
finally { if (name) console.log('shot', await b.shot(path.join(dir, `${name}.png`))); await b.close(); }
