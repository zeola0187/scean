// Local SCEAN presentation only. No Host/card/Session RPC or global DSH theme.
export function createSceanAppearance({React,h,presentation}){
  const {normalizePresentation,loadPresentation,savePresentation,presentationTheme,presentationKey}=presentation;
  function useAppearance(){
    const [value,setValue]=React.useState(()=>normalizePresentation(null)),[dark,setDark]=React.useState(()=>matchMedia('(prefers-color-scheme: dark)').matches),[status,setStatus]=React.useState('正在讀取 SCEAN 顯示偏好…');
    const queue=React.useRef(Promise.resolve()),serial=React.useRef(0),live=React.useRef(true);
    const storage=()=>{try{return window.localStorage;}catch{return undefined;}};
    React.useEffect(()=>{
      live.current=true;let revision=0;
      const read=async event=>{if(event?.type==='storage'&&event.key!==presentationKey&&event.key!==null)return;const token=++revision;const next=await loadPresentation({storage:storage()});if(!live.current||token!==revision)return;setValue(normalizePresentation(next));setStatus(next.persistence==='unavailable'?'本次可預覽；此瀏覽器無法保存偏好。':'底色共用於此瀏覽器的 SCEAN 創作入口、創作對話與舞台。');};
      const media=matchMedia('(prefers-color-scheme: dark)'),environment=()=>setDark(media.matches);
      window.addEventListener('scean:presentation',read);window.addEventListener('storage',read);media.addEventListener('change',environment);void read();
      return()=>{live.current=false;revision++;window.removeEventListener('scean:presentation',read);window.removeEventListener('storage',read);media.removeEventListener('change',environment);};
    },[]);
    const choose=choice=>{
      const patch=choice==='system'?{theme:'system'}:choice==='light'?{theme:'light'}:{theme:'dark',darkPalette:choice};
      const token=++serial.current;setValue(current=>normalizePresentation({...current,...patch}));setStatus('正在保存 SCEAN 底色…');
      // Merge only the requested appearance fields into the latest existing
      // preference; reading width/font and sidebar choices must survive.
      queue.current=queue.current.catch(()=>{}).then(async()=>{
        const latest=await loadPresentation({storage:storage()});return savePresentation({...latest,...patch},{storage:storage()});
      });
      queue.current.then(saved=>{if(live.current&&token===serial.current){setValue(normalizePresentation(saved));setStatus(saved.persistence==='unavailable'?'本次已套用；底色尚未保存。':'已保存；三個 SCEAN 頁面會使用相同底色。');}}).catch(()=>{if(live.current&&token===serial.current)setStatus('本次已套用；底色尚未保存。');});
    };
    return {value,status,choose,attributes:{'data-theme':presentationTheme(value.theme,dark),'data-dark-palette':value.darkPalette},choice:value.theme==='dark'?value.darkPalette:value.theme};
  }
  function Settings({open,onClose,appearance}){
    const dialog=React.useRef(null),close=React.useRef(onClose);close.current=onClose;
    React.useEffect(()=>{if(!open)return;const node=dialog.current,previous=document.activeElement;node.showModal();return()=>{if(node.open)node.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[open]);
    return h('dialog',{ref:dialog,className:'scean-settings-dialog','aria-labelledby':'scean-settings-title',onCancel:e=>{e.preventDefault();close.current();},onClose:()=>close.current()},
      h('header',null,h('h2',{id:'scean-settings-title'},'SCEAN 設定'),h('button',{type:'button',className:'sw-button',onClick:()=>close.current(),'data-scean-settings-close':true},'關閉')),
      h('section',null,h('h3',null,'外觀'),h('label',{htmlFor:'scean-background'},'SCEAN 整體底色'),h('select',{id:'scean-background',value:appearance.choice,onChange:e=>appearance.choose(e.target.value)},...Object.entries({system:'跟隨系統',light:'柔光綠',forest:'森林綠',black:'深黑',wine:'酒紅'}).map(([value,label])=>h('option',{key:value,value},label))),
      h('p',{role:'status','data-scean-appearance-status':true},appearance.status),h('p',{className:'muted'},'只調整 SCEAN 的頁面外觀，不改變原生 DSH 對話、其他插件或故事內容。其他瀏覽器與裝置可另外設定。')));
  }
  return {useAppearance,Settings};
}
