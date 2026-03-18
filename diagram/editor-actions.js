// ════════════════════════════════════════════════════════════
//  TamTap Diagram Editor — Actions & Events
// ════════════════════════════════════════════════════════════

// ── INPUT EVENTS ──
function getPos(e){
  const r=canvas.getBoundingClientRect();
  if(e.touches&&e.touches.length>0)return{x:e.touches[0].clientX-r.left,y:e.touches[0].clientY-r.top};
  return{x:e.clientX-r.left,y:e.clientY-r.top};
}

canvas.addEventListener('pointerdown',onDown,{passive:false});
canvas.addEventListener('pointermove',onMove,{passive:false});
canvas.addEventListener('pointerup',onUp);
canvas.addEventListener('pointercancel',()=>{dragging=panning=resizing=draggingWireLabel=false;wireTemp=wireStart=null;selRect=null;alignGuides=[];wireHover=null;wireLabelDragId=null;wireLabelDragStart=null;redraw();});
canvas.addEventListener('wheel',onWheel,{passive:false});
canvas.addEventListener('touchstart',onTS,{passive:false});
canvas.addEventListener('touchmove',onTM,{passive:false});
canvas.addEventListener('contextmenu',onCtx);
canvas.addEventListener('dblclick',onDbl);

function onDown(e){
  e.preventDefault();
  const sp=getPos(e), wp=s2w(sp.x,sp.y);
  const ctrlKey=e.ctrlKey||e.metaKey||e.shiftKey;
  hideCtxMenu();

  updateWireHover(wp.x,wp.y);

  if(mode==='select'){
    // Drag wire label directly
    const labelWire=findTopWireLabelHit(wp.x,wp.y);
    if(labelWire){
      selectWire(labelWire.id,false);
      const w=wires.find(x=>x.id===labelWire.id);
      if(w){
        pushUndo();
        const off=getWireLabelOffset(w);
        draggingWireLabel=true;
        wireLabelDragId=w.id;
        wireLabelDragStart={mx:wp.x,my:wp.y,ox:off.x,oy:off.y};
        canvas.style.cursor='grabbing';
        return;
      }
    }

    // Check resize handles first
    if(selectedIds.size===1){
      const b=boxes.find(b=>b.id===[...selectedIds][0]);
      if(b){
        const hid=hitHandle(b,sp);
        if(hid){
          resizing=true; resizeHandle=hid; resizeBox=b;
          resizeStart={ox:b.x,oy:b.y,ow:b.w,oh:b.h,mx:wp.x,my:wp.y};
          return;
        }
      }
    }
    // Hit box
    let hit=null;
    for(let i=boxes.length-1;i>=0;i--)if(hitBox(boxes[i],wp.x,wp.y)){hit=boxes[i];break;}
    if(hit){
      pushUndo();
      // Check if it's part of a group
      const grp=groups.find(g=>g.memberIds.includes(hit.id));
      if(grp&&!ctrlKey){
        // Select whole group
        selectedIds.clear(); selectedWireIds.clear();
        grp.memberIds.forEach(mid=>selectedIds.add(mid));
        // Also select group wires
        grp.wireIds&&grp.wireIds.forEach(wid=>selectedWireIds.add(wid));
        updatePanel();
      } else {
        selectBox(hit.id,ctrlKey);
      }
      dragging=true;
      // Store offsets for all selected boxes
      dragOffsets.clear();
      selectedIds.forEach(id=>{
        const b=boxes.find(b=>b.id===id);
        if(b) dragOffsets.set(id,{dx:wp.x-b.x,dy:wp.y-b.y});
      });
    } else {
      // Hit wire
      let wHit=null;
      for(let i=wires.length-1;i>=0;i--)if(hitWire(wires[i],wp.x,wp.y)){wHit=wires[i];break;}
      if(wHit){
        selectWire(wHit.id,ctrlKey);
      } else {
        if(!ctrlKey){
          selectedIds.clear(); selectedWireIds.clear();
        }
        // Start drag-select rectangle
        selRect={sx:sp.x,sy:sp.y,ex:sp.x,ey:sp.y};
        panning=!ctrlKey&&!selRect;
        if(!selRect){
          panning=true;
          panStart=sp; panOrigin={...pan};
        }
        updatePanel();
      }
    }
  }
  if(mode==='wire'){
    let hit=null;
    for(let i=boxes.length-1;i>=0;i--)if(hitBox(boxes[i],wp.x,wp.y)){hit=boxes[i];break;}
    if(hit){
      const chosenPort=(wireHover&&wireHover.boxId===hit.id&&wireHover.port)
        ? {side:wireHover.port.side,offset:wireHover.port.offset}
        : inferFacingPort(hit,wp.x,wp.y);
      const startPt=resolvePortPoint(hit,chosenPort)||{x:hit.x+hit.w/2,y:hit.y+hit.h/2};
      wireStart={id:hit.id,px:startPt.x,py:startPt.y,port:chosenPort};
    } else {
      wireStart={id:null,px:wp.x,py:wp.y,port:null};
    }
    wireTemp={x1:wireStart.px,y1:wireStart.py,x2:wp.x,y2:wp.y};
  }
  redraw();
}

