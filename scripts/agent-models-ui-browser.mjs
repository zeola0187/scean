// Test-only browser driver. Select the visible native iframe after layout changes.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export async function launchAgentModelBrowser(directory){
 const {chromium}=require(process.env.SCEAN_PLAYWRIGHT_MODULE??'playwright');
 const context=await chromium.launchPersistentContext(directory,{headless:true,executablePath:process.env.SCEAN_BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',viewport:{width:1440,height:1000},args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-proxy-server']});
 const page=context.pages()[0]??await context.newPage();let surface=page;page.setDefaultTimeout(20000);
 return {
  evaluate:expression=>surface.evaluate(expression),
  wait:async(expression,timeout=20000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await surface.evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Native UI predicate timeout: '+expression);},
  frames:()=>surface.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'),
  click:selector=>surface.locator(selector).first().click(),
  select:(selector,value)=>surface.locator(selector).first().selectOption(value),
  key:key=>page.keyboard.press(key),
  resize:(width,height)=>page.setViewportSize({width,height}),
  screenshot:file=>page.screenshot({path:file,fullPage:false}),
  async navigate(url){if(!url.startsWith('http://127.0.0.1:'))throw Error('SYNTHETIC_LOCALHOST_REQUIRED');surface=page;await page.goto(url,{waitUntil:'domcontentloaded'});},
  async nativeFrame(){const iframe=page.locator('iframe[data-scean-native-player]:visible').first();await iframe.waitFor({state:'visible',timeout:30000});surface=await (await iframe.elementHandle()).contentFrame();if(!surface)throw Error('NATIVE_FRAME_UNAVAILABLE');await surface.locator('#reading-pane').waitFor({state:'visible'});},
  topFrame(){surface=page;},
  async call(method){if(method!=='Page.reload')throw Error('UNSUPPORTED_TEST_COMMAND');surface=page;await page.reload({waitUntil:'domcontentloaded'});},
  on(event,handler){if(event==='Runtime.exceptionThrown')page.on('pageerror',error=>handler({exceptionDetails:{exception:{description:error.message}}}));},
  close:()=>context.close(),
 };
}
