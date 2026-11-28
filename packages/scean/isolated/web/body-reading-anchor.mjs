// Source-text anchors survive frozen-body promotion and dialogue presentation changes.
// No timers, State writes, provider calls, or document-height based navigation.
export function markBodyOffsets(nodes, body) {
  let cursor=0;
  for(const node of nodes){const textNode=node.querySelector('.speech')??node,text=textNode.textContent;
    const start=body.indexOf(text,cursor);if(start<0||!text)continue;
    textNode.dataset.bodyStart=String(start);textNode.dataset.bodyEnd=String(start+text.length);cursor=start+text.length;
  }
  return nodes;
}
function readingTop(){return Math.max(12,(document.querySelector('.reader-bar')?.getBoundingClientRect().bottom??0)+12);}
function textNodes(element){const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),nodes=[];let node;while(node=walker.nextNode())if(node.length)nodes.push(node);return nodes;}
function characterRect(node,offset){const range=document.createRange();range.setStart(node,Math.min(offset,node.length-1));range.setEnd(node,Math.min(offset+1,node.length));return range.getBoundingClientRect();}
export function captureBodyPosition(prose){
  if(!prose)return null;const box=prose.getBoundingClientRect(),top=readingTop();
  if(box.bottom<=top||box.top>=innerHeight-20)return null;
  if(box.top>=top-2)return {offset:0,y:box.top,start:true};
  for(const region of prose.querySelectorAll('[data-body-start]')){
    const r=region.getBoundingClientRect();if(r.bottom<=top)continue;
    let offset=Number(region.dataset.bodyStart);
    for(const node of textNodes(region)){
      const end=characterRect(node,node.length-1);if(end.bottom<=top){offset+=node.length;continue;}
      let lo=0,hi=node.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(characterRect(node,mid).bottom<=top)lo=mid+1;else hi=mid;}
      return {offset:offset+lo,y:characterRect(node,lo).top,start:false};
    }
  }
  return null;
}
export function restoreBodyPosition(anchor,prose){
  if(!anchor||!prose||document.visibilityState!=='visible')return false;
  let y;
  if(anchor.start)y=prose.getBoundingClientRect().top;
  else for(const region of prose.querySelectorAll('[data-body-start]')){
    const start=Number(region.dataset.bodyStart),end=Number(region.dataset.bodyEnd);if(anchor.offset<start||anchor.offset>=end)continue;
    let at=anchor.offset-start;for(const node of textNodes(region)){if(at<node.length){y=characterRect(node,at).top;break;}at-=node.length;}break;
  }
  if(!Number.isFinite(y))return false;const delta=y-anchor.y;if(Math.abs(delta)>.5)window.scrollBy({top:delta,behavior:'instant'});return true;
}
export function jumpToBody(prose){if(!prose)return false;window.scrollBy({top:prose.getBoundingClientRect().top-readingTop(),behavior:'instant'});return true;}