function onMove(e){
  e.preventDefault();
  const sp=getPos(e), wp=s2w(sp.x,sp.y);
  document.getElementById('coords-badge').textContent='x:'+Math.round(wp.x)+' y:'+Math.round(wp.y);

  if(draggingWireLabel&&wireLabelDragId&&wireLabelDragStart){
    const w=wires.find(x=>x.id===wireLabelDragId);
    if(w){
      const dx=wp.x-wireLabelDragStart.mx;
      const dy=wp.y-wireLabelDragStart.my;
      w.labelOffset={x:Math.round(wireLabelDragStart.ox+dx),y:Math.round(wireLabelDragStart.oy+dy)};
      markUnsaved();
      redraw();
    }
    return;
  }

  if(resizing&&resizeBox){
    const dx=wp.x-resizeStart.mx, dy=wp.y-resizeStart.my;
    const r=applyResize(resizeHandle,dx,dy,resizeStart);
    resizeBox.x=r.x; resizeBox.y=r.y; resizeBox.w=r.w; resizeBox.h=r.h;
    updatePanel(); markUnsaved(); redraw(); return;
  }
  if(dragging&&selectedIds.size>0){
    selectedIds.forEach(id=>{
      const b=boxes.find(b=>b.id===id);
      const off=dragOffsets.get(id);
      if(b&&off){
        b.x=snap(wp.x-off.dx);
        b.y=snap(wp.y-off.dy);
      }
    });
    calcAlignGuides(selectedIds,wp.x,wp.y);
    updatePanel(); markUnsaved();
  }
  if(selRect){
    selRect.ex=sp.x; selRect.ey=sp.y;
    // Update visual selection rect
    const el=document.getElementById('sel-rect');
    const rx=Math.min(selRect.sx,selRect.ex), ry=Math.min(selRect.sy,selRect.ey);
    const rw=Math.abs(selRect.ex-selRect.sx), rh=Math.abs(selRect.ey-selRect.sy);
    el.style.display='block'; el.style.left=rx+'px'; el.style.top=ry+'px';
    el.style.width=rw+'px'; el.style.height=rh+'px';
  }
  if(panning){
    pan.x=panOrigin.x+(sp.x-panStart.x);
    pan.y=panOrigin.y+(sp.y-panStart.y);
  }
  updateWireHover(wp.x,wp.y);
  if(wireTemp){ wireTemp.x2=wp.x; wireTemp.y2=wp.y; }
  redraw();
  // Hover cursor
  if(!resizing&&!dragging&&!panning&&mode==='wire'){
    canvas.style.cursor=(wireHover&&wireHover.dist<=30)?'crosshair':'default';
    return;
  }
  if(!resizing&&!dragging&&!panning&&!wireTemp&&!selRect&&mode==='select'){
    if(selectedIds.size===1){
      const b=boxes.find(b=>b.id===[...selectedIds][0]);
      if(b){
        const hid=hitHandle(b,sp);
        const cursors={nw:'nwse-resize',n:'ns-resize',ne:'nesw-resize',e:'ew-resize',se:'nwse-resize',s:'ns-resize',sw:'nesw-resize',w:'ew-resize'};
        if(hid){canvas.style.cursor=cursors[hid]||'move';return;}
      }
    }
    for(let i=boxes.length-1;i>=0;i--)if(hitBox(boxes[i],wp.x,wp.y)){canvas.style.cursor='grab';return;}
    canvas.style.cursor='default';
  }
}

function onUp(e){
  const sp=getPos(e), wp=s2w(sp.x,sp.y);
  alignGuides=[];
  if(draggingWireLabel){
    draggingWireLabel=false;
    wireLabelDragId=null;
    wireLabelDragStart=null;
    canvas.style.cursor=mode==='wire'?'crosshair':'default';
    redraw();
    return;
  }
  if(resizing){resizing=false;resizeBox=null;resizeHandle=null;markUnsaved();redraw();return;}
  if(selRect){
    // Select all boxes within the rectangle
    const w1=s2w(Math.min(selRect.sx,selRect.ex),Math.min(selRect.sy,selRect.ey));
    const w2=s2w(Math.max(selRect.sx,selRect.ex),Math.max(selRect.sy,selRect.ey));
    const ctrlKey=e.ctrlKey||e.metaKey;
    if(!ctrlKey){selectedIds.clear();selectedWireIds.clear();}
    boxes.forEach(b=>{
      const bCx=b.x+b.w/2, bCy=b.y+b.h/2;
      if(bCx>=w1.x&&bCx<=w2.x&&bCy>=w1.y&&bCy<=w2.y) selectedIds.add(b.id);
    });
    wires.forEach(w=>{
      const pts=getWirePts(w);
      const mid=pts[Math.floor(pts.length/2)];
      if(mid&&mid.x>=w1.x&&mid.x<=w2.x&&mid.y>=w1.y&&mid.y<=w2.y) selectedWireIds.add(w.id);
    });
    selRect=null;
    document.getElementById('sel-rect').style.display='none';
    updatePanel(); redraw();
    if(selectedIds.size>0) toast(selectedIds.size+' selected','info');
    return;
  }
  if(wireTemp&&wireStart){
    let endId=null;
    for(let i=boxes.length-1;i>=0;i--)if(hitBox(boxes[i],wp.x,wp.y)&&boxes[i].id!==wireStart.id){endId=boxes[i].id;break;}
    const dx=wp.x-wireStart.px,dy=wp.y-wireStart.py;
    if(Math.hypot(dx,dy)>10){
      pushUndo();
      const eb=endId?boxes.find(b=>b.id===endId):null;
      const startPort=wireStart.id?wireStart.port:null;
      let endPort=null;
      if(eb){
        endPort=(wireHover&&wireHover.boxId===eb.id&&wireHover.port)
          ? {side:wireHover.port.side,offset:wireHover.port.offset}
          : inferFacingPort(eb,wireStart.px,wireStart.py);
      }
      const endPt=eb?(resolvePortPoint(eb,endPort)||{x:eb.x+eb.w/2,y:eb.y+eb.h/2}):{x:wp.x,y:wp.y};
      const w={id:newId(),fromId:wireStart.id||null,toId:endId,
        x1:wireStart.px,y1:wireStart.py,
        x2:endPt.x,y2:endPt.y,
        fromPort:startPort||undefined,toPort:endPort||undefined,
        color:curWireColor,width:curWireWidth,style:curWireStyle,route:curWireRoute,arrow:curWireArrow,label:''};
      wires.push(w);
      selectedWireIds.clear(); selectedWireIds.add(w.id);
      selectedIds.clear(); updatePanel(); markUnsaved(); toast('Wire added','ok');
    }
    wireTemp=null; wireStart=null;
  }
  wireHover=null;
  dragging=false; panning=false; dragOffsets.clear();
  canvas.style.cursor=mode==='wire'?'crosshair':'default';
  redraw();
}

