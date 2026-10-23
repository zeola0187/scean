// Keep the visible text through reflow; never read or mutate story state.
export function captureReadingAnchor(reading,{allowEnd=true}={}){
  if(!reading.isConnected||reading.clientHeight===0)return null;
  if(allowEnd&&reading.scrollHeight-reading.clientHeight-reading.scrollTop<100)return {end:true};
  const doc=reading.ownerDocument,box=reading.getBoundingClientRect(),targetY=box.top+Math.min(64,box.height/3);
  const bodies=[...reading.querySelectorAll('.message .body')];
  const text=bodies.find(n=>{const b=n.getBoundingClientRect();return b.bottom>targetY&&b.top<box.bottom;});
  if(!text)return null;
  const bounds=text.getBoundingClientRect(),x=Math.max(bounds.left+2,box.left+2),y=Math.max(bounds.top+2,targetY);
  let range;
  if(doc.caretPositionFromPoint){const point=doc.caretPositionFromPoint(x,y);if(point){range=doc.createRange();range.setStart(point.offsetNode,point.offset);range.collapse(true);}}
  else range=doc.caretRangeFromPoint?.(x,y);
  if(!range||!text.contains(range.startContainer))return null;
  const anchor={range,offset:range.getBoundingClientRect().top-box.top};
  // Color-only updates replace text nodes, not the body. Keep the equivalent
  // UTF-16 position so a live Range relocation cannot move the reading anchor.
  if(range.cloneRange&&doc.createTreeWalker)try{const prefix=range.cloneRange();prefix.selectNodeContents(text);prefix.setEnd(range.startContainer,range.startOffset);anchor.body=text;anchor.textOffset=prefix.toString().length;anchor.textLength=text.textContent.length;}catch{}
  return anchor;
}
export function restoreReadingAnchor(reading,anchor){
  if(!anchor||!reading.isConnected||reading.clientHeight===0)return;
  if(anchor.end){reading.scrollTop=reading.scrollHeight;return;}
  if(Number.isFinite(anchor.top)){reading.scrollTop=anchor.top;return;}
  if(anchor.body?.isConnected&&reading.contains(anchor.body)&&anchor.body.textContent.length===anchor.textLength&&Number.isSafeInteger(anchor.textOffset)){
    const doc=reading.ownerDocument,walker=doc.createTreeWalker(anchor.body,4);let node,remaining=anchor.textOffset;
    while((node=walker.nextNode())){if(remaining<=node.data.length){const range=doc.createRange();range.setStart(node,remaining);range.collapse(true);anchor.range=range;break;}remaining-=node.data.length;}
  }
  if(!anchor.range.startContainer.isConnected||!reading.contains(anchor.range.startContainer))return;
  reading.scrollTop+=anchor.range.getBoundingClientRect().top-reading.getBoundingClientRect().top-anchor.offset;
}
export function mountReadingLayout(reading,{requestFrame=globalThis.requestAnimationFrame,cancelFrame=globalThis.cancelAnimationFrame,ResizeObserver:Observe=globalThis.ResizeObserver}={}){
  let anchor=null,frame=0,gestureFrame=0,revision=0,restoring=false,userNavigating=false,lastWidth=0,lastHeight=0,lastRestoredTop=null;
  const remember=(force=false)=>{
    if(restoring||!reading.clientHeight)return;
    if(!force&&lastWidth&&lastHeight&&(reading.clientWidth!==lastWidth||reading.clientHeight!==lastHeight))return;
    const valid=!anchor?.range||anchor.range.startContainer.isConnected;
    if(!force&&valid&&lastRestoredTop!==null&&Math.abs(reading.scrollTop-lastRestoredTop)<1)return;
    // Reflow preserves a character or an exact top, never an implicit end.
    anchor=captureReadingAnchor(reading,{allowEnd:false})??{top:reading.scrollTop};lastRestoredTop=reading.scrollTop;
  };
  const cancelRestore=()=>{revision++;cancelFrame(frame);cancelFrame(gestureFrame);restoring=false;};
  const restore=next=>{
    if(!next)return;
    cancelFrame(frame);const owner=revision;restoring=true;
    restoreReadingAnchor(reading,next);lastRestoredTop=reading.scrollTop;
    frame=requestFrame(()=>{if(owner!==revision)return;restoreReadingAnchor(reading,next);lastRestoredTop=reading.scrollTop;restoring=false;});
  };
  const onScroll=()=>remember(userNavigating);
  const onGesture=()=>{
    cancelRestore();userNavigating=true;anchor=null;
    // Default wheel/touch/keyboard scrolling occurs after its input event.
    gestureFrame=requestFrame(()=>{userNavigating=false;remember(true);});
  };
  const onKey=event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))onGesture();};
  reading.addEventListener('scroll',onScroll,{passive:true});
  for(const type of ['wheel','touchmove','pointerdown'])reading.addEventListener(type,onGesture,{passive:true});
  reading.addEventListener('keydown',onKey);
  const observer=new Observe(()=>{
    const width=reading.clientWidth,height=reading.clientHeight;
    if(width&&height&&(width!==lastWidth||height!==lastHeight)&&lastWidth&&lastHeight&&!restoring&&!userNavigating)restore(anchor);
    if(width&&height){lastWidth=width;lastHeight=height;if(!anchor&&!userNavigating)remember(true);}
  });observer.observe(reading);
  return {
    // A committed-body placement or explicit navigation supersedes all queued
    // old layout restorations, including the second animation-frame restore.
    adopt(){cancelRestore();userNavigating=false;lastWidth=reading.clientWidth;lastHeight=reading.clientHeight;remember(true);},
    preserve(){remember();const saved=anchor,owner=revision;return()=>{if(owner===revision)restore(saved);};},
    dispose(){cancelRestore();observer.disconnect();reading.removeEventListener('scroll',onScroll);for(const type of ['wheel','touchmove','pointerdown'])reading.removeEventListener(type,onGesture);reading.removeEventListener('keydown',onKey);}
  };
}
