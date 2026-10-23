// Shared HTTP/native presentation only. Story, W01 and operation owners stay in app.mjs.
import {mountPresentation} from './presentation.mjs';
import {mountReadingLayout} from './reading-layout.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};

// UI geometry only; also reacts to programmatic draft restore/clear.
function mountComposerLayout(input,composer,main){
  let frame=0;const placeholder=input.placeholder;
  const header=[...document.querySelectorAll('.stage-mobile-bar,.product-nav,#stage-heading,.view-tabs')];
  const resize=()=>{
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(!input.getClientRects().length)return;
      const mobile=matchMedia('(max-width:760px)').matches,minimum=32;
      const maximum=Math.max(minimum,Math.min(mobile?112:128,(window.visualViewport?.height??innerHeight)*.22));
      const scroll=input.scrollTop;input.placeholder=mobile?'輸入行動或對話…':placeholder;
      for(const [id,full,short] of [['send','送出行動','送出 ↑'],['cancel','取消本輪','取消'],['new-body-open','查看本輪正文',mobile?'正文':'本輪正文']]){
        const button=document.getElementById(id);if(button){button.setAttribute('aria-label',full);button.title=full;if(button.textContent!==short)button.textContent=short;}
      }
      input.style.height='0px';input.style.height=(input.value?Math.min(maximum,Math.max(minimum,input.scrollHeight)):minimum)+'px';
      input.scrollTop=scroll;
    });
  };
  const observer=new MutationObserver(resize);
  observer.observe(composer,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','disabled']});
  const bounds=new ResizeObserver(()=>{
    const height=composer.getBoundingClientRect().height+'px';main.style.setProperty('--composer-height',height);document.body.style.setProperty('--scean-composer-height',height);
    const topHeight=(header.reduce((height,node)=>height+node.getBoundingClientRect().height,0)+1)+'px';
    main.style.setProperty('--stage-top-height',topHeight);document.body.style.setProperty('--scean-stage-top-height',topHeight);resize();
  });
  for(const node of [composer,...header])bounds.observe(node);input.addEventListener('input',resize);window.addEventListener('resize',resize);resize();
  return {resize,dispose(){cancelAnimationFrame(frame);observer.disconnect();bounds.disconnect();input.removeEventListener('input',resize);window.removeEventListener('resize',resize);}};
}