function onCtx(e){
  e.preventDefault();
  const r=canvas.getBoundingClientRect(), wp=s2w(e.clientX-r.left,e.clientY-r.top);
  for(let i=boxes.length-1;i>=0;i--)if(hitBox(boxes[i],wp.x,wp.y)){
    if(!selectedIds.has(boxes[i].id)) selectBox(boxes[i].id,false);
    showCtxMenu(e.clientX,e.clientY); return;
  }
  for(let i=wires.length-1;i>=0;i--)if(hitWire(wires[i],wp.x,wp.y)){
    if(!selectedWireIds.has(wires[i].id)) selectWire(wires[i].id,false);
    showCtxMenu(e.clientX,e.clientY); return;
  }
}
function onDbl(e){
  const r=canvas.getBoundingClientRect(), wp=s2w(e.clientX-r.left,e.clientY-r.top);
  for(let i=boxes.length-1;i>=0;i--)if(hitBox(boxes[i],wp.x,wp.y)){selectBox(boxes[i].id);editLabel();return;}
}

// Touch pinch
function onTS(e){
  if(e.touches.length===2){
    pinchStartDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    pinchStartScale=scale; panning=false; dragging=false; e.preventDefault();
  } else if(e.touches.length===1){
    const now=Date.now();
    if(now-lastTap<340){
      const r=canvas.getBoundingClientRect(), wp=s2w(e.touches[0].clientX-r.left,e.touches[0].clientY-r.top);
      for(let i=boxes.length-1;i>=0;i--)if(hitBox(boxes[i],wp.x,wp.y)){selectBox(boxes[i].id);editLabel();return;}
    }
    lastTap=Date.now();
  }
}
function onTM(e){
  if(e.touches.length===2){
    e.preventDefault();
    const dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    const ratio=dist/pinchStartDist;
    const r=canvas.getBoundingClientRect();
    const cx=(e.touches[0].clientX+e.touches[1].clientX)/2-r.left;
    const cy=(e.touches[0].clientY+e.touches[1].clientY)/2-r.top;
    const ns=Math.max(0.1,Math.min(4,pinchStartScale*ratio));
    pan.x=cx-(cx-pan.x)*(ns/scale); pan.y=cy-(cy-pan.y)*(ns/scale);
    scale=ns; redraw();
  }
}
function onWheel(e){
  e.preventDefault();
  const r=canvas.getBoundingClientRect(), cx=e.clientX-r.left, cy=e.clientY-r.top;
  const f=e.deltaY<0?1.12:0.9;
  const ns=Math.max(0.1,Math.min(5,scale*f));
  pan.x=cx-(cx-pan.x)*(ns/scale); pan.y=cy-(cy-pan.y)*(ns/scale);
  scale=ns; redraw();
}

// ── STEP BUTTONS ──
function startStep(key,dir){stopStep();stepKey=key;stepDir=dir;doStep();stepInterval=setInterval(doStep,80);}
function stopStep(){clearInterval(stepInterval);stepInterval=null;}
function doStep(){
  if(selectedIds.size===0)return;
  const b=getFirstSelectedBox(); if(!b)return;
  if(stepKey==='w')b.w=Math.max(20,b.w+stepDir);
  if(stepKey==='h')b.h=Math.max(20,b.h+stepDir);
  if(stepKey==='x')b.x+=stepDir;
  if(stepKey==='y')b.y+=stepDir;
  const el=document.getElementById('p-'+stepKey);
  if(el)el.value=Math.round(b[stepKey]);
  if(stepKey==='w')document.getElementById('pv-w').textContent=Math.round(b.w);
  if(stepKey==='h')document.getElementById('pv-h').textContent=Math.round(b.h);
  markUnsaved(); redraw();
}

// ── PANEL ──
function updatePanel(){
  document.getElementById('no-sel').style.display='none';
  document.getElementById('box-props').style.display='none';
  document.getElementById('wire-props').style.display='none';
  document.getElementById('multi-sel-info').style.display='none';

  if(selectedIds.size===1){
    const b=getFirstSelectedBox();
    if(!b){document.getElementById('no-sel').style.display='block';return;}
    document.getElementById('box-props').style.display='block';
    document.getElementById('p-label').value=b.label||'';
    document.getElementById('p-sub').value=b.sub||'';
    document.getElementById('p-w').value=Math.round(b.w);
    document.getElementById('pv-w').textContent=Math.round(b.w);
    document.getElementById('p-h').value=Math.round(b.h);
    document.getElementById('pv-h').textContent=Math.round(b.h);
    document.getElementById('p-r').value=b.r||6;
    document.getElementById('pv-r').textContent=b.r||6;
    document.getElementById('p-fill').value=b.fill||'#e3f2fd';
    document.getElementById('p-stroke').value=b.stroke||'#1565c0';
    document.getElementById('p-textcol').value=b.textColor||'#1a1a2e';
    document.getElementById('p-fontsize').value=b.fontSize||11;
    document.getElementById('pv-fs').textContent=(b.fontSize||11)+'px';
    document.getElementById('p-fontw').value=b.fontWeight||'bold';
    document.getElementById('p-sw').value=b.strokeWidth||1.5;
    document.getElementById('pv-sw').textContent=b.strokeWidth||1.5;
    document.getElementById('p-shape').value=b.shape||'rect';
    document.getElementById('p-dash').value=b.dash||'solid';
    document.getElementById('p-opacity').value=b.opacity||1;
    document.getElementById('pv-op').textContent=Math.round((b.opacity||1)*100)+'%';
    document.getElementById('p-x').value=Math.round(b.x);
    document.getElementById('p-y').value=Math.round(b.y);
  } else if(selectedIds.size>1){
    document.getElementById('multi-sel-info').style.display='block';
    document.getElementById('multi-count').textContent=selectedIds.size+' boxes'+(selectedWireIds.size?' + '+selectedWireIds.size+' wires':'');
  } else if(selectedWireIds.size===1){
    const w=getFirstSelectedWire();
    if(!w){document.getElementById('no-sel').style.display='block';return;}
    document.getElementById('wire-props').style.display='block';
    document.getElementById('wp-label').value=w.label||'';
    document.getElementById('wp-color').value=w.color||'#d32f2f';
    document.getElementById('wp-width').value=w.width||1.5;
    document.getElementById('pv-ww').textContent=w.width||1.5;
    document.getElementById('wp-style').value=w.style||'solid';
    document.getElementById('wp-route').value=w.route||'ortho';
    document.getElementById('wp-arrow').value=w.arrow||'end';
  } else if(selectedWireIds.size>1){
    document.getElementById('multi-sel-info').style.display='block';
    document.getElementById('multi-count').textContent=selectedWireIds.size+' wires';
  } else {
    document.getElementById('no-sel').style.display='block';
  }
}
function upP(key,val){
  if(selectedIds.size===0)return;
  if(selectedIds.size===1){
    const b=getFirstSelectedBox();if(b){b[key]=val;markUnsaved();redraw();}
  } else {
    selectedIds.forEach(id=>{const b=boxes.find(b=>b.id===id);if(b)b[key]=val;});
    markUnsaved();redraw();
  }
}
function upW(key,val){
  if(selectedWireIds.size===0)return;
  selectedWireIds.forEach(id=>{
    const w=wires.find(w=>w.id===id);
    if(w){w[key]=val;if(key==='color')curWireColor=val;}
  });
  markUnsaved();redraw();
}

