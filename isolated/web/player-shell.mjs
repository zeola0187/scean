// Original SCEAN presentation. Shared by HTTP player and compiled native client.
// No story semantics, persistence, model calls or implicit authority in this module.
import {mountPresentation} from './presentation.mjs';
import {mountReadingLayout} from './reading-layout.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function mountPlayerShell(){
  const $=id=>document.getElementById(id),body=document.body;let readingLayout;
  body.classList.add('player-shell');body.dataset.playerView='library';
  const top=document.querySelector('.topbar');top.querySelector('p').textContent='把下一頁，留給你。';
  const tabs=el('nav',undefined,'view-tabs');tabs.setAttribute('aria-label','玩家工作區');
  const show=(name,focus=false)=>{const restore=readingLayout?.preserve();body.dataset.playerView=name;for(const b of tabs.children)b.setAttribute('aria-current',String(b.dataset.view===name));if(focus)(name==='story'?$('input'):name==='library'?$('card'):$('scene-title')).focus({preventScroll:true});restore?.();};
  for(const [name,label] of [['library','書架'],['story','故事'],['state','此刻']]){const b=el('button',label,'quiet');b.id='view-'+name;b.type='button';b.dataset.view=name;b.addEventListener('click',()=>show(name,true));tabs.append(b);}top.after(tabs);show('library');
  const library=document.querySelector('.library');library.id='library-pane';
  const workspace=el('nav',undefined,'workspace-controls');workspace.setAttribute('aria-label','閱讀空間');
  const left=el('button','收合書架','quiet'),right=el('button','收合此刻','quiet');left.id='toggle-library';right.id='toggle-scene';
  for(const [button,id] of [[left,'library-pane'],[right,'scene-pane']]){button.type='button';button.setAttribute('aria-controls',id);button.setAttribute('aria-expanded','true');button.addEventListener('pointerdown',e=>{if(document.activeElement===$('input'))e.preventDefault();});workspace.append(button);}top.after(workspace);
  const preview=el('section',undefined,'card-preview');preview.setAttribute('aria-label','卡片與保存版本預覽');
  const cover=el('div',undefined,'card-cover');cover.id='card-cover';cover.setAttribute('aria-hidden','true');cover.append(el('span','S / C','cover-monogram'),el('span','A STORY TO ENTER','cover-caption'));
  const title=el('h2','選擇你的故事');title.id='card-title';const desc=el('p',undefined,'card-description');desc.id='card-description';
  const revision=el('p',undefined,'revision-confirm');revision.id='revision-confirm';preview.append(cover,title,desc,revision);$('create-form').prepend(preview);
  $('setup').querySelector('summary').textContent='開始一段故事';$('create').textContent='確認版本，開啟新故事';
  const backup=$('backup-panel');
  const main=$('player'),reading=el('section',undefined,'reading-pane');reading.id='reading-pane';reading.setAttribute('aria-label','故事閱讀區');reading.tabIndex=0;
  const toolbar=el('nav',undefined,'player-tools');toolbar.setAttribute('aria-label','故事工具');
  const turnTools=el('details');turnTools.id='turn-tools';turnTools.append(el('summary','回合操作'));const history=document.querySelector('.history-actions');turnTools.append(history);
  const prefs=el('details');prefs.id='preferences-panel';prefs.append(el('summary','設定'));
  const fontLabel=el('label','閱讀字級');const font=el('select');font.id='reading-size';for(const [v,t] of [['normal','標準'],['large','大字']]){const o=el('option',t);o.value=v;font.append(o);}fontLabel.append(font);prefs.append(fontLabel);
  const themeLabel=el('label','顯示模式');const theme=el('select');theme.id='reading-theme';for(const [v,t] of [['system','跟隨系統'],['light','淺色'],['dark','深色']]){const option=el('option',t);option.value=v;theme.append(option);}themeLabel.append(theme);prefs.append(themeLabel);
  const preferenceStatus=el('p',undefined,'hint');preferenceStatus.id='presentation-status';preferenceStatus.setAttribute('role','status');prefs.append(preferenceStatus);
  const paletteLabel=el('label','深色配色'),palette=el('select');palette.id='dark-palette';for(const [v,t] of [['black','深黑'],['forest','森林綠'],['wine','酒紅']]){const option=el('option',t);option.value=v;palette.append(option);}paletteLabel.append(palette);prefs.insertBefore(paletteLabel,preferenceStatus);
  const paletteHint=el('p','切換深色時套用；淺色外觀維持原有配色。','hint');prefs.insertBefore(paletteHint,preferenceStatus);
  const widthLabel=el('label','閱讀寬度'),width=el('select');width.id='reading-width';for(const [v,t] of [['comfortable','舒適'],['wide','寬版']]){const option=el('option',t);option.value=v;width.append(option);}widthLabel.append(width);prefs.insertBefore(widthLabel,preferenceStatus);
  const help=document.querySelector('.help');help.open=true;prefs.append(help);
  const ban=el('form');ban.id='banlist-form';const bl=el('label','機械 BanList（每行一項）');bl.htmlFor='banlist-input';const bt=el('textarea');bt.id='banlist-input';bt.rows=4;const bs=el('button','保存 BanList');bs.id='banlist-save';bs.type='submit';bs.disabled=true;const bn=el('p',undefined,'hint');bn.id='banlist-status';bn.setAttribute('role','status');ban.append(bl,bt,bs,bn);prefs.append(ban);
  const model=el('p','模型由目前啟動的既有設定提供；此介面沒有切換模型的接口。','hint');prefs.append(model);
  const state=el('aside',undefined,'scene-pane');state.id='scene-pane';const label=el('p','THE PRESENT','eyebrow');const st=el('h2','此刻的世界');st.id='scene-title';st.tabIndex=-1;state.append(label,st,el('p','只呈現已保存的公開狀態。','hint'),document.querySelector('.state-panel'));
  document.querySelector('.layout').append(state);
  toolbar.append(turnTools,$('longform-panel'),backup,prefs,$('inspector'));
  main.prepend(document.querySelector('.run-header'),toolbar);
  reading.append(document.querySelector('.history-pagination'),$('history-page-error'),$('chat'),$('provisional'));
  main.insertBefore(reading,document.querySelector('.composer'));
  const jump=el('button','↓ 回到故事末尾','quiet jump-latest');jump.id='jump-latest';jump.type='button';jump.hidden=true;main.insertBefore(jump,document.querySelector('.composer'));
  const atEnd=()=>reading.scrollHeight-reading.clientHeight-reading.scrollTop<100;
  reading.addEventListener('scroll',()=>{jump.hidden=atEnd();},{passive:true});jump.addEventListener('click',()=>reading.scrollTo({top:reading.scrollHeight,behavior:'instant'}));
  readingLayout=mountReadingLayout(reading);
  const presentation=mountPresentation({font,theme,palette,width,left,right,status:preferenceStatus,beforeLayoutChange:value=>{for(const [pane,button,collapsed] of [[library,left,value.leftCollapsed],[state,right,value.rightCollapsed]])if(collapsed&&pane.contains(document.activeElement)&&button.getClientRects().length)button.focus({preventScroll:true});return readingLayout.preserve();}});
  window.addEventListener('pagehide',()=>{presentation.dispose();readingLayout.dispose();},{once:true});
  const dialogs=[];
  for(const [details,label] of [[turnTools,'回合操作'],[$('longform-panel'),'章節與回顧'],[$('backup-panel'),'備份'],[prefs,'設定'],[$('inspector'),'診斷']]){
    const summary=details.querySelector(':scope > summary');summary.textContent=label;
    const dialog=el('dialog',undefined,'tool-dialog');dialog.setAttribute('aria-label',label);const heading=el('header',undefined,'tool-heading'),close=el('button','返回故事','quiet');close.type='button';close.className='quiet drawer-close';heading.append(el('h2',label),close);dialog.append(heading);
    for(const child of [...details.childNodes])if(child!==summary)dialog.append(child);
    details.append(dialog);dialogs.push(dialog);
    close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{details.open=false;summary.focus({preventScroll:true});});
    details.addEventListener('toggle',()=>{if(details.open&&!dialog.open){for(const d of dialogs)if(d!==dialog&&d.open)d.close();dialog.showModal();close.focus();}else if(!details.open&&dialog.open)dialog.close();});
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  }
  for(const id of ['rollback-open','regenerate-open'])$(id).addEventListener('click',()=>turnTools.querySelector('dialog').close(),{capture:true});
  $('history-dialog').addEventListener('close',()=>{show('story');turnTools.querySelector('summary').focus({preventScroll:true});});
  $('longform-panel').addEventListener('click',e=>{if(e.target.closest('.chapter-detail-source,#chapters button,.summary-card button')){ $('longform-panel').querySelector('dialog').close();show('story');}});
  const syncViewport=()=>{const vv=window.visualViewport;if(vv&&Math.abs(vv.scale-1)>.02)return;document.documentElement.style.setProperty('--player-height',(vv?.height??innerHeight)+'px');document.documentElement.style.setProperty('--player-top',(vv?.offsetTop??0)+'px');body.classList.toggle('short-viewport',(vv?.height??innerHeight)<580);};
  window.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);syncViewport();
  window.addEventListener('pagehide',()=>{window.removeEventListener('resize',syncViewport);window.visualViewport?.removeEventListener('resize',syncViewport);window.visualViewport?.removeEventListener('scroll',syncViewport);},{once:true});
  return {show,atEnd,scrollEnd(){reading.scrollTop=reading.scrollHeight;},reading,
    preview(card,rev,opening){title.textContent=card?.title??'從 Studio 帶入故事';const data=rev?.snapshot?.card?.data??rev?.snapshot?.card;desc.textContent=data?.description??(card?'已保存的角色卡。':'請透過 Studio 交接已保存版本；已存在的故事可從書架繼續。');revision.textContent=rev?`固定 ${rev.label??rev.revision??rev.id} · ${rev.snapshot?.worldbook?.entries?.length??0} 筆世界書 · Preset 隨快照保存`:'新版本會另開故事，原局保留原快照。';
      // Only existing embedded raster covers; never fetch arbitrary remote URLs or render SVG/HTML.
      const source=data?.avatar??data?.image??rev?.snapshot?.card?.avatar;
      cover.querySelector('img')?.remove();if(typeof source==='string'&&source.length<3*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)){const image=el('img');image.src=source;image.alt='';image.addEventListener('error',()=>image.remove(),{once:true});cover.append(image);}
      $('create-form').classList.toggle('no-catalog',!card);
    },
    committed(){show('story');},
  };
}