export function mountPlayerShell(){
  const $=id=>document.getElementById(id),body=document.body,top=document.querySelector('.topbar'),narrow=matchMedia('(max-width:760px)');
  let readingLayout,composerLayout;
  body.classList.add('player-shell');body.dataset.playerView='library';
  const library=document.querySelector('.library');library.id='library-pane';
  const shelf=el('section',undefined,'stage-library');shelf.id='stage-library';const shelfTitle=el('h2','書架');shelfTitle.id='library-title';shelfTitle.tabIndex=-1;shelf.append(el('p','YOUR STORY','eyebrow'),shelfTitle);
  const stageSettings=el('section',undefined,'stage-settings');stageSettings.id='stage-settings';const scripts=el('details',undefined,'stage-scripts');scripts.id='stage-scripts';const scriptsSummary=el('summary','劇本與演出');scripts.append(scriptsSummary,library.querySelector('.section-heading'),$('runs'));const readers=el('section',undefined,'stage-readers');readers.id='stage-readers';const recycle=el('section',undefined,'stage-recycle');recycle.id='stage-recycle';library.prepend(shelf,stageSettings,scripts,readers,recycle);
  const state=el('aside',undefined,'scene-pane');state.id='scene-pane';
  const sceneTitle=el('h2','此刻');sceneTitle.id='scene-title';sceneTitle.tabIndex=-1;
  state.append(el('p','THE PRESENT','eyebrow'),sceneTitle,el('p','只呈現已保存的公開狀態。','hint'),document.querySelector('.state-panel'));document.querySelector('.layout').append(state);
  const left=el('button','書架','quiet edge-tab'),right=el('button','此刻','quiet edge-tab');left.id='toggle-library';right.id='toggle-scene';
  for(const [button,id,side] of [[left,'library-pane','left'],[right,'scene-pane','right']]){
    const rail=el('nav',undefined,'edge-rail '+side);rail.setAttribute('aria-label',side==='left'?'書架入口':'此刻入口');button.type='button';button.setAttribute('aria-controls',id);rail.append(button);body.append(rail);
    button.addEventListener('pointerdown',e=>{if(document.activeElement===$('input'))e.preventDefault();});
  }
  const tabs=el('nav',undefined,'view-tabs');tabs.setAttribute('aria-label','舞台區域');const paneTabs=new Map();for(const [name,label]of [['library','書架'],['story','故事'],['state','此刻']]){const button=el('button',label,'quiet');button.type='button';button.dataset.pane=name;button.addEventListener('click',()=>show(name));paneTabs.set(name,button);tabs.append(button);}top.after(tabs);
  const syncEdges=()=>{
    for(const [name,button]of paneTabs)button.setAttribute('aria-current',String(body.dataset.playerView===name));
    for(const [button,name,label,key] of [[left,'library','書架','leftCollapsed'],[right,'state','此刻','rightCollapsed']]){
      const expanded=narrow.matches?body.dataset.playerView===name:body.dataset[key]!=='true';button.textContent=label;button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',(expanded?'收合':'展開')+label);
    }
  };
  const show=(name,focus=false)=>{
    const restore=readingLayout?.preserve();body.dataset.playerView=name;syncEdges();
    if(focus)(name==='story'?$('input'):name==='library'?shelfTitle:sceneTitle).focus({preventScroll:true});restore?.();composerLayout?.resize();
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
  const cover=el('div',undefined,'card-cover');cover.id='card-cover';cover.setAttribute('aria-hidden','true');cover.append(el('span','SCEAN','cover-monogram'),el('span','A STORY TO ENTER','cover-caption'));
  const title=el('h2','選擇你的故事');title.id='card-title';const desc=el('p',undefined,'card-description');desc.id='card-description';
  const revision=el('p',undefined,'revision-confirm');revision.id='revision-confirm';preview.append(cover,title,desc,revision);shelf.append(preview);
  $('setup').querySelector('summary').textContent='準備新演出';$('setup').open=false;$('create').textContent='確認版本，開啟新故事';

  const main=$('player'),reading=el('section',undefined,'reading-pane');reading.id='reading-pane';reading.setAttribute('aria-label','故事閱讀區');reading.tabIndex=0;
  const diagnosticEntry=$('agent-diagnose');if(diagnosticEntry)$('inspector').append(diagnosticEntry);
  const backup=$('backup-panel'),turnTools=el('details');turnTools.id='turn-tools';turnTools.append(el('summary','回合操作'),document.querySelector('.history-actions'));
  const prefs=el('details');prefs.id='preferences-panel';prefs.append(el('summary','閱讀與版面'));
  const fontLabel=el('label','閱讀字級'),font=el('select');font.id='reading-size';for(const [v,t] of [['normal','標準'],['large','大字']]){const o=el('option',t);o.value=v;font.append(o);}fontLabel.append(font);prefs.append(fontLabel);
  const themeLabel=el('label','顯示模式'),theme=el('select');theme.id='reading-theme';for(const [v,t] of [['system','跟隨系統'],['light','淺色'],['dark','深色']]){const o=el('option',t);o.value=v;theme.append(o);}themeLabel.append(theme);prefs.append(themeLabel);
  const paletteLabel=el('label','深色配色'),palette=el('select');palette.id='dark-palette';for(const [v,t] of [['black','深黑'],['forest','森林綠'],['wine','酒紅']]){const o=el('option',t);o.value=v;palette.append(o);}paletteLabel.append(palette);prefs.append(paletteLabel,el('p','切換深色時套用；淺色外觀維持原有配色。','hint'));
  const widthLabel=el('label','閱讀寬度'),width=el('select');width.id='reading-width';for(const [v,t] of [['comfortable','舒適'],['wide','寬版']]){const o=el('option',t);o.value=v;width.append(o);}widthLabel.append(width);prefs.append(widthLabel);
  const preferenceStatus=el('p',undefined,'hint');preferenceStatus.id='presentation-status';preferenceStatus.setAttribute('role','status');prefs.append(preferenceStatus,el('p','Enter 換行；Ctrl / ⌘ + Enter 送出。長輸入會自動增高至上限，之後可在輸入框內捲動。','hint'));
  const ban=el('form');ban.id='banlist-form';const bl=el('label','機械 BanList（每行一項）');bl.htmlFor='banlist-input';const bt=el('textarea');bt.id='banlist-input';bt.rows=4;const bs=el('button','保存 BanList');bs.id='banlist-save';bs.type='submit';bs.disabled=true;const bn=el('p',undefined,'hint');bn.id='banlist-status';bn.setAttribute('role','status');ban.append(bl,bt,bs,bn);prefs.append(ban);
  const runInfo=el('details');runInfo.id='run-info-panel';runInfo.append(el('summary','本局資料'),$('run-version'),$('player-identity-panel'));
  const modeSection=el('section');modeSection.setAttribute('aria-label','本局寫作方式');modeSection.append(el('h3','本局寫作方式'));
  const mf=el('form');mf.id='writing-mode-form';const ml=el('label','寫作方式');ml.id='writing-mode-label';ml.htmlFor='writing-mode-input';const mi=el('select');mi.id='writing-mode-input';for(const [value,label] of [['single_writer','單一 Writer']]){const o=el('option',label);o.value=value;mi.append(o);}const ms=el('button','保存寫作方式');ms.id='writing-mode-save';ms.type='submit';ms.disabled=true;
  const mc=el('button','取消模式修改','quiet');mc.id='writing-mode-cancel';mc.type='button';const mr=el('button','放棄模式草稿並重新讀取','quiet');mr.id='writing-mode-reload';mr.type='button';const mt=el('p','請先選一局故事。','hint');mt.id='writing-mode-status';mt.setAttribute('role','status');mf.append(ml,mi,ms,mc,mr,mt);const modeInfo=el('details');modeInfo.append(el('summary','流程與用量說明'),el('p','採用單一 Writer：導演按需查證與判斷，Writer 一次組合完整正文。舊存檔若已明確選定舊流程，僅保留相容；可在此改用單一 Writer。','hint'),el('p','在相容存檔中改用單一 Writer，會從下一個新回合生效；生成中及同一請求重試保持原流程。不改舊正文、固定快照或文風。','hint'),el('p','寫作方法文字計入實際提示與用量。單一 Writer 無工具普通回合為導演、正文、結算三次生成；按需諮詢及必要局部修復另計，沿用原有上限。','hint'));modeSection.append(mf,modeInfo);runInfo.append(modeSection);
  const style=el('section');style.setAttribute('aria-label','本局文風');style.append(el('h3','本局文風'));
  const sf=el('form');sf.id='prose-style-form';const pickLabel=el('label','選擇寫作風格');pickLabel.htmlFor='prose-style-select';const pick=el('select');pick.id='prose-style-select';const imp=el('button','匯入文風包','quiet');imp.id='prose-style-import';imp.type='button';const impFile=el('input');impFile.type='file';impFile.accept='.json,application/json';impFile.id='prose-style-import-file';impFile.hidden=true;const sl=el('label','文風內容（可直接修改）');sl.htmlFor='prose-style-input';const si=el('textarea');si.id='prose-style-input';si.rows=6;si.maxLength=12000;si.placeholder='自由寫下節奏、用字或描寫方式；可隨時改寫，不限固定類型。';
  const ss=el('button','保存文風');ss.id='prose-style-save';ss.type='submit';ss.disabled=true;
  const sc=el('button','清空文風','quiet');sc.id='prose-style-clear';sc.type='button';const cancel=el('button','取消修改','quiet');cancel.id='prose-style-cancel';cancel.type='button';const reload=el('button','重新讀取已保存文風','quiet');reload.id='prose-style-reload';reload.type='button';
  const st=el('p','請先選一局故事。','hint');st.id='prose-style-status';st.setAttribute('role','status');sf.append(pickLabel,pick,imp,impFile,el('p','選擇會載入完整文風 Skill；改寫內容後即為自訂，不會疊加另一份風格。','hint'),sl,si,ss,sc,cancel,reload,st);style.append(sf,el('p','文風由 Host 在單一 Writer 開始書寫前完整載入，不靠模型自行決定讀取。保存後下一個新回合採用；正在生成或同一請求重試保留原設定，舊正文與固定快照不變。','hint'),el('p','此欄僅在文風上優先於 Preset；不改事件、行動者、玩家決策、拒絕與結果。清空並保存可還原原行為。','hint'));
  const examples=el('details');examples.append(el('summary','可改寫的範例'));for(const [id,label] of [['prose-style-example-light','填入輕快對話範例'],['prose-style-example-quiet','填入克制描寫範例']]){const b=el('button',label,'quiet');b.id=id;b.type='button';examples.append(b);}style.append(examples);runInfo.append(style);
  const about=el('details');about.id='about-panel';about.append(el('summary','來源、授權與連線資訊'),$('scean-source-offer'),$('mode-banner'));
  const help=document.querySelector('.help');help.open=true;about.append(help,el('p','模型由目前啟動的既有設定提供；此介面沒有切換模型的接口。','hint'));

  const runHeader=document.querySelector('.run-header'),runTitle=$('run-title'),saveStatus=$('save-status');const brand=top.firstElementChild;brand.remove();
  top.classList.add('product-nav');top.setAttribute('aria-label','SCEAN 產品導覽');
  const brandButton=el('button',undefined,'product-brand quiet');brandButton.type='button';brandButton.dataset.action='home';brandButton.append(el('span','S','brand-mark'),el('span','SCEAN'),el('small','故事，從你開始。'));
  const productLinks=el('nav',undefined,'product-links');const navigationButtons=[];let navigate;
  for(const [screen,label]of [['home','創作入口'],['studio','創作對話'],['stage','舞台']]){const button=el('button',label,'quiet');button.type='button';button.dataset.action=screen;button.setAttribute('aria-current',screen==='stage'?'page':'false');if(screen!=='stage'){button.disabled=true;navigationButtons.push(button);}button.addEventListener('click',()=>screen==='stage'?show('story'):navigate?.(screen));productLinks.append(button);}
  brandButton.disabled=true;navigationButtons.push(brandButton);brandButton.addEventListener('click',()=>navigate?.('home'));top.prepend(brandButton,productLinks);
  const stageHeading=el('section',undefined,'stage-heading');stageHeading.id='stage-heading';const headingCopy=el('div',undefined,'stage-heading-copy');runTitle.classList.add('stage-title');const stageMeta=el('p');stageMeta.id='stage-meta';const scopeNotice=el('p',undefined,'stage-scope-notice');scopeNotice.id='stage-scope-notice';scopeNotice.hidden=true;headingCopy.append(el('p','THE STAGE / 讓故事發生','eyebrow'),runTitle,stageMeta,scopeNotice);
  const stageActions=el('div',undefined,'stage-heading-actions');stageActions.id='stage-heading-actions';const turnStatus=el('div',undefined,'stage-status'),duration=el('span');duration.id='turn-duration';duration.hidden=true;turnStatus.append(saveStatus,duration);stageActions.append(turnStatus);stageHeading.append(headingCopy,stageActions);top.after(stageHeading);stageHeading.after(tabs);
  // Disclosure is transient at every width. Keep the original navigation and
  // state nodes mounted; revealing them must not change a Run or input draft.
  top.id='stage-product-nav';body.dataset.stageDetails='false';
  const mobileBar=el('section',undefined,'stage-mobile-bar');mobileBar.id='stage-mobile-bar';
  const detailsToggle=el('button',undefined,'quiet stage-details-toggle');detailsToggle.id='stage-details-toggle';detailsToggle.type='button';detailsToggle.setAttribute('aria-controls','stage-product-nav stage-heading');
  const mobileCopy=el('span',undefined,'stage-mobile-copy'),mobileTitle=el('span',undefined,'stage-mobile-title'),mobileStatus=el('span',undefined,'stage-mobile-status'),disclosureLabel=el('span',undefined,'stage-disclosure-label');mobileStatus.id='stage-mobile-status';mobileStatus.setAttribute('role','status');
  const mobileAlert=el('p',undefined,'stage-mobile-alert');mobileAlert.id='stage-mobile-alert';mobileAlert.setAttribute('role','alert');mobileAlert.hidden=true;
  mobileCopy.append(mobileTitle,mobileStatus);detailsToggle.append(mobileCopy,disclosureLabel);mobileBar.append(detailsToggle,mobileAlert);top.before(mobileBar);
  let mobileScopeMessage='',legacyPlayback=false;
  const syncMobile=()=>{
    const expanded=body.dataset.stageDetails==='true';detailsToggle.setAttribute('aria-expanded',String(expanded));detailsToggle.setAttribute('aria-label',(expanded?'收合':'展開')+'舞台資訊與導覽：'+runTitle.textContent);disclosureLabel.textContent=expanded?'收合 ▴':'資訊 ▾';
    mobileTitle.textContent=runTitle.textContent;mobileTitle.title=runTitle.textContent;mobileStatus.textContent=[saveStatus.textContent,legacyPlayback?'舊演出':''].filter(Boolean).join(' · ');
    const connection=$('connection'),error=$('turn-error');mobileAlert.textContent=[mobileScopeMessage,connection.dataset.connected==='false'?connection.textContent:'',!error.hidden?error.textContent:''].filter(Boolean).join('　');mobileAlert.hidden=!mobileAlert.textContent;
  };
  detailsToggle.addEventListener('pointerdown',event=>{if(document.activeElement===$('input'))event.preventDefault();});
  detailsToggle.addEventListener('click',()=>{
    const restore=readingLayout?.preserve(),keepInput=document.activeElement===$('input');body.dataset.stageDetails=String(body.dataset.stageDetails!=='true');syncMobile();restore?.();
    if(keepInput)requestAnimationFrame(()=>{if(narrow.matches&&document.activeElement===$('input'))$('input').scrollIntoView({block:'nearest',behavior:'instant'});});
  });
  const mobileStatusObserver=new MutationObserver(syncMobile);for(const node of [saveStatus,$('connection'),$('turn-error')])mobileStatusObserver.observe(node,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','data-connected']});syncMobile();
  const settingsOpen=el('button','閱讀與舞台設定','quiet');settingsOpen.id='settings-open';settingsOpen.type='button';settingsOpen.setAttribute('aria-haspopup','dialog');settingsOpen.setAttribute('aria-controls','settings-dialog');stageSettings.append(settingsOpen);top.append($('connection'));runHeader.remove();
  const storyHeading=el('header',undefined,'story-heading'),kicker=el('p','STORY','chapter-kicker'),storyTitle=el('h2','故事正文'),storyIntro=el('p',undefined,'chapter-intro');storyHeading.id='story-heading';storyHeading.append(kicker,storyTitle,storyIntro);
  reading.append(storyHeading,$('chat'),$('provisional'),document.querySelector('.history-pagination'),$('history-page-error'),document.querySelector('.history-next-pagination'));main.insertBefore(reading,document.querySelector('.composer'));
  const jump=el('button','↓ 回到故事末尾','quiet jump-latest');jump.id='jump-latest';jump.type='button';jump.hidden=true;main.insertBefore(jump,document.querySelector('.composer'));
  const atEnd=()=>reading.scrollHeight-reading.clientHeight-reading.scrollTop<100;reading.addEventListener('scroll',()=>{jump.hidden=atEnd();},{passive:true});jump.addEventListener('click',()=>{reading.scrollTo({top:reading.scrollHeight,behavior:'instant'});readingLayout.adopt();});
  readingLayout=mountReadingLayout(reading);
  const presentation=mountPresentation({font,theme,palette,width,left,right,status:preferenceStatus,beforeLayoutChange:value=>{
    for(const [pane,button,collapsed] of [[library,left,value.leftCollapsed],[state,right,value.rightCollapsed]])if(collapsed&&pane.contains(document.activeElement)&&button.getClientRects().length)button.focus({preventScroll:true});const restore=readingLayout.preserve();return()=>{restore();syncEdges();};
  }});

  const hub=el('dialog',undefined,'tool-dialog settings-dialog');hub.id='settings-dialog';hub.setAttribute('aria-labelledby','settings-title');
  const hubHeading=el('header',undefined,'tool-heading'),hubTitle=el('h2','設定');hubTitle.id='settings-title';const hubClose=el('button','返回故事','quiet');hubClose.type='button';hubClose.id='settings-close';hubHeading.append(hubTitle,hubClose);
  const nav=el('nav',undefined,'settings-navigation');nav.setAttribute('aria-label','設定分類');hub.append(hubHeading,nav);body.append(hub);
  const categories=new Map();for(const [id,label]of [['reading','遊玩與閱讀'],['operation','功能與運作'],['technical','診斷與技術']]){const group=el('section',undefined,'settings-category');group.id='settings-category-'+id;group.append(el('h3',label));nav.append(group);categories.set(id,group);}
  const panels=el('div',undefined,'tool-panels');body.append(panels);const menuButtons=new Map(),dialogs=[];
  const openHub=target=>{if(document.querySelector('dialog[open]'))return;hub.returnValue='dismiss';hub.showModal();settingsOpen.setAttribute('aria-expanded','true');(target??hubClose).focus({preventScroll:true});};
  settingsOpen.setAttribute('aria-expanded','false');settingsOpen.addEventListener('click',()=>openHub());hubClose.addEventListener('click',()=>hub.close('dismiss'));
  hub.addEventListener('close',()=>{settingsOpen.setAttribute('aria-expanded','false');if(hub.returnValue!=='navigate'){show('story');reading.focus({preventScroll:true});}});
  const generation=el('details');generation.id='generation-panel';generation.append(el('summary','生成約束'),ban,modeSection);
  const notification=el('details');notification.id='notification-panel';notification.append(el('summary','保存通知'));
  const tools=[[prefs,'閱讀外觀','reading'],[runInfo,'玩家、完整文風與面板','reading'],[generation,'生成約束','operation'],[turnTools,'回合操作','operation'],[$('longform-panel'),'記憶、摘要與原文管理','operation'],[backup,'備份與匯入','operation'],[notification,'保存通知','operation'],[$('inspector'),'診斷本場問題','technical'],[about,'來源、授權與連線資訊','technical']];
  for(const [details,label,category] of tools){
    const summary=details.querySelector(':scope > summary');summary.textContent=label;summary.hidden=true;
    const menu=el('button',label+'　›','quiet');menu.id='settings-'+details.id;menu.type='button';menu.setAttribute('aria-haspopup','dialog');menuButtons.set(details.id,menu);categories.get(category).append(menu);
    const dialog=el('dialog',undefined,'tool-dialog');dialog.id=details.id+'-dialog';dialog.setAttribute('aria-label',label);menu.setAttribute('aria-controls',dialog.id);
    const heading=el('header',undefined,'tool-heading'),back=el('button','返回設定','quiet drawer-close'),dismiss=el('button','返回故事','quiet tool-dismiss');back.type=dismiss.type='button';heading.append(el('h2',label),back,dismiss);dialog.append(heading);
    for(const child of [...details.childNodes])if(child!==summary)dialog.append(child);details.classList.add('tool-panel');details.append(dialog);panels.append(details);dialogs.push(dialog);
    const open=()=>{if(hub.open)hub.close('navigate');for(const d of dialogs)if(d!==dialog&&d.open)d.close('navigate');if(!dialog.open){dialog.returnValue='external';dialog.showModal();back.focus({preventScroll:true});}};
    menu.addEventListener('click',()=>{details.open=true;open();});back.addEventListener('click',()=>dialog.close('back'));dismiss.addEventListener('click',()=>dialog.close('dismiss'));
    dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close('back');});
    dialog.addEventListener('close',()=>{details.open=false;if(dialog.returnValue==='back')openHub(menu);else if(dialog.returnValue==='dismiss'){show('story');reading.focus({preventScroll:true});}});
    // Existing app listeners still follow details.open (Inspector refresh, etc.).
    details.addEventListener('toggle',()=>{if(details.open&&!dialog.open)open();else if(!details.open&&dialog.open)dialog.close('dismiss');});
  }
  // Keep the existing global form/controller and its key-clearing/cancellation behavior.
  const globalOpen=$('global-chapter-open'),globalDialog=$('global-chapter-dialog');let returnFromGlobal=false;
  globalOpen.textContent='舞臺全域設定　›';globalOpen.setAttribute('aria-haspopup','dialog');globalOpen.setAttribute('aria-controls',globalDialog.id);categories.get('operation').append(globalOpen);
  globalOpen.addEventListener('click',()=>{returnFromGlobal=false;hub.close('navigate');},{capture:true});
  $('global-chapter-close').textContent='返回設定';$('global-chapter-close').addEventListener('click',()=>{returnFromGlobal=true;},{capture:true});globalDialog.addEventListener('cancel',()=>{returnFromGlobal=true;});
  globalDialog.addEventListener('close',()=>{if(returnFromGlobal){returnFromGlobal=false;openHub(globalOpen);}});
  for(const id of ['rollback-open','regenerate-open'])$(id).addEventListener('click',()=>turnTools.querySelector('dialog').close('external'),{capture:true});
  $('history-dialog').addEventListener('close',()=>{show('story');reading.focus({preventScroll:true});});
  $('longform-panel').addEventListener('click',event=>{if(event.target.closest('.chapter-detail-source,#chapters button,.summary-card button')){$('longform-panel').querySelector('dialog').close('external');show('story');reading.focus({preventScroll:true});}});
  const identity=$('player-identity-panel'),identityMenu=menuButtons.get('run-info-panel');
  const syncIdentity=()=>{const unbound=!identity.hidden&&!$('player-bind-form').hidden;settingsOpen.textContent=unbound?'閱讀與舞台設定 · 補名':'閱讀與舞台設定';identityMenu.textContent=unbound?'玩家、完整文風與面板 · 可補名　›':'玩家、完整文風與面板　›';};
  const identityObserver=new MutationObserver(syncIdentity);identityObserver.observe(identity,{subtree:true,attributes:true,attributeFilter:['hidden']});syncIdentity();
  const titleObserver=new MutationObserver(()=>{runTitle.title=runTitle.textContent;syncMobile();});titleObserver.observe(runTitle,{childList:true,subtree:true,characterData:true});runTitle.title=runTitle.textContent;
  composerLayout=mountComposerLayout($('input'),document.querySelector('.composer'),main);
  const syncViewport=()=>{const vv=window.visualViewport;if(vv&&Math.abs(vv.scale-1)>.02)return;document.documentElement.style.setProperty('--player-height',(vv?.height??innerHeight)+'px');document.documentElement.style.setProperty('--player-top',(vv?.offsetTop??0)+'px');body.classList.toggle('short-viewport',(vv?.height??innerHeight)<580);composerLayout.resize();};
  window.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);syncViewport();
  window.addEventListener('pagehide',()=>{presentation.dispose();readingLayout.dispose();composerLayout.dispose();identityObserver.disconnect();titleObserver.disconnect();mobileStatusObserver.disconnect();narrow.removeEventListener('change',onBreakpoint);document.removeEventListener('keydown',onEscape);window.removeEventListener('resize',syncViewport);window.visualViewport?.removeEventListener('resize',syncViewport);window.visualViewport?.removeEventListener('scroll',syncViewport);},{once:true});
  return {show,atEnd,
    scope(value,status){const messages={source_missing:'來源工作卡已不存在；原演出資料仍保留。',source_recycled:'來源工作卡已回收；原演出資料仍保留。',source_pending:'來源工作卡正在處理中；請稍後再試。',session_archived:'來源創作對話已封存。此處不會自動解除封存或恢復工作卡。',unavailable:'目前無法確認來源；請稍後重試。'};legacyPlayback=value?.authoringBindingRequired===true;mobileScopeMessage=messages[status?.status]??'';scopeNotice.textContent=legacyPlayback?'沿用此對話既有選卡，可繼續舊演出；編輯前請回 Studio 明確固定工作卡。':mobileScopeMessage;scopeNotice.hidden=!scopeNotice.textContent;syncMobile();return scopeNotice.textContent;},
    setNavigation(callback){navigate=callback;for(const button of navigationButtons){button.disabled=!callback;button.title=callback?'':'此入口需在 SCEAN 原生面板開啟';}},
    placeRecycle(){for(const id of ['run-recycle-open','run-recycle-status','run-recycle-recheck'])if($(id))recycle.append($(id));},
    story(run,narrative,turns=[]){
      const data=run?.snapshot?.card?.data??run?.snapshot?.card,titleText=data?.name??run?.snapshot?.title??'尚未開演';
      const count=run?.turnCount??run?.turns?.length??0;stageMeta.textContent=run?`已保存的演出 · ${count} 回合`:'從創作對話準備一份劇本，再開始你的故事。';
      if(run){const source=data?.avatar??data?.image??run.snapshot?.card?.avatar;const previous=cover.querySelector('img');if(previous?.getAttribute('src')!==source){previous?.remove();if(typeof source==='string'&&source.length<3*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)){const image=el('img');image.src=source;image.alt='';image.addEventListener('error',()=>image.remove(),{once:true});cover.append(image);}}title.textContent=titleText;cover.querySelector('.cover-monogram').textContent=titleText;desc.textContent='這場故事的篇章、世界與創作足跡。';revision.textContent=`固定版本 ${run.snapshot?.revision??'—'}`;}
      const first=turns[0]?.turn,chapter=(narrative?.chapters??[]).find(c=>c.current&&first>=c.startTurn&&first<=c.endTurn);
      kicker.textContent=chapter?`CHAPTER ${String(chapter.order).padStart(2,'0')}`:first?`STORY / 第 ${first} 回合起`:'THE BEGINNING';
      storyTitle.textContent=chapter?.title??run?.snapshot?.opening?.title??'故事正文';storyIntro.textContent=run?(run.playerIdentity?.name?`主角：${run.playerIdentity.name}`:'每一段行動，都是故事的一部分。'):'';
    },adoptReading(){readingLayout.adopt();},scrollEnd(){reading.scrollTop=reading.scrollHeight;readingLayout.adopt();},reading,
    preview(card,rev,opening){title.textContent=card?.title??'從 Studio 帶入故事';const data=rev?.snapshot?.card?.data??rev?.snapshot?.card;desc.textContent=data?.description??(card?'已保存的角色卡。':'請透過 Studio 交接已保存版本；已存在的故事可從書架繼續。');revision.textContent=rev?`固定 ${rev.label??rev.revision??rev.id} · ${rev.snapshot?.worldbook?.entries?.length??0} 筆世界書 · Preset 隨快照保存`:'新版本會另開故事，原局保留原快照。';
      // Only existing embedded raster covers; never fetch arbitrary remote URLs or render SVG/HTML.
      const source=data?.avatar??data?.image??rev?.snapshot?.card?.avatar;
      cover.querySelector('img')?.remove();if(typeof source==='string'&&source.length<3*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)){const image=el('img');image.src=source;image.alt='';image.addEventListener('error',()=>image.remove(),{once:true});cover.append(image);}
      $('create-form').classList.toggle('no-catalog',!card);
    },committed(){show('story');},
  };
}