// ── MODE ──
function setMode(m){
  mode=m;
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('btn-'+m)?.classList.add('active');
  if(m!=='wire') wireHover=null;
  canvas.style.cursor=m==='wire'?'crosshair':'default';
}

// ── ADD ──
function addBox(){
  pushUndo();
  const cx=(canvas.width/2-pan.x)/scale, cy=(canvas.height/2-pan.y)/scale;
  const b={id:newId(),label:'Component',sub:'subtitle',x:snap(cx-60),y:snap(cy-30),
    w:120,h:60,r:6,fill:'#e3f2fd',stroke:'#1565c0',textColor:'#1a1a2e',
    fontSize:11,fontWeight:'bold',strokeWidth:1.5,shape:'rect',dash:'solid',opacity:1};
  boxes.push(b); selectBox(b.id); markUnsaved(); redraw(); toast('Box added','ok');
}
function addLabel(){
  pushUndo();
  const cx=(canvas.width/2-pan.x)/scale, cy=(canvas.height/2-pan.y)/scale;
  const b={id:newId(),label:'Label',sub:'',x:snap(cx-40),y:snap(cy-14),
    w:80,h:28,r:0,fill:'rgba(0,0,0,0)',stroke:'rgba(0,0,0,0)',textColor:'#1a1a2e',
    fontSize:10,fontWeight:'normal',strokeWidth:0,shape:'rect',dash:'solid',opacity:1};
  boxes.push(b); selectBox(b.id); markUnsaved(); redraw();
}
function addFromLibrary(item){
  const cx=(canvas.width/2-pan.x)/scale, cy=(canvas.height/2-pan.y)/scale;
  addFromLibraryAt(item,cx,cy);
}

function addFromLibraryAt(item, wx, wy){
  pushUndo();
  const b={id:newId(),label:item.label,sub:item.sub||'',x:snap(wx-item.w/2),y:snap(wy-item.h/2),
    w:item.w,h:item.h,r:item.r||6,fill:item.fill,stroke:item.stroke,textColor:item.textColor,
    fontSize:item.fontSize||11,fontWeight:item.fontWeight||'bold',strokeWidth:item.strokeWidth!==undefined?item.strokeWidth:1.5,
    shape:item.shape||'rect',dash:item.dash||'solid',opacity:1};
  boxes.push(b); selectBox(b.id); markUnsaved(); redraw(); toast(item.name+' added','ok');
}

// ── PANEL/LIBRARY TOGGLE ──
function togglePanel(){document.getElementById('panel').classList.toggle('open');}
function toggleLibrary(){
  showLibrary=!showLibrary;
  document.getElementById('library').classList.toggle('open',showLibrary);
}
function toggleMinimap(){
  showMinimap=!showMinimap;
  document.getElementById('minimap').classList.toggle('show',showMinimap);
  redraw();
}

// ── ZOOM ──
function zoomIn(){const cx=canvas.width/2,cy=canvas.height/2;const ns=Math.min(5,scale*1.2);pan.x=cx-(cx-pan.x)*(ns/scale);pan.y=cy-(cy-pan.y)*(ns/scale);scale=ns;redraw();}
function zoomOut(){const cx=canvas.width/2,cy=canvas.height/2;const ns=Math.max(0.1,scale/1.2);pan.x=cx-(cx-pan.x)*(ns/scale);pan.y=cy-(cy-pan.y)*(ns/scale);scale=ns;redraw();}
function resetView(){
  if(!boxes.length){pan={x:canvas.width/2,y:canvas.height/2};scale=1;redraw();return;}
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  boxes.forEach(b=>{minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);maxX=Math.max(maxX,b.x+b.w);maxY=Math.max(maxY,b.y+b.h);});
  wires.forEach(w=>{getWirePts(w).forEach(p=>{minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);});});
  const pad=60,cw=canvas.width,ch=canvas.height;
  scale=Math.min((cw-pad*2)/(maxX-minX||1),(ch-pad*2)/(maxY-minY||1),2);
  pan.x=cw/2-((minX+maxX)/2)*scale; pan.y=ch/2-((minY+maxY)/2)*scale;
  redraw();
}

// ── DELETE / DUP ──
function deleteSelected(){
  pushUndo();
  if(selectedIds.size>0){
    const ids=new Set(selectedIds);
    boxes=boxes.filter(b=>!ids.has(b.id));
    wires=wires.filter(w=>!ids.has(w.fromId)&&!ids.has(w.toId));
    groups=groups.map(g=>({...g,memberIds:g.memberIds.filter(id=>!ids.has(id)),wireIds:(g.wireIds||[]).filter(id=>!ids.has(id))})).filter(g=>g.memberIds.length>0);
    selectedIds.clear();
  }
  if(selectedWireIds.size>0){
    const ids=new Set(selectedWireIds);
    wires=wires.filter(w=>!ids.has(w.id));
    groups=groups.map(g=>({...g,wireIds:(g.wireIds||[]).filter(id=>!ids.has(id))}));
    selectedWireIds.clear();
  }
  markUnsaved(); updatePanel(); redraw();
}

