// Keep the visible text through reflow; never read or mutate story state.
export function captureReadingAnchor(reading){
  if(!reading.isConnected||reading.clientHeight===0)return null;
  if(reading.scrollHeight-reading.clientHeight-reading.scrollTop<100)return {end:true};
  const doc=reading.ownerDocument,box=reading.getBoundingClientRect(),targetY=box.top+Math.min(64,box.height/3);
  const bodies=[...reading.querySelectorAll('.message .body')];
  const text=bodies.find(n=>{const b=n.getBoundingClientRect();return b.bottom>targetY&&b.top<box.bottom;});
  if(!text)return null;
  const bounds=text.getBoundingClientRect(),x=Math.max(bounds.left+2,box.left+2),y=Math.max(bounds.top+2,targetY);
  let range;
  if(doc.caretPositionFromPoint){const point=doc.caretPositionFromPoint(x,y);if(point){range=doc.createRange();range.setStart(point.offsetNode,point.offset);range.collapse(true);}}
  else range=doc.caretRangeFromPoint?.(x,y);
  if(!range||!text.contains(range.startContainer))return null;
  return {range,offset:range.getBoundingClientRect().top-box.top};
}
export function restoreReadingAnchor(reading,anchor){
  if(!anchor||!reading.isConnected||reading.clientHeight===0)return;
  if(anchor.end){reading.scrollTop=reading.scrollHeight;return;}
  if(!anchor.range.startContainer.isConnected||!reading.contains(anchor.range.startContainer))return;
  reading.scrollTop+=anchor.range.getBoundingClientRect().top-reading.getBoundingClientRect().top-anchor.offset;
}
export function mountReadingLayout(reading){
  let anchor=null,frame=0,restoring=false,lastWidth=0,lastHeight=0,lastRestoredTop=null;
  const remember=()=>{
    if(restoring||!reading.clientHeight)return;
    // A resize can emit scroll before ResizeObserver. That scroll describes the
    // new line wrapping, not a reader choosing another place in the story.
    if(lastWidth&&lastHeight&&(reading.clientWidth!==lastWidth||reading.clientHeight!==lastHeight))return;
    const valid=!anchor?.range||anchor.range.startContainer.isConnected;
    if(valid&&lastRestoredTop!==null&&Math.abs(reading.scrollTop-lastRestoredTop)<1)return;
    const next=captureReadingAnchor(reading);if(next){anchor=next;lastRestoredTop=reading.scrollTop;}
  };
  const restore=next=>{
    cancelAnimationFrame(frame);restoring=true;
    restoreReadingAnchor(reading,next);lastRestoredTop=reading.scrollTop;
    // Keep the same character across repeated toggles; resampling each reflow
    // slowly drifts by a line. Only an independent scroll chooses a new anchor.
    frame=requestAnimationFrame(()=>{restoreReadingAnchor(reading,next);lastRestoredTop=reading.scrollTop;restoring=false;});
  };
  reading.addEventListener('scroll',remember,{passive:true});
  // The last pre-resize text Range survives browser/DSH panel width changes.
  const observer=new ResizeObserver(()=>{
    const width=reading.clientWidth,height=reading.clientHeight;
    if(width&&height&&(width!==lastWidth||height!==lastHeight)&&lastWidth&&lastHeight&&!restoring)restore(anchor);
    if(width&&height){lastWidth=width;lastHeight=height;if(!anchor)remember();}
  });observer.observe(reading);
  return {preserve(){remember();const saved=anchor;return()=>restore(saved);},dispose(){cancelAnimationFrame(frame);observer.disconnect();reading.removeEventListener('scroll',remember);}};
}
