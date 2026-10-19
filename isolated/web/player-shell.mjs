// Shared HTTP/native presentation only. Story, W01 and operation owners stay in app.mjs.
import {mountPresentation} from './presentation.mjs';
import {mountReadingLayout} from './reading-layout.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};

// UI geometry only; also reacts to programmatic draft restore/clear.
function mountComposerLayout(input,composer,main){
  let frame=0;
  const resize=()=>{
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(!input.getClientRects().length)return;
      const minimum=52,maximum=Math.max(minimum,Math.min(160,(window.visualViewport?.height??innerHeight)*.24));
      input.style.height='0px';input.style.height=(input.value?Math.min(maximum,Math.max(minimum,input.scrollHeight+2)):minimum)+'px';
    });
  };
  const observer=new MutationObserver(resize);
  observer.observe(composer,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','disabled']});
  const bounds=new ResizeObserver(()=>{main.style.setProperty('--composer-height',composer.getBoundingClientRect().height+'px');resize();});
  bounds.observe(composer);input.addEventListener('input',resize);window.addEventListener('resize',resize);resize();
  return {resize,dispose(){cancelAnimationFrame(frame);observer.disconnect();bounds.disconnect();input.removeEventListener('input',resize);window.removeEventListener('resize',resize);}};
}

export function mountPlayerShell(){
  const $=id=>document.getElementById(id),body=document.body,top=document.querySelector('.topbar'),narrow=matchMedia('(max-width:1179px)');
  let readingLayout,composerLayout;
  body.classList.add('player-shell');body.dataset.playerView='library';
  const library=document.querySelector('.library');library.id='library-pane';
  const state=el('aside',undefined,'scene-pane');state.id='scene-pane';
  const sceneTitle=el('h2','此刻的世界');sceneTitle.id='scene-title';sceneTitle.tabIndex=-1;
  state.append(el('p','THE PRESENT','eyebrow'),sceneTitle,el('p','只呈現已保存的公開狀態。','hint'),document.querySelector('.state-panel'));document.querySelector('.layout').append(state);
  const left=el('button','書架','quiet edge-tab'),right=el('button','此刻','quiet edge-tab');left.id='toggle-library';right.id='toggle-scene';
  for(const [button,id,side] of [[left,'library-pane','left'],[right,'scene-pane','right']]){
    const rail=el('nav',undefined,'edge-rail '+side);rail.setAttribute('aria-label',side==='left'?'書架入口':'此刻入口');button.type='button';button.setAttribute('aria-controls',id);rail.append(button);body.append(rail);
    button.addEventListener('pointerdown',e=>{if(document.activeElement===$('input'))e.preventDefault();});
  }
  const syncEdges=()=>{
    for(const [button,name,label,key] of [[left,'library','書架','leftCollapsed'],[right,'state','此刻','rightCollapsed']]){
      const expanded=narrow.matches?body.dataset.playerView===name:body.dataset[key]!=='true';button.textContent=label;button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',(expanded?'收合':'展開')+label);
    }
  };
  const show=(name,focus=false)=>{
    const restore=readingLayout?.preserve();body.dataset.playerView=name;syncEdges();
    if(focus)(name==='story'?$('input'):name==='library'?$('card'):sceneTitle).focus({preventScroll:true});restore?.();composerLayout?.resize();
  };
  // Narrow pane selection is temporary, independent of saved desktop collapse preferences.
  for(const [button,name] of [[left,'library'],[right,'state']])button.addEventListener('click',event=>{
    if(!narrow.matches)return;event.stopImmediatePropagation();const closing=body.dataset.playerView===name;show(closing?'story':name,!closing);if(closing)button.focus({preventScroll:true});
  });
  for(const [pane,button] of [[library,left],[state,right]]){
    const back=el('button','返回故事','quiet pane-back');back.type='button';back.addEventListener('click',()=>{show('story');button.focus({preventScroll:true});});pane.prepend(back);
  }
  const onBreakpoint=()=>{syncEdges();for(const [pane,button] of [[library,left],[state,right]])if(pane.contains(document.activeElement)&&!pane.getClientRects().length)button.focus({preventScroll:true});composerLayout?.resize();};
  narrow.addEventListener('change',onBreakpoint);
  const onEscape=event=>{
    if(event.key==='Escape'&&!event.isComposing&&narrow.matches&&body.dataset.playerView!=='story'&&!document.querySelector('dialog[open]')){const button=body.dataset.playerView==='library'?left:right;show('story');button.focus({preventScroll:true});event.preventDefault();}
  };document.addEventListener('keydown',onEscape);

  const preview=el('section',undefined,'card-preview');preview.setAttribute('aria-label','卡片與保存版本預覽');
  const cover=el('div',undefined,'card-cover');cover.id='card-cover';cover.setAttribute('aria-hidden','true');cover.append(el('span','S / C','cover-monogram'),el('span','A STORY TO ENTER','cover-caption'));
  const title=el('h2','選擇你的故事');title.id='card-title';const desc=el('p',undefined,'card-description');desc.id='card-description';
  const revision=el('p',undefined,'revision-confirm');revision.id='revision-confirm';preview.append(cover,title,desc,revision);$('create-form').prepend(preview);
  $('setup').querySelector('summary').textContent='開始一段故事';$('create').textContent='確認版本，開啟新故事';

  const main=$('player'),reading=el('section',undefined,'reading-pane');reading.id='reading-pane';reading.setAttribute('aria-label','故事閱讀區');reading.tabIndex=0;
  const diagnosticEntry=$('agent-diagnose');if(diagnosticEntry)document.querySelector('.composer-actions').prepend(diagnosticEntry);
  const backup=$('backup-panel'),turnTools=el('details');turnTools.id='turn-tools';turnTools.append(el('summary','回合操作'),document.querySelector('.history-actions'));
  const prefs=el('details');prefs.id='preferences-panel';prefs.append(el('summary','閱讀與版面'));
  const fontLabel=el('label','閱讀字級'),font=el('select');font.id='reading-size';for(const [v,t] of [['normal','標準'],['large','大字']]){const o=el('option',t);o.value=v;font.append(o);}fontLabel.append(font);prefs.append(fontLabel);
  const themeLabel=el('label','顯示模式'),theme=el('select');theme.id='reading-theme';for(const [v,t] of [['system','跟隨系統'],['light','淺色'],['dark','深色']]){const o=el('option',t);o.value=v;theme.append(o);}themeLabel.append(theme);prefs.append(themeLabel);
  const paletteLabel=el('label','深色配色'),palette=el('select');palette.id='dark-palette';for(const [v,t] of [['black','深黑'],['forest','森林綠'],['wine','酒紅']]){const o=el('option',t);o.value=v;palette.append(o);}paletteLabel.append(palette);prefs.append(paletteLabel,el('p','切換深色時套用；淺色外觀維持原有配色。','hint'));
  const widthLabel=el('label','閱讀寬度'),width=el('select');width.id='reading-width';for(const [v,t] of [['comfortable','舒適'],['wide','寬版']]){const o=el('option',t);o.value=v;width.append(o);}widthLabel.append(width);prefs.append(widthLabel);
  const preferenceStatus=el('p',undefined,'hint');preferenceStatus.id='presentation-status';preferenceStatus.setAttribute('role','status');prefs.append(preferenceStatus,el('p','Enter 換行；Ctrl / ⌘ + Enter 送出。長輸入會自動增高至上限，之後可在輸入框內捲動。','hint'));
  const ban=el('form');ban.id='banlist-form';const bl=el('label','機械 BanList（每行一項）');bl.htmlFor='banlist-input';const bt=el('textarea');bt.id='banlist-input';bt.rows=4;const bs=el('button','保存 BanList');bs.id='banlist-save';bs.type='submit';bs.disabled=true;const bn=el('p',undefined,'hint');bn.id='banlist-status';bn.setAttribute('role','status');ban.append(bl,bt,bs,bn);prefs.append(ban);
  const runInfo=el('details');runInfo.id='run-info-panel';runInfo.append(el('summary','本局資料'),$('run-version'),$('player-identity-panel'));
  const about=el('details');about.id='about-panel';about.append(el('summary','來源、授權與連線資訊'),$('scean-source-offer'),$('mode-banner'));
  const help=document.querySelector('.help');help.open=true;about.append(help,el('p','模型由目前啟動的既有設定提供；此介面沒有切換模型的接口。','hint'));

  const runHeader=document.querySelector('.run-header'),runTitle=$('run-title'),saveStatus=$('save-status');const brand=top.firstElementChild;brand.className='stage-brand';brand.querySelector('p')?.remove();
  runTitle.classList.add('stage-title');top.append(runTitle,saveStatus);
  const settingsOpen=el('button','設定','quiet');settingsOpen.id='settings-open';settingsOpen.type='button';settingsOpen.setAttribute('aria-haspopup','dialog');settingsOpen.setAttribute('aria-controls','settings-dialog');top.append(settingsOpen,$('connection'));runHeader.remove();
  reading.append(document.querySelector('.history-pagination'),$('history-page-error'),$('chat'),$('provisional'));main.insertBefore(reading,document.querySelector('.composer'));
  const jump=el('button','↓ 回到故事末尾','quiet jump-latest');jump.id='jump-latest';jump.type='button';jump.hidden=true;main.insertBefore(jump,document.querySelector('.composer'));
  const atEnd=()=>reading.scrollHeight-reading.clientHeight-reading.scrollTop<100;reading.addEventListener('scroll',()=>{jump.hidden=atEnd();},{passive:true});jump.addEventListener('click',()=>reading.scrollTo({top:reading.scrollHeight,behavior:'instant'}));
  readingLayout=mountReadingLayout(reading);
  const presentation=mountPresentation({font,theme,palette,width,left,right,status:preferenceStatus,beforeLayoutChange:value=>{
    for(const [pane,button,collapsed] of [[library,left,value.leftCollapsed],[state,right,value.rightCollapsed]])if(collapsed&&pane.contains(document.activeElement)&&button.getClientRects().length)button.focus({preventScroll:true});const restore=readingLayout.preserve();return()=>{restore();syncEdges();};
  }});

  const hub=el('dialog',undefined,'tool-dialog settings-dialog');hub.id='settings-dialog';hub.setAttribute('aria-labelledby','settings-title');
  const hubHeading=el('header',undefined,'tool-heading'),hubTitle=el('h2','設定');hubTitle.id='settings-title';const hubClose=el('button','返回故事','quiet');hubClose.type='button';hubClose.id='settings-close';hubHeading.append(hubTitle,hubClose);
  const nav=el('nav',undefined,'settings-navigation');nav.setAttribute('aria-label','設定分類');hub.append(hubHeading,nav);body.append(hub);
  const panels=el('div',undefined,'tool-panels');body.append(panels);const menuButtons=new Map(),dialogs=[];
  const openHub=target=>{if(document.querySelector('dialog[open]'))return;hub.returnValue='dismiss';hub.showModal();settingsOpen.setAttribute('aria-expanded','true');(target??hubClose).focus({preventScroll:true});};
  settingsOpen.setAttribute('aria-expanded','false');settingsOpen.addEventListener('click',()=>openHub());hubClose.addEventListener('click',()=>hub.close('dismiss'));
  hub.addEventListener('close',()=>{settingsOpen.setAttribute('aria-expanded','false');if(hub.returnValue!=='navigate')settingsOpen.focus({preventScroll:true});});
  const tools=[[turnTools,'回合操作'],[$('longform-panel'),'章節與回顧'],[backup,'備份與匯入'],[prefs,'閱讀與版面'],[runInfo,'本局資料'],[$('inspector'),'診斷'],[about,'來源、授權與連線資訊']];
  for(const [details,label] of tools){
    const summary=details.querySelector(':scope > summary');summary.textContent=label;summary.hidden=true;
    const menu=el('button',label+'　›','quiet');menu.id='settings-'+details.id;menu.type='button';menu.setAttribute('aria-haspopup','dialog');menuButtons.set(details.id,menu);nav.append(menu);
    const dialog=el('dialog',undefined,'tool-dialog');dialog.id=details.id+'-dialog';dialog.setAttribute('aria-label',label);menu.setAttribute('aria-controls',dialog.id);
    const heading=el('header',undefined,'tool-heading'),back=el('button','返回設定','quiet drawer-close'),dismiss=el('button','返回故事','quiet tool-dismiss');back.type=dismiss.type='button';heading.append(el('h2',label),back,dismiss);dialog.append(heading);
    for(const child of [...details.childNodes])if(child!==summary)dialog.append(child);details.classList.add('tool-panel');details.append(dialog);panels.append(details);dialogs.push(dialog);
    const open=()=>{if(hub.open)hub.close('navigate');for(const d of dialogs)if(d!==dialog&&d.open)d.close('navigate');if(!dialog.open){dialog.returnValue='external';dialog.showModal();back.focus({preventScroll:true});}};
    menu.addEventListener('click',()=>{details.open=true;open();});back.addEventListener('click',()=>dialog.close('back'));dismiss.addEventListener('click',()=>dialog.close('dismiss'));
    dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close('back');});
    dialog.addEventListener('close',()=>{details.open=false;if(dialog.returnValue==='back')openHub(menu);else if(dialog.returnValue==='dismiss')settingsOpen.focus({preventScroll:true});});
    // Existing app listeners still follow details.open (Inspector refresh, etc.).
    details.addEventListener('toggle',()=>{if(details.open&&!dialog.open)open();else if(!details.open&&dialog.open)dialog.close('dismiss');});
  }
  // Keep the existing global form/controller and its key-clearing/cancellation behavior.
  const globalOpen=$('global-chapter-open'),globalDialog=$('global-chapter-dialog');let returnFromGlobal=false;
  globalOpen.textContent='舞臺全域設定　›';globalOpen.setAttribute('aria-haspopup','dialog');globalOpen.setAttribute('aria-controls',globalDialog.id);nav.insertBefore(globalOpen,menuButtons.get('inspector'));
  globalOpen.addEventListener('click',()=>{returnFromGlobal=false;hub.close('navigate');},{capture:true});
  $('global-chapter-close').textContent='返回設定';$('global-chapter-close').addEventListener('click',()=>{returnFromGlobal=true;},{capture:true});globalDialog.addEventListener('cancel',()=>{returnFromGlobal=true;});
  globalDialog.addEventListener('close',()=>{if(returnFromGlobal){returnFromGlobal=false;openHub(globalOpen);}});
  for(const id of ['rollback-open','regenerate-open'])$(id).addEventListener('click',()=>turnTools.querySelector('dialog').close('external'),{capture:true});
  $('history-dialog').addEventListener('close',()=>{show('story');settingsOpen.focus({preventScroll:true});});
  $('longform-panel').addEventListener('click',event=>{if(event.target.closest('.chapter-detail-source,#chapters button,.summary-card button')){$('longform-panel').querySelector('dialog').close('external');show('story');reading.focus({preventScroll:true});}});
  const identity=$('player-identity-panel'),identityMenu=menuButtons.get('run-info-panel');
  const syncIdentity=()=>{const unbound=!identity.hidden&&!$('player-bind-form').hidden;settingsOpen.textContent=unbound?'設定 · 補名':'設定';identityMenu.textContent=unbound?'本局資料 · 可補主角名　›':'本局資料　›';};
  const identityObserver=new MutationObserver(syncIdentity);identityObserver.observe(identity,{subtree:true,attributes:true,attributeFilter:['hidden']});syncIdentity();
  const titleObserver=new MutationObserver(()=>{runTitle.title=runTitle.textContent;});titleObserver.observe(runTitle,{childList:true,subtree:true,characterData:true});runTitle.title=runTitle.textContent;
  composerLayout=mountComposerLayout($('input'),document.querySelector('.composer'),main);
  const syncViewport=()=>{const vv=window.visualViewport;if(vv&&Math.abs(vv.scale-1)>.02)return;document.documentElement.style.setProperty('--player-height',(vv?.height??innerHeight)+'px');document.documentElement.style.setProperty('--player-top',(vv?.offsetTop??0)+'px');body.classList.toggle('short-viewport',(vv?.height??innerHeight)<580);composerLayout.resize();};
  window.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);syncViewport();
  window.addEventListener('pagehide',()=>{presentation.dispose();readingLayout.dispose();composerLayout.dispose();identityObserver.disconnect();titleObserver.disconnect();narrow.removeEventListener('change',onBreakpoint);document.removeEventListener('keydown',onEscape);window.removeEventListener('resize',syncViewport);window.visualViewport?.removeEventListener('resize',syncViewport);window.visualViewport?.removeEventListener('scroll',syncViewport);},{once:true});
  return {show,atEnd,scrollEnd(){reading.scrollTop=reading.scrollHeight;},reading,
    preview(card,rev,opening){title.textContent=card?.title??'從 Studio 帶入故事';const data=rev?.snapshot?.card?.data??rev?.snapshot?.card;desc.textContent=data?.description??(card?'已保存的角色卡。':'請透過 Studio 交接已保存版本；已存在的故事可從書架繼續。');revision.textContent=rev?`固定 ${rev.label??rev.revision??rev.id} · ${rev.snapshot?.worldbook?.entries?.length??0} 筆世界書 · Preset 隨快照保存`:'新版本會另開故事，原局保留原快照。';
      // Only existing embedded raster covers; never fetch arbitrary remote URLs or render SVG/HTML.
      const source=data?.avatar??data?.image??rev?.snapshot?.card?.avatar;
      cover.querySelector('img')?.remove();if(typeof source==='string'&&source.length<3*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)){const image=el('img');image.src=source;image.alt='';image.addEventListener('error',()=>image.remove(),{once:true});cover.append(image);}
      $('create-form').classList.toggle('no-catalog',!card);
    },committed(){show('story');},
  };
}