function clearWireLabel(){
  if(selectedWireIds.size===0){
    toast('Select a wire first','err');
    return;
  }
  pushUndo();
  let changed=0;
  selectedWireIds.forEach(id=>{
    const w=wires.find(x=>x.id===id);
    if(!w) return;
    if((w.label||'').trim()) changed++;
    w.label='';
    delete w.labelOffset;
  });
  markUnsaved();
  updatePanel();
  redraw();
  toast(changed?'Wire label removed':'Label already empty','ok');
}
function duplicateSel(){
  if(selectedIds.size===0)return;
  pushUndo();
  const newIds=new Map();
  selectedIds.forEach(id=>{
    const b=boxes.find(b=>b.id===id);
    if(b){
      const nid=newId();
      newIds.set(id,nid);
      boxes.push({...b,id:nid,x:b.x+20,y:b.y+20});
    }
  });
  selectedIds.clear();
  newIds.forEach(nid=>selectedIds.add(nid));
  markUnsaved(); updatePanel(); redraw(); toast('Duplicated','ok');
}
function bringFront(){
  if(selectedIds.size===0)return;
  selectedIds.forEach(id=>{
    const i=boxes.findIndex(b=>b.id===id);
    if(i>=0){const b=boxes.splice(i,1)[0];boxes.push(b);}
  });
  redraw();
}
function sendBack(){
  if(selectedIds.size===0)return;
  const arr=[]; selectedIds.forEach(id=>{
    const i=boxes.findIndex(b=>b.id===id);
    if(i>=0)arr.push(boxes.splice(i,1)[0]);
  });
  boxes.unshift(...arr); redraw();
}
function selectAll(){
  selectedIds.clear(); selectedWireIds.clear();
  boxes.forEach(b=>selectedIds.add(b.id));
  wires.forEach(w=>selectedWireIds.add(w.id));
  updatePanel(); redraw(); toast(selectedIds.size+' items selected','info');
}

// ── GROUPING ──
function groupSelected(){
  const allIds=[...selectedIds];
  const allWireIds=[...selectedWireIds];
  if(allIds.length<2&&allWireIds.length===0){toast('Select 2+ items to group','err');return;}
  // Remove from existing groups
  groups.forEach(g=>{
    g.memberIds=g.memberIds.filter(id=>!selectedIds.has(id));
    g.wireIds=(g.wireIds||[]).filter(id=>!selectedWireIds.has(id));
  });
  groups=groups.filter(g=>g.memberIds.length>0);
  const gid='g'+newId();
  groups.push({id:gid,memberIds:allIds,wireIds:allWireIds});
  markUnsaved(); redraw(); toast('Grouped ('+gid+')','ok');
}
function ungroupSelected(){
  const idsToUngroup=new Set([...selectedIds]);
  let ungrouped=0;
  groups=groups.filter(g=>{
    const hasOverlap=g.memberIds.some(id=>idsToUngroup.has(id));
    if(hasOverlap){ungrouped++;return false;}
    return true;
  });
  if(ungrouped) {markUnsaved();redraw();toast('Ungrouped','ok');}
  else toast('No group found','err');
}

// ── LABEL MODAL ──
let _modalCb=null;
function editLabel(){
  const b=getFirstSelectedBox(); if(!b)return;
  document.getElementById('modal-title').textContent='Edit: '+b.id;
  document.getElementById('modal-input').value=b.label||'';
  document.getElementById('modal-sub').value=b.sub||'';
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(()=>document.getElementById('modal-input').focus(),100);
  _modalCb=()=>{b.label=document.getElementById('modal-input').value;b.sub=document.getElementById('modal-sub').value;updatePanel();markUnsaved();redraw();};
}
function confirmModal(){if(_modalCb)_modalCb();closeModal();}
function closeModal(){document.getElementById('modal-overlay').classList.remove('show');_modalCb=null;}
document.getElementById('modal-input').addEventListener('keydown',e=>{if(e.key==='Enter')confirmModal();if(e.key==='Escape')closeModal();});

// ── UNDO / REDO ──
function pushUndo(){undoStack.push(JSON.stringify({boxes,wires,groups}));if(undoStack.length>50)undoStack.shift();redoStack=[];}
function undoAction(){
  if(!undoStack.length)return;
  redoStack.push(JSON.stringify({boxes,wires,groups}));
  const s=JSON.parse(undoStack.pop());
  boxes=s.boxes;wires=s.wires;groups=s.groups||[];
  selectedIds.clear();selectedWireIds.clear();
  markUnsaved();updatePanel();redraw();toast('Undo');
}
function redoAction(){
  if(!redoStack.length)return;
  undoStack.push(JSON.stringify({boxes,wires,groups}));
  const s=JSON.parse(redoStack.pop());
  boxes=s.boxes;wires=s.wires;groups=s.groups||[];
  selectedIds.clear();selectedWireIds.clear();
  markUnsaved();updatePanel();redraw();toast('Redo');
}

// ── CTX MENU ──
function showCtxMenu(x,y){const m=document.getElementById('ctx-menu');m.style.left=x+'px';m.style.top=y+'px';m.classList.add('show');}
function hideCtxMenu(){document.getElementById('ctx-menu').classList.remove('show');}
document.addEventListener('click',hideCtxMenu);

// ── SAVE / LOAD / EXPORT ──
async function pickSaveFolder(){
  if(!FS_SUPPORTED){
    toast('Direct folder save not supported on this browser','err');
    return;
  }
  try{
    dirHandle=await window.showDirectoryPicker({mode:'readwrite'});
    toast('Save folder: '+dirHandle.name,'ok');
  }catch(e){
    if(e&&e.name!=='AbortError') toast('Folder selection failed: '+e.message,'err');
  }
}

async function saveProgress(){
  const data=JSON.stringify({boxes,wires,groups,canvasBg,gridMode,v:2,savedAt:new Date().toISOString()},null,2);
  const fname='tamtap-diagram-'+new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')+'.json';
  if(dirHandle){
    try{
      const fh=await dirHandle.getFileHandle(fname,{create:true});
      const wr=await fh.createWritable(); await wr.write(data); await wr.close();
      markSaved(); toast('Saved → '+dirHandle.name+'/'+fname,'ok'); return;
    }catch(e){toast('Save error: '+e.message,'err');}
  }
  if(!FS_SUPPORTED){
    toast('Direct folder save not supported - downloading instead','info');
  }
  // Fallback: browser download
  const a=document.createElement('a');
  a.href='data:application/json,'+encodeURIComponent(data);
  a.download=fname; a.click();
  markSaved(); toast('Downloaded: '+fname,'ok');
}

async function saveAs(){
  const data=JSON.stringify({boxes,wires,groups,canvasBg,gridMode,v:2,savedAt:new Date().toISOString()},null,2);
  const suggestedName='tamtap-diagram-'+new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')+'.json';
  if(SAVE_AS_SUPPORTED){
    try{
      const fileHandle=await window.showSaveFilePicker({
        suggestedName,
        types:[{description:'JSON Files',accept:{'application/json':['.json']}}]
      });
      const writable=await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      markSaved();
      toast('Saved As: '+(fileHandle.name||suggestedName),'ok');
      return;
    }catch(e){
      if(e&&e.name!=='AbortError') toast('Save As failed: '+e.message,'err');
      return;
    }
  }
  toast('Save As not supported - downloading instead','info');
  const a=document.createElement('a');
  a.href='data:application/json,'+encodeURIComponent(data);
  a.download=suggestedName;
  a.click();
  markSaved();
}

function initFileSystemUI(){
  const folderBtn=document.getElementById('btn-folder');
  if(folderBtn&&!FS_SUPPORTED){
    folderBtn.style.display='none';
  }
}

function loadFileDialog(){document.getElementById('json-file-input').click();}
function loadJSONFile(input){
  const file=input.files[0]; if(!file)return;
  const r=new FileReader();
  r.onload=e=>{
    try{
      const d=migrateState(JSON.parse(e.target.result)); pushUndo();
      boxes=d.boxes||[]; wires=d.wires||[]; groups=d.groups||[];
      canvasBg=d.canvasBg||'#ffffff'; gridMode=d.gridMode||'none';
      document.getElementById('g-bg').value=canvasBg;
      document.getElementById('g-grid').value=gridMode;
      selectedIds.clear(); selectedWireIds.clear();
      syncIdCounter(); validateWires(); autoSaveLocal(); updatePanel(); redraw(); resetView();
      toast('Loaded: '+file.name,'ok'); markSaved();
    }catch(err){toast('Error loading file','err');}
  };
  r.readAsText(file); input.value='';
}

// ── EXPORT PNG ──
function exportPNG(){
  if(!boxes.length){toast('Nothing to export','err');return;}
  const pad=48,DPR=2;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  boxes.forEach(b=>{minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);maxX=Math.max(maxX,b.x+b.w);maxY=Math.max(maxY,b.y+b.h);});
  wires.forEach(w=>{getWirePts(w).forEach(p=>{minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);});});
  const W=(maxX-minX+pad*2)*DPR, H=(maxY-minY+pad*2)*DPR;
  const oc=document.createElement('canvas'); oc.width=W; oc.height=H;
  const ox=oc.getContext('2d');
  ox.fillStyle=canvasBg; ox.fillRect(0,0,W,H);
  ox.save(); ox.scale(DPR,DPR); ox.translate(-minX+pad,-minY+pad);
  // Use same draw functions with temp override
  const oldSel=new Set(selectedIds); const oldWSel=new Set(selectedWireIds);
  selectedIds.clear(); selectedWireIds.clear();
  const oldCtx=ctx; // Temporarily redirect
  wires.forEach(w=>drawWireForExport(ox,w));
  boxes.forEach(b=>drawBoxForExport(ox,b));
  selectedIds=oldSel; selectedWireIds=oldWSel;
  ox.restore();
  const a=document.createElement('a'); a.href=oc.toDataURL('image/png'); a.download='tamtap-wiring.png'; a.click();
  toast('PNG exported!','ok');
  // Also auto-save JSON
  saveProgress();
}

function drawBoxForExport(c,b){
  c.save(); c.globalAlpha=b.opacity||1;
  c.fillStyle=b.fill||'#e3f2fd'; c.strokeStyle=b.stroke||'#1565c0'; c.lineWidth=b.strokeWidth||1.5;
  if(b.dash==='dashed')c.setLineDash([8,4]);else if(b.dash==='dotted')c.setLineDash([2,5]);else c.setLineDash([]);
  const{x,y,w,h}=b;
  if(b.shape==='circle'){const r=Math.min(w,h)/2;c.beginPath();c.arc(x+w/2,y+h/2,r,0,Math.PI*2);c.fill();c.stroke();}
  else if(b.shape==='diamond'){c.beginPath();c.moveTo(x+w/2,y);c.lineTo(x+w,y+h/2);c.lineTo(x+w/2,y+h);c.lineTo(x,y+h/2);c.closePath();c.fill();c.stroke();}
  else if(b.shape==='pill'){c.beginPath();c.roundRect(x,y,w,h,h/2);c.fill();c.stroke();}
  else{c.beginPath();c.roundRect(x,y,w,h,Math.min(b.r||6,w/2,h/2));c.fill();c.stroke();}
  c.setLineDash([]); c.fillStyle=b.textColor||'#1a1a2e'; c.textAlign='center'; c.textBaseline='middle';
  const fs=b.fontSize||11,cx=x+w/2,cy=y+h/2;
  if(b.sub&&b.sub.trim()){c.font=(b.fontWeight||'bold')+' '+fs+'px "Outfit",sans-serif';c.fillText(b.label||'',cx,cy-fs*0.72);c.font='normal '+fs*0.77+'px "JetBrains Mono",monospace';c.globalAlpha*=0.7;c.fillText(b.sub,cx,cy+fs*0.78);}
  else{c.font=(b.fontWeight||'bold')+' '+fs+'px "Outfit",sans-serif';c.fillText(b.label||'',cx,cy);}
  c.restore();
}
function drawWireForExport(c,w){
  c.save(); c.strokeStyle=w.color||'#d32f2f'; c.lineWidth=w.width||1.5;
  if(w.style==='dashed')c.setLineDash([8,4]);else if(w.style==='dotted')c.setLineDash([2,5]);else c.setLineDash([]);
  c.lineCap='round'; c.lineJoin='round';
  const pts=getWirePts(w); if(pts.length<2){c.restore();return;}
  c.beginPath(); c.moveTo(pts[0].x,pts[0].y);
  if(w.route==='curve'){const mid={x:(pts[0].x+pts[pts.length-1].x)/2,y:(pts[0].y+pts[pts.length-1].y)/2};c.quadraticCurveTo(mid.x,pts[0].y,pts[pts.length-1].x,pts[pts.length-1].y);}
  else{for(let i=1;i<pts.length;i++)c.lineTo(pts[i].x,pts[i].y);}
  c.stroke();
  if(w.arrow!=='none'){
    const p0=pts[pts.length-2],p1=pts[pts.length-1];
    if(p0&&p1){const a=Math.atan2(p1.y-p0.y,p1.x-p0.x),sz=Math.max(7,(w.width||1.5)*3.5);c.save();c.setLineDash([]);c.fillStyle=w.color||'#d32f2f';c.beginPath();c.translate(p1.x,p1.y);c.rotate(a);c.moveTo(0,0);c.lineTo(-sz,-sz/2.2);c.lineTo(-sz,sz/2.2);c.closePath();c.fill();c.restore();}
  }
  c.setLineDash([]); c.fillStyle=w.color||'#d32f2f';
  [pts[0],pts[pts.length-1]].forEach(p=>{c.beginPath();c.arc(p.x,p.y,2.5,0,Math.PI*2);c.fill();});
  if(w.label&&w.label.trim()){
    const anchor=getWireLabelAnchor(w,pts);
    if(anchor){
      c.font='bold 9px "JetBrains Mono",monospace';
      const lw=c.measureText(w.label).width+14;
      c.fillStyle='rgba(255,255,255,0.97)';
      c.beginPath();
      c.roundRect(anchor.x-lw/2,anchor.y-8,lw,16,4);
      c.fill();
      c.fillStyle=w.color||'#d32f2f';
      c.textAlign='center';
      c.textBaseline='middle';
      c.fillText(w.label,anchor.x,anchor.y);
    }
  }
  c.restore();
}

// ── EXPORT SVG ──
function exportSVG(){
  if(!boxes.length){toast('Nothing to export','err');return;}
  const pad=48;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  boxes.forEach(b=>{minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);maxX=Math.max(maxX,b.x+b.w);maxY=Math.max(maxY,b.y+b.h);});
  wires.forEach(w=>{getWirePts(w).forEach(p=>{minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);});});
  const W=maxX-minX+pad*2, H=maxY-minY+pad*2;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n`;
  svg+=`<rect width="${W}" height="${H}" fill="${canvasBg}"/>\n`;
  svg+=`<g transform="translate(${-minX+pad},${-minY+pad})">\n`;
  // Wires
  wires.forEach(w=>{
    const pts=getWirePts(w); if(pts.length<2)return;
    let d='M'+pts[0].x+' '+pts[0].y;
    for(let i=1;i<pts.length;i++)d+=' L'+pts[i].x+' '+pts[i].y;
    const dash=w.style==='dashed'?' stroke-dasharray="8 4"':w.style==='dotted'?' stroke-dasharray="2 5"':'';
    svg+=`  <path d="${d}" stroke="${w.color||'#d32f2f'}" stroke-width="${w.width||1.5}" fill="none" stroke-linecap="round"${dash}/>\n`;
    if(w.label&&w.label.trim()){
      const anchor=getWireLabelAnchor(w,pts);
      if(anchor){
        svg+=`  <text x="${anchor.x}" y="${anchor.y}" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono,monospace" font-size="9" font-weight="bold" fill="${w.color||'#d32f2f'}">${escXml(w.label)}</text>\n`;
      }
    }
  });
  // Boxes
  boxes.forEach(b=>{
    const{x,y,w,h}=b;
    const dash=b.dash==='dashed'?' stroke-dasharray="8 4"':b.dash==='dotted'?' stroke-dasharray="2 5"':'';
    if(b.shape==='circle'){
      const r=Math.min(w,h)/2;
      svg+=`  <circle cx="${x+w/2}" cy="${y+h/2}" r="${r}" fill="${b.fill||'#e3f2fd'}" stroke="${b.stroke||'#1565c0'}" stroke-width="${b.strokeWidth||1.5}" opacity="${b.opacity||1}"${dash}/>\n`;
    } else if(b.shape==='diamond'){
      svg+=`  <polygon points="${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}" fill="${b.fill}" stroke="${b.stroke}" stroke-width="${b.strokeWidth||1.5}" opacity="${b.opacity||1}"${dash}/>\n`;
    } else {
      const r=b.shape==='pill'?h/2:Math.min(b.r||6,w/2,h/2);
      svg+=`  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${b.fill||'#e3f2fd'}" stroke="${b.stroke||'#1565c0'}" stroke-width="${b.strokeWidth||1.5}" opacity="${b.opacity||1}"${dash}/>\n`;
    }
    const cx=x+w/2, cy=y+h/2, fs=b.fontSize||11;
    if(b.sub&&b.sub.trim()){
      svg+=`  <text x="${cx}" y="${cy-fs*0.6}" text-anchor="middle" dominant-baseline="central" font-family="Outfit,sans-serif" font-size="${fs}" font-weight="${b.fontWeight||'bold'}" fill="${b.textColor||'#1a1a2e'}">${escXml(b.label||'')}</text>\n`;
      svg+=`  <text x="${cx}" y="${cy+fs*0.7}" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono,monospace" font-size="${Math.round(fs*0.77)}" fill="${b.textColor||'#1a1a2e'}" opacity="0.65">${escXml(b.sub)}</text>\n`;
    } else {
      svg+=`  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="Outfit,sans-serif" font-size="${fs}" font-weight="${b.fontWeight||'bold'}" fill="${b.textColor||'#1a1a2e'}">${escXml(b.label||'')}</text>\n`;
    }
  });
  svg+=`</g>\n</svg>`;
  const a=document.createElement('a');
  a.href='data:image/svg+xml,'+encodeURIComponent(svg);
  a.download='tamtap-diagram.svg'; a.click();
  toast('SVG exported!','ok');
}
function escXml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── CLEAR ──
function clearAll(){if(!confirm('Clear everything?'))return;pushUndo();boxes=[];wires=[];groups=[];selectedIds.clear();selectedWireIds.clear();markUnsaved();updatePanel();redraw();toast('Cleared');}

// ── WIRE SWATCHES ──
function initSwatches(){
  const c=document.getElementById('wire-swatches');
  WIRE_COLORS.forEach(wc=>{
    const s=document.createElement('div'); s.className='swatch'; s.style.background=wc.c; s.title=wc.n;
    s.onclick=()=>{curWireColor=wc.c;document.querySelectorAll('.swatch').forEach(x=>x.classList.remove('active'));s.classList.add('active');upW('color',wc.c);document.getElementById('wp-color').value=wc.c;};
    c.appendChild(s);
  });
}

// ── LIBRARY SIDEBAR ──
function initLibrary(){
  const cont=document.getElementById('lib-items');
  LIBRARY.forEach((cat,catIdx)=>{
    const div=document.createElement('div'); div.className='lib-category';
    div.innerHTML=`<div class="lib-cat-title">${cat.cat}</div>`;
    cat.items.forEach((item,itemIdx)=>{
      const el=document.createElement('div'); el.className='lib-item'; el.dataset.name=item.name.toLowerCase();
      el.dataset.libIndex=`${catIdx}:${itemIdx}`;
      el.draggable=true;
      el.innerHTML=`<div class="lib-swatch" style="background:${item.fill};border:1px solid ${item.stroke}"></div>${item.name}`;
      el.onclick=()=>addFromLibrary(item);
      el.addEventListener('dragstart',ev=>{
        ev.dataTransfer.setData('text/plain',el.dataset.libIndex);
        ev.dataTransfer.effectAllowed='copy';
      });
      div.appendChild(el);
    });
    cont.appendChild(div);
  });
  document.getElementById('lib-search').addEventListener('input',e=>{
    const q=e.target.value.toLowerCase();
    cont.querySelectorAll('.lib-item').forEach(el=>{
      el.style.display=el.dataset.name.includes(q)?'flex':'none';
    });
  });

  const wrap=document.getElementById('canvas-wrap');
  if(wrap&&!wrap.dataset.libDndBound){
    wrap.addEventListener('dragover',ev=>{
      ev.preventDefault();
      ev.dataTransfer.dropEffect='copy';
    });
    wrap.addEventListener('drop',ev=>{
      ev.preventDefault();
      const idx=ev.dataTransfer.getData('text/plain');
      if(!idx||!idx.includes(':')) return;
      const parts=idx.split(':');
      const catIdx=Number(parts[0]);
      const itemIdx=Number(parts[1]);
      if(!Number.isInteger(catIdx)||!Number.isInteger(itemIdx)) return;
      const item=LIBRARY[catIdx]&&LIBRARY[catIdx].items&&LIBRARY[catIdx].items[itemIdx];
      if(!item) return;
      const rect=canvas.getBoundingClientRect();
      const wp=s2w(ev.clientX-rect.left,ev.clientY-rect.top);
      addFromLibraryAt(item,wp.x,wp.y);
    });
    wrap.dataset.libDndBound='1';
  }
}

// ── MINIMAP CLICK ──
document.getElementById('minimap')?.addEventListener('click',e=>{
  if(!boxes.length)return;
  const mc=document.getElementById('minimap-canvas');
  const rect=mc.getBoundingClientRect();
  const mx=(e.clientX-rect.left)/rect.width, my=(e.clientY-rect.top)/rect.height;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  boxes.forEach(b=>{minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);maxX=Math.max(maxX,b.x+b.w);maxY=Math.max(maxY,b.y+b.h);});
  const pad=20, rw=maxX-minX+pad*2, rh=maxY-minY+pad*2;
  const wx=minX-pad+mx*rw, wy=minY-pad+my*rh;
  pan.x=canvas.width/2-wx*scale; pan.y=canvas.height/2-wy*scale;
  redraw();
});

// ── KEYBOARD ──
document.addEventListener('keydown',e=>{
  const tag=e.target.tagName;
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
  if((e.key==='Delete'||e.key==='Backspace')&&e.shiftKey&&selectedWireIds.size>0&&selectedIds.size===0){
    e.preventDefault();
    clearWireLabel();
    return;
  }
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected();}
  if(e.key==='Escape'){selectedIds.clear();selectedWireIds.clear();setMode('select');updatePanel();redraw();}
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undoAction();}
  if((e.ctrlKey||e.metaKey)&&e.key==='y'){e.preventDefault();redoAction();}
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveProgress();}
  if((e.ctrlKey||e.metaKey)&&e.key==='d'){e.preventDefault();duplicateSel();}
  if((e.ctrlKey||e.metaKey)&&e.key==='a'){e.preventDefault();selectAll();}
  if((e.ctrlKey||e.metaKey)&&e.key==='g'&&!e.shiftKey){e.preventDefault();groupSelected();}
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='G'){e.preventDefault();ungroupSelected();}
  if((e.ctrlKey||e.metaKey)&&e.key==='e'&&!e.shiftKey){e.preventDefault();exportPNG();}
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='E'){e.preventDefault();exportSVG();}
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='S'){e.preventDefault();saveAs();}
  if(!e.ctrlKey&&!e.metaKey){
    if(e.key==='s')setMode('select');
    if(e.key==='w')setMode('wire');
    if(e.key==='b')addBox();
    if(e.key==='m')toggleMinimap();
    if(e.key==='l')toggleLibrary();
    if(e.key==='g')cycleGridMode();
    if(e.key==='ArrowLeft'&&selectedIds.size>0){selectedIds.forEach(id=>{const b=boxes.find(b=>b.id===id);if(b)b.x-=1;});markUnsaved();redraw();}
    if(e.key==='ArrowRight'&&selectedIds.size>0){selectedIds.forEach(id=>{const b=boxes.find(b=>b.id===id);if(b)b.x+=1;});markUnsaved();redraw();}
    if(e.key==='ArrowUp'&&selectedIds.size>0){selectedIds.forEach(id=>{const b=boxes.find(b=>b.id===id);if(b)b.y-=1;});markUnsaved();redraw();}
    if(e.key==='ArrowDown'&&selectedIds.size>0){selectedIds.forEach(id=>{const b=boxes.find(b=>b.id===id);if(b)b.y+=1;});markUnsaved();redraw();}
  }
});
