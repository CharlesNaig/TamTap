// ════════════════════════════════════════════════════════════
//  TamTap Diagram Editor — Core Engine
// ════════════════════════════════════════════════════════════

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ── STATE ──
let boxes = [], wires = [], groups = [];
let selectedIds = new Set();          // multi-select
let selectedWireIds = new Set();      // multi-select wires
let mode = 'select';
let pan = {x:0,y:0}, scale = 1;
let snapGrid = 20;
let canvasBg = '#ffffff', gridMode = 'none';
let undoStack = [], redoStack = [];
let idCounter = 1;
let _unsaved = false;

// Interaction
let dragging = false, dragOffsets = new Map();
let panning = false, panStart = {x:0,y:0}, panOrigin = {x:0,y:0};
let wireStart = null, wireTemp = null;
let draggingWireLabel = false;
let wireLabelDragId = null;
let wireLabelDragStart = null;
let pinchStartDist = 0, pinchStartScale = 1;
let lastTap = 0;
let resizing = false, resizeHandle = null, resizeBox = null, resizeStart = {};
const HANDLE_SIZE = 14;
let stepInterval = null, stepKey = null, stepDir = 0;
let selRect = null; // drag-select rectangle
let showMinimap = false;
let showLibrary = false;
let wireHover = null; // { boxId, port, dist }

// Alignment guides
let alignGuides = [];

// Wire defaults
let curWireColor = '#d32f2f', curWireWidth = 1.5, curWireStyle = 'solid', curWireRoute = 'ortho', curWireArrow = 'end';

// File System Access API handle
let dirHandle = null;
const FS_SUPPORTED = typeof window.showDirectoryPicker === 'function';
const SAVE_AS_SUPPORTED = typeof window.showSaveFilePicker === 'function';

let minimapLastRender = 0;
let lastRenderErrorAt = 0;

// Lane separation for overlapping wires.
const WIRE_BUNDLE_OFFSET_FACTOR = 0.5;
const WIRE_BUNDLE_STEP_PX = 8;

const WIRE_COLORS = [
  {n:'Red',c:'#d32f2f'},{n:'Black',c:'#212121'},{n:'White',c:'#9e9e9e'},
  {n:'Yellow',c:'#f9a825'},{n:'Green',c:'#388e3c'},{n:'Blue',c:'#1565c0'},
  {n:'Orange',c:'#e65100'},{n:'Purple',c:'#6a1b9a'},{n:'Teal',c:'#00695c'},
  {n:'Pink',c:'#e91e63'},{n:'Brown',c:'#795548'},{n:'Gray',c:'#607d8b'},
  {n:'Cyan',c:'#0097a7'},{n:'Lime',c:'#558b2f'},{n:'Indigo',c:'#283593'}
];

// ── COMPONENT LIBRARY ──
const LIBRARY = [
  { cat:'Electronics', items:[
    {name:'Resistor',label:'Resistor',sub:'Ω',w:80,h:36,r:4,fill:'#fff3e0',stroke:'#e65100',textColor:'#bf360c',shape:'rect',fontSize:9},
    {name:'LED',label:'LED',sub:'GPIO',w:50,h:50,r:25,fill:'#e8f5e9',stroke:'#2e7d32',textColor:'#1b5e20',shape:'circle',fontSize:9},
    {name:'Capacitor',label:'Cap',sub:'μF',w:60,h:40,r:4,fill:'#e3f2fd',stroke:'#1565c0',textColor:'#0d47a1',shape:'rect',fontSize:9},
    {name:'Transistor',label:'Transistor',sub:'NPN/PNP',w:80,h:50,r:4,fill:'#f3e5f5',stroke:'#6a1b9a',textColor:'#4a148c',shape:'diamond',fontSize:9},
    {name:'IC Chip',label:'IC',sub:'chip',w:100,h:60,r:4,fill:'#eceff1',stroke:'#37474f',textColor:'#263238',shape:'rect',fontSize:10},
    {name:'Relay',label:'Relay',sub:'signal',w:90,h:48,r:5,fill:'#fff3e0',stroke:'#e65100',textColor:'#bf360c',shape:'rect',fontSize:10},
    {name:'Buzzer',label:'Buzzer',sub:'5V',w:70,h:48,r:5,fill:'#fbe9e7',stroke:'#bf360c',textColor:'#b71c1c',shape:'rect',fontSize:10},
    {name:'Sensor',label:'Sensor',sub:'input',w:90,h:48,r:5,fill:'#e0f7fa',stroke:'#00838f',textColor:'#006064',shape:'rect',fontSize:10},
  ]},
  { cat:'Connectors', items:[
    {name:'Header Pin',label:'Header',sub:'pin',w:70,h:30,r:3,fill:'#e8eaf6',stroke:'#283593',textColor:'#1a237e',shape:'rect',fontSize:9},
    {name:'Terminal',label:'Terminal',sub:'block',w:80,h:30,r:3,fill:'#efebe9',stroke:'#4e342e',textColor:'#3e2723',shape:'rect',fontSize:9},
    {name:'USB',label:'USB',sub:'connector',w:60,h:36,r:4,fill:'#e3f2fd',stroke:'#1565c0',textColor:'#0d47a1',shape:'pill',fontSize:9},
    {name:'Power Jack',label:'DC Jack',sub:'power',w:70,h:36,r:4,fill:'#fff8e1',stroke:'#f57f17',textColor:'#e65100',shape:'rect',fontSize:9},
  ]},
  { cat:'Labels', items:[
    {name:'Title',label:'Title',sub:'',w:120,h:32,r:0,fill:'rgba(0,0,0,0)',stroke:'rgba(0,0,0,0)',textColor:'#1a1a2e',shape:'rect',fontSize:16,fontWeight:'bold',strokeWidth:0},
    {name:'Subtitle',label:'Subtitle',sub:'',w:100,h:24,r:0,fill:'rgba(0,0,0,0)',stroke:'rgba(0,0,0,0)',textColor:'#555570',shape:'rect',fontSize:12,fontWeight:'normal',strokeWidth:0},
    {name:'Annotation',label:'Note',sub:'details here',w:100,h:40,r:4,fill:'#fffde7',stroke:'#f9a825',textColor:'#e65100',shape:'rect',fontSize:9,strokeWidth:1,dash:'dashed'},
    {name:'Pin Label',label:'GPIO XX',sub:'',w:70,h:20,r:2,fill:'rgba(0,0,0,0)',stroke:'rgba(0,0,0,0)',textColor:'#6a1b9a',shape:'rect',fontSize:8,fontWeight:'bold',strokeWidth:0},
  ]},
  { cat:'Shapes', items:[
    {name:'Rectangle',label:'Box',sub:'',w:120,h:60,r:6,fill:'#e3f2fd',stroke:'#1565c0',textColor:'#0d47a1',shape:'rect',fontSize:11},
    {name:'Circle',label:'Circle',sub:'',w:60,h:60,r:30,fill:'#e8f5e9',stroke:'#2e7d32',textColor:'#1b5e20',shape:'circle',fontSize:11},
    {name:'Diamond',label:'Decision',sub:'',w:80,h:80,r:0,fill:'#fff3e0',stroke:'#e65100',textColor:'#bf360c',shape:'diamond',fontSize:10},
    {name:'Pill',label:'Pill',sub:'',w:100,h:40,r:20,fill:'#f3e5f5',stroke:'#6a1b9a',textColor:'#4a148c',shape:'pill',fontSize:11},
  ]},
];

// ── HELPERS ──
function s2w(sx,sy){ return {x:(sx-pan.x)/scale, y:(sy-pan.y)/scale}; }
function w2s(wx,wy){ return {x:wx*scale+pan.x, y:wy*scale+pan.y}; }
function snap(v){ return Math.round(v/snapGrid)*snapGrid; }
function newId(){ return 'id'+idCounter++; }

function migrateState(data){
  const next = data && typeof data === 'object' ? data : {};
  if (!next.v || next.v < 2) {
    (next.boxes || []).forEach(b => {
      if (b.opacity === undefined) b.opacity = 1;
      if (!b.dash) b.dash = 'solid';
    });
    next.v = 2;
  }
  return next;
}

function validateWires(){
  const ids = new Set(boxes.map(b => b.id));
  wires.forEach(w => {
    if (w.fromId && !ids.has(w.fromId)) w.fromId = null;
    if (w.toId && !ids.has(w.toId)) w.toId = null;
  });
}

function syncIdCounter(){
  let max=0;
  boxes.forEach(b=>{const n=parseInt(String(b.id).replace(/\D/g,''));if(!isNaN(n))max=Math.max(max,n);});
  wires.forEach(w=>{const n=parseInt(String(w.id).replace(/\D/g,''));if(!isNaN(n))max=Math.max(max,n);});
  idCounter=max+1;
}

// ── SELECT BOX (was missing!) ──
function selectBox(id, addToSelection){
  if(addToSelection){
    if(selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
  } else {
    selectedIds.clear();
    selectedIds.add(id);
  }
  selectedWireIds.clear();
  updatePanel();
  redraw();
}

function selectWire(id, addToSelection){
  if(addToSelection){
    if(selectedWireIds.has(id)) selectedWireIds.delete(id);
    else selectedWireIds.add(id);
  } else {
    selectedWireIds.clear();
    selectedWireIds.add(id);
  }
  selectedIds.clear();
  updatePanel();
  redraw();
}

function getFirstSelectedBox(){
  if(selectedIds.size===0)return null;
  const id=[...selectedIds][0];
  return boxes.find(b=>b.id===id)||null;
}
function getFirstSelectedWire(){
  if(selectedWireIds.size===0)return null;
  const id=[...selectedWireIds][0];
  return wires.find(w=>w.id===id)||null;
}

// ── CANVAS RESIZE ──
function resize(){
  const wrap=document.getElementById('canvas-wrap');
  canvas.width=wrap.clientWidth;
  canvas.height=wrap.clientHeight;
  redraw();
}
window.addEventListener('resize',resize);

// ── SAVE STATUS ──
function markUnsaved(){
  _unsaved=true;
  const el=document.getElementById('save-status');
  el.textContent='● unsaved'; el.className='save-indicator unsaved';
  autoSaveLocal();
}
function markSaved(){
  _unsaved=false;
  const el=document.getElementById('save-status');
  el.textContent='● saved'; el.className='save-indicator saved';
}
function autoSaveLocal(){
  try{ localStorage.setItem('tamtap_editor_autosave',JSON.stringify({boxes,wires,groups,canvasBg,gridMode,v:2})); }catch(e){}
}
function loadAutoSave(){
  try{
    const raw=localStorage.getItem('tamtap_editor_autosave');
    if(raw){
      const d=migrateState(JSON.parse(raw));
      if(d.boxes&&d.boxes.length>0){
        boxes=d.boxes; wires=d.wires||[]; groups=d.groups||[];
        canvasBg=d.canvasBg||'#ffffff'; gridMode=d.gridMode||'none';
        document.getElementById('g-bg').value=canvasBg;
        document.getElementById('g-grid').value=gridMode;
        syncIdCounter(); validateWires(); updatePanel(); redraw(); resetView();
        toast('Auto-save restored','ok'); markSaved();
        return true;
      }
    }
  }catch(e){}
  return false;
}

// ── TOAST SYSTEM (stacking) ──
function toast(msg,type=''){
  const c=document.getElementById('toast-container');
  const el=document.createElement('div');
  el.className='toast-msg'+(type?' '+type:'');
  el.textContent=msg;
  c.appendChild(el);
  requestAnimationFrame(()=>{ el.classList.add('show'); });
  setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(),300); },2200);
}

// ── DRAW ──
function redraw(){
  try {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle=canvasBg;
    ctx.fillRect(0,0,canvas.width,canvas.height);
    if(gridMode!=='none') drawGrid();
    ctx.save();
    ctx.translate(pan.x,pan.y);
    ctx.scale(scale,scale);

    // Alignment guides
    alignGuides.forEach(g=>{
      ctx.save();
      ctx.strokeStyle='rgba(108,99,255,0.5)';
      ctx.lineWidth=1/scale;
      ctx.setLineDash([4/scale,4/scale]);
      ctx.beginPath();
      if(g.dir==='h'){ ctx.moveTo(g.min,g.pos); ctx.lineTo(g.max,g.pos); }
      else { ctx.moveTo(g.pos,g.min); ctx.lineTo(g.pos,g.max); }
      ctx.stroke();
      ctx.restore();
    });

    wires.forEach(w=>drawWire(w,false));
    if(wireTemp){
      ctx.save(); ctx.strokeStyle=curWireColor; ctx.lineWidth=curWireWidth;
      ctx.setLineDash([]); ctx.globalAlpha=0.65; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(wireTemp.x1,wireTemp.y1); ctx.lineTo(wireTemp.x2,wireTemp.y2);
      ctx.stroke(); ctx.restore();
    }
    boxes.forEach(b=>drawBox(b));
    wires.forEach(w=>drawWireLabel(w));
    drawWirePortHints();
    ctx.restore();

    // Draw resize handles on top (screen space)
    if(selectedIds.size===1){
      const b=boxes.find(b=>b.id===[...selectedIds][0]);
      if(b) drawHandles(b);
    }

    document.getElementById('zoom-badge').textContent=Math.round(scale*100)+'%';
    if(showMinimap) maybeRenderMinimap();
  } catch (err) {
    console.error('Render error:', err);
    const now = Date.now();
    if (now - lastRenderErrorAt > 1000) {
      lastRenderErrorAt = now;
      toast('Render error: ' + err.message, 'err');
    }
  }
}

function maybeRenderMinimap(){
  const now = Date.now();
  if (now - minimapLastRender < 100) return;
  minimapLastRender = now;
  drawMinimap();
}

function cycleGridMode(){
  if(gridMode==='none') gridMode='dots';
  else if(gridMode==='dots') gridMode='lines';
  else gridMode='none';
  const sel = document.getElementById('g-grid');
  if (sel) sel.value = gridMode;
  markUnsaved();
  redraw();
  toast('Grid: '+gridMode,'info');
}

function drawGrid(){
  const step=snapGrid*scale, offX=pan.x%step, offY=pan.y%step;
  ctx.save();
  if(gridMode==='dots'){
    ctx.fillStyle=canvasBg==='#ffffff'?'rgba(0,0,0,0.13)':'rgba(255,255,255,0.15)';
    for(let x=offX;x<canvas.width;x+=step)
      for(let y=offY;y<canvas.height;y+=step){
        ctx.beginPath(); ctx.arc(x,y,1.5,0,Math.PI*2); ctx.fill();
      }
  } else {
    ctx.strokeStyle=canvasBg==='#ffffff'?'rgba(0,0,0,0.07)':'rgba(255,255,255,0.07)';
    ctx.lineWidth=0.5;
    for(let x=offX;x<canvas.width;x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for(let y=offY;y<canvas.height;y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
  }
  ctx.restore();
}

function drawBox(b){
  ctx.save();
  ctx.globalAlpha=b.opacity||1;
  const sel=selectedIds.has(b.id);
  if(sel){
    ctx.shadowColor='rgba(108,99,255,0.6)';
    ctx.shadowBlur=14/scale;
  }
  ctx.fillStyle=b.fill||'#e3f2fd';
  ctx.strokeStyle=sel?'#6c63ff':b.stroke||'#1565c0';
  ctx.lineWidth=b.strokeWidth||1.5;
  if(b.dash==='dashed') ctx.setLineDash([8/scale,4/scale]);
  else if(b.dash==='dotted') ctx.setLineDash([2/scale,4/scale]);
  else ctx.setLineDash([]);
  const {x,y,w,h}=b;
  if(b.shape==='circle'){
    const r=Math.min(w,h)/2;
    ctx.beginPath(); ctx.arc(x+w/2,y+h/2,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
  } else if(b.shape==='diamond'){
    ctx.beginPath(); ctx.moveTo(x+w/2,y); ctx.lineTo(x+w,y+h/2); ctx.lineTo(x+w/2,y+h); ctx.lineTo(x,y+h/2); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if(b.shape==='pill'){
    ctx.beginPath(); ctx.roundRect(x,y,w,h,h/2); ctx.fill(); ctx.stroke();
  } else {
    const r=Math.min(b.r||6,w/2,h/2);
    ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fill(); ctx.stroke();
  }
  ctx.shadowBlur=0; ctx.setLineDash([]);
  const tc=b.textColor||'#1a1a2e';
  const fs=b.fontSize||11;
  ctx.fillStyle=tc; ctx.textAlign='center'; ctx.textBaseline='middle';
  const cx=x+w/2, cy=y+h/2;
  if(b.sub&&b.sub.trim()){
    ctx.font=(b.fontWeight||'bold')+' '+fs+'px "Outfit",sans-serif';
    ctx.fillText(b.label||'',cx,cy-fs*0.72);
    ctx.font='normal '+fs*0.77+'px "JetBrains Mono",monospace';
    ctx.globalAlpha*=0.65;
    ctx.fillText(b.sub,cx,cy+fs*0.78);
  } else {
    ctx.font=(b.fontWeight||'bold')+' '+fs+'px "Outfit",sans-serif';
    ctx.fillText(b.label||'',cx,cy);
  }
  // Group badge
  const grp=groups.find(g=>g.memberIds.includes(b.id));
  if(grp){
    ctx.globalAlpha=0.7;
    ctx.font='bold 7px "JetBrains Mono",monospace';
    ctx.fillStyle='#6c63ff';
    ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText('⊞ '+grp.id,x+3,y+2);
  }
  ctx.restore();
}

// ── HANDLES ──
function getHandles(b){
  const {x,y,w,h}=b;
  return {nw:{x,y},n:{x:x+w/2,y},ne:{x:x+w,y},w:{x,y:y+h/2},e:{x:x+w,y:y+h/2},sw:{x,y:y+h},s:{x:x+w/2,y:y+h},se:{x:x+w,y:y+h}};
}
function drawHandles(b){
  const handles=getHandles(b);
  Object.entries(handles).forEach(([id,{x,y}])=>{
    const sx=x*scale+pan.x, sy=y*scale+pan.y, s=HANDLE_SIZE;
    ctx.save(); ctx.fillStyle='#6c63ff'; ctx.strokeStyle='#ffffff'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.roundRect(sx-s/2,sy-s/2,s,s,3); ctx.fill(); ctx.stroke();
    ctx.restore();
  });
}
function hitHandle(b,sp){
  const handles=getHandles(b), hs=HANDLE_SIZE;
  for(const[id,{x,y}]of Object.entries(handles)){
    const sx=x*scale+pan.x, sy=y*scale+pan.y;
    if(Math.abs(sp.x-sx)<=hs/2+2&&Math.abs(sp.y-sy)<=hs/2+2)return id;
  }
  return null;
}
function applyResize(handleId,dx,dy,start){
  let{ox,oy,ow,oh}=start; let nx=ox,ny=oy,nw=ow,nh=oh;
  if(handleId.includes('e'))nw=Math.max(20,ow+dx);
  if(handleId.includes('s'))nh=Math.max(20,oh+dy);
  if(handleId.includes('w')){const d=Math.min(dx,ow-20);nx=ox+d;nw=ow-d;}
  if(handleId.includes('n')){const d=Math.min(dy,oh-20);ny=oy+d;nh=oh-d;}
  return {x:snap(nx),y:snap(ny),w:snap(nw),h:snap(nh)};
}

// ── WIRE DRAWING ──
function drawWire(w, drawLabel = true){
  const sel=selectedWireIds.has(w.id);
  ctx.save();
  ctx.strokeStyle=sel?'#6c63ff':w.color||'#d32f2f';
  ctx.lineWidth=w.width||1.5;
  if(w.style==='dashed')ctx.setLineDash([8,4]);
  else if(w.style==='dotted')ctx.setLineDash([2,5]);
  else ctx.setLineDash([]);
  ctx.lineCap='round'; ctx.lineJoin='round';
  const pts=getWirePts(w);
  if(pts.length<2){ctx.restore();return;}
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  if(w.route==='curve'&&pts.length>=2){
    const mid={x:(pts[0].x+pts[pts.length-1].x)/2,y:(pts[0].y+pts[pts.length-1].y)/2};
    ctx.quadraticCurveTo(mid.x,pts[0].y,pts[pts.length-1].x,pts[pts.length-1].y);
  } else { for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y); }
  ctx.stroke();
  if(w.arrow!=='none'){
    drawArr(pts[pts.length-2],pts[pts.length-1],w.color||'#d32f2f',w.width||1.5);
    if(w.arrow==='both')drawArr(pts[1],pts[0],w.color||'#d32f2f',w.width||1.5);
  }
  ctx.setLineDash([]); ctx.fillStyle=w.color||'#d32f2f';
  [pts[0],pts[pts.length-1]].forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fill();});
  if(drawLabel) drawWireLabel(w, pts);
  ctx.restore();
}

function getWireLabelPoint(w, pts){
  if(!pts || pts.length<2) return null;
  if(w.route==='curve' && pts.length>=2){
    const p0=pts[0], p2=pts[pts.length-1];
    const p1={x:(p0.x+p2.x)/2,y:p0.y};
    const t=0.5;
    const mt=1-t;
    return {
      x:mt*mt*p0.x + 2*mt*t*p1.x + t*t*p2.x,
      y:mt*mt*p0.y + 2*mt*t*p1.y + t*t*p2.y
    };
  }
  let total=0;
  const seg=[];
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    const len=Math.hypot(b.x-a.x,b.y-a.y);
    seg.push({a,b,len});
    total+=len;
  }
  if(total<=0) return {x:pts[0].x,y:pts[0].y};
  let target=total/2;
  for(let i=0;i<seg.length;i++){
    const s=seg[i];
    if(target<=s.len || i===seg.length-1){
      const t=s.len<=0?0:(target/s.len);
      return {
        x:s.a.x + (s.b.x-s.a.x)*t,
        y:s.a.y + (s.b.y-s.a.y)*t
      };
    }
    target-=s.len;
  }
  return {x:pts[pts.length-1].x,y:pts[pts.length-1].y};
}

function drawWireLabel(w, ptsArg){
  if(!w.label || !w.label.trim()) return;
  const pts=ptsArg||getWirePts(w);
  if(!pts || pts.length<2) return;
  const mid=getWireLabelAnchor(w,pts);
  if(!mid) return;
  ctx.save();
  ctx.setLineDash([]);
  ctx.font='bold 9px "JetBrains Mono",monospace';
  const text=w.label;
  const tw=ctx.measureText(text).width;
  const padX=7;
  const h=16;
  const wbg=tw+padX*2;
  ctx.shadowColor='rgba(0,0,0,0.18)';
  ctx.shadowBlur=5/scale;
  ctx.fillStyle='rgba(255,255,255,0.97)';
  ctx.beginPath();
  ctx.roundRect(mid.x-wbg/2,mid.y-h/2,wbg,h,4);
  ctx.fill();
  ctx.shadowBlur=0;
  ctx.strokeStyle='rgba(20,20,28,0.18)';
  ctx.lineWidth=1/scale;
  ctx.stroke();
  ctx.fillStyle=w.color||'#d32f2f';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillText(text,mid.x,mid.y);
  ctx.restore();
}

function getWireLabelOffset(w){
  const off=(w&&w.labelOffset&&typeof w.labelOffset==='object')?w.labelOffset:null;
  return {
    x:off&&Number.isFinite(off.x)?off.x:0,
    y:off&&Number.isFinite(off.y)?off.y:0
  };
}

function getWireLabelAnchor(w, ptsArg){
  const pts=ptsArg||getWirePts(w);
  const base=getWireLabelPoint(w,pts);
  if(!base) return null;
  const off=getWireLabelOffset(w);
  return {x:base.x+off.x,y:base.y+off.y};
}

function getWireLabelBounds(w, ptsArg){
  if(!w.label || !w.label.trim()) return null;
  const pts=ptsArg||getWirePts(w);
  if(!pts || pts.length<2) return null;
  const anchor=getWireLabelAnchor(w,pts);
  if(!anchor) return null;
  ctx.save();
  ctx.font='bold 9px "JetBrains Mono",monospace';
  const tw=ctx.measureText(w.label).width;
  ctx.restore();
  const h=16;
  const wbg=tw+14;
  return {x:anchor.x-wbg/2,y:anchor.y-h/2,w:wbg,h,cx:anchor.x,cy:anchor.y};
}

function hitWireLabel(w, wx, wy){
  const b=getWireLabelBounds(w);
  if(!b) return false;
  return wx>=b.x && wx<=b.x+b.w && wy>=b.y && wy<=b.y+b.h;
}

function findTopWireLabelHit(wx, wy){
  for(let i=wires.length-1;i>=0;i--){
    if(hitWireLabel(wires[i],wx,wy)) return wires[i];
  }
  return null;
}

function resolvePortPoint(b, port){
  if(!port||!port.side)return null;
  const off=Math.max(0,Math.min(1,port.offset===undefined?0.5:port.offset));
  if(port.side==='top') return {x:b.x+b.w*off,y:b.y};
  if(port.side==='right') return {x:b.x+b.w,y:b.y+b.h*off};
  if(port.side==='bottom') return {x:b.x+b.w*off,y:b.y+b.h};
  if(port.side==='left') return {x:b.x,y:b.y+b.h*off};
  return null;
}

function inferFacingPort(b, tx, ty){
  const cx=b.x+b.w/2, cy=b.y+b.h/2;
  const dx=tx-cx, dy=ty-cy;
  const hw=Math.max(1,b.w/2), hh=Math.max(1,b.h/2);
  if(Math.abs(dx)/hw > Math.abs(dy)/hh){
    return {side:dx>=0?'right':'left',offset:0.5};
  }
  return {side:dy>=0?'bottom':'top',offset:0.5};
}

function nearestPortOnBox(b, wx, wy){
  const candidates=[
    {side:'top',offset:0.5},
    {side:'right',offset:0.5},
    {side:'bottom',offset:0.5},
    {side:'left',offset:0.5},
  ];
  let best=null, bestDist=Infinity;
  candidates.forEach(p=>{
    const pt=resolvePortPoint(b,p);
    const d=Math.hypot(wx-pt.x,wy-pt.y);
    if(d<bestDist){bestDist=d;best=p;}
  });
  return {port:best,dist:bestDist};
}

function updateWireHover(wx, wy){
  if(mode!=='wire'){ wireHover=null; return; }
  let hit=null;
  for(let i=boxes.length-1;i>=0;i--){
    if(hitBox(boxes[i],wx,wy)){ hit=boxes[i]; break; }
  }
  if(!hit){ wireHover=null; return; }
  const near=nearestPortOnBox(hit,wx,wy);
  if(!near.port){ wireHover=null; return; }
  wireHover={boxId:hit.id,port:near.port,dist:near.dist};
}

function drawWirePortHints(){
  if(mode!=='wire'||!wireHover) return;
  const b=boxes.find(x=>x.id===wireHover.boxId);
  if(!b) return;
  const ports=[
    {side:'top',offset:0.5},
    {side:'right',offset:0.5},
    {side:'bottom',offset:0.5},
    {side:'left',offset:0.5},
  ];
  ports.forEach(p=>{
    const pt=resolvePortPoint(b,p);
    const active = wireHover.port && wireHover.port.side===p.side;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pt.x,pt.y,active?5/scale:3.5/scale,0,Math.PI*2);
    ctx.fillStyle=active?'#00d4aa':'rgba(108,99,255,0.85)';
    ctx.strokeStyle='#ffffff';
    ctx.lineWidth=1.2/scale;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}

function getEdgePoint(b,tx,ty){
  const cx=b.x+b.w/2, cy=b.y+b.h/2;
  const dx=tx-cx, dy=ty-cy;
  if(Math.abs(dx)<1&&Math.abs(dy)<1) return {x:cx,y:b.y};
  const absDx=Math.abs(dx), absDy=Math.abs(dy);
  const hw=b.w/2, hh=b.h/2;
  if(absDx/hw>absDy/hh){
    return dx>0?{x:b.x+b.w,y:cy}:{x:b.x,y:cy};
  } else {
    return dy>0?{x:cx,y:b.y+b.h}:{x:cx,y:b.y};
  }
}

function getWirePts(w){
  let x1=w.x1,y1=w.y1,x2=w.x2,y2=w.y2;
  const fromBox=w.fromId?boxes.find(b=>b.id===w.fromId):null;
  const toBox=w.toId?boxes.find(b=>b.id===w.toId):null;
  if(fromBox&&toBox){
    const fc={x:fromBox.x+fromBox.w/2,y:fromBox.y+fromBox.h/2};
    const tc={x:toBox.x+toBox.w/2,y:toBox.y+toBox.h/2};
    const ep1=resolvePortPoint(fromBox,w.fromPort)||getEdgePoint(fromBox,tc.x,tc.y);
    const ep2=resolvePortPoint(toBox,w.toPort)||getEdgePoint(toBox,fc.x,fc.y);
    x1=ep1.x;y1=ep1.y; x2=ep2.x;y2=ep2.y;
  } else if(fromBox){
    const ep=resolvePortPoint(fromBox,w.fromPort)||getEdgePoint(fromBox,x2,y2);
    x1=ep.x;y1=ep.y;
  } else if(toBox){
    const ep=resolvePortPoint(toBox,w.toPort)||getEdgePoint(toBox,x1,y1);
    x2=ep.x;y2=ep.y;
  }
  const laneOffset=getWireBundleOffset(w);
  if(w.route==='ortho'){
    const mx=(x1+x2)/2 + laneOffset;
    return [{x:x1,y:y1},{x:mx,y:y1},{x:mx,y:y2},{x:x2,y:y2}];
  }
  if(w.route==='straight'&&Math.abs(laneOffset)>0.001){
    const dx=x2-x1, dy=y2-y1;
    const len=Math.hypot(dx,dy);
    if(len>0.001){
      const nx=-dy/len, ny=dx/len;
      const mx=(x1+x2)/2 + nx*laneOffset;
      const my=(y1+y2)/2 + ny*laneOffset;
      return [{x:x1,y:y1},{x:mx,y:my},{x:x2,y:y2}];
    }
  }
  return [{x:x1,y:y1},{x:x2,y:y2}];
}

function getWireBundleKey(w){
  const a=w.fromId?('b:'+w.fromId):('p:'+Math.round((w.x1||0)/20)+','+Math.round((w.y1||0)/20));
  const b=w.toId?('b:'+w.toId):('p:'+Math.round((w.x2||0)/20)+','+Math.round((w.y2||0)/20));
  const ends=[a,b].sort();
  return ends[0]+'|'+ends[1]+'|'+(w.route||'straight');
}

function getWireBundleOffset(w){
  const key=getWireBundleKey(w);
  const peers=wires.filter(x=>getWireBundleKey(x)===key).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  if(peers.length<=1) return 0;
  const idx=peers.findIndex(x=>x.id===w.id);
  if(idx<0) return 0;
  const mid=(peers.length-1)/2;
  return (idx-mid)*(WIRE_BUNDLE_STEP_PX*WIRE_BUNDLE_OFFSET_FACTOR);
}

function drawArr(from,to,color,lw){
  if(!from||!to)return;
  const angle=Math.atan2(to.y-from.y,to.x-from.x);
  const size=Math.max(7,lw*3.5);
  ctx.save(); ctx.setLineDash([]); ctx.fillStyle=color;
  ctx.beginPath(); ctx.translate(to.x,to.y); ctx.rotate(angle);
  ctx.moveTo(0,0); ctx.lineTo(-size,-size/2.2); ctx.lineTo(-size,size/2.2);
  ctx.closePath(); ctx.fill(); ctx.restore();
}

// ── HIT TEST ──
function hitBox(b,wx,wy){
  if(b.shape==='circle'){
    const r=Math.min(b.w,b.h)/2, dx=wx-(b.x+b.w/2), dy=wy-(b.y+b.h/2);
    return dx*dx+dy*dy<=r*r;
  }
  return wx>=b.x&&wx<=b.x+b.w&&wy>=b.y&&wy<=b.y+b.h;
}
function hitWire(w,wx,wy){
  const pts=getWirePts(w);
  for(let i=0;i<pts.length-1;i++){
    if(distSeg(wx,wy,pts[i].x,pts[i].y,pts[i+1].x,pts[i+1].y)<8)return true;
  }
  return false;
}
function distSeg(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
  if(len2===0)return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}

// ── ALIGNMENT GUIDES ──
function calcAlignGuides(draggedIds, wx, wy){
  alignGuides=[];
  const dragged=boxes.filter(b=>draggedIds.has(b.id));
  const others=boxes.filter(b=>!draggedIds.has(b.id));
  if(!dragged.length||!others.length)return;
  const THRESH=6;
  dragged.forEach(db=>{
    const dCx=db.x+db.w/2, dCy=db.y+db.h/2;
    others.forEach(ob=>{
      const oCx=ob.x+ob.w/2, oCy=ob.y+ob.h/2;
      // Horizontal center
      if(Math.abs(dCy-oCy)<THRESH) alignGuides.push({dir:'h',pos:oCy,min:Math.min(db.x,ob.x)-20,max:Math.max(db.x+db.w,ob.x+ob.w)+20});
      // Vertical center
      if(Math.abs(dCx-oCx)<THRESH) alignGuides.push({dir:'v',pos:oCx,min:Math.min(db.y,ob.y)-20,max:Math.max(db.y+db.h,ob.y+ob.h)+20});
      // Top - top
      if(Math.abs(db.y-ob.y)<THRESH) alignGuides.push({dir:'h',pos:ob.y,min:Math.min(db.x,ob.x)-20,max:Math.max(db.x+db.w,ob.x+ob.w)+20});
      // Bottom - bottom
      if(Math.abs(db.y+db.h-ob.y-ob.h)<THRESH) alignGuides.push({dir:'h',pos:ob.y+ob.h,min:Math.min(db.x,ob.x)-20,max:Math.max(db.x+db.w,ob.x+ob.w)+20});
      // Left - left
      if(Math.abs(db.x-ob.x)<THRESH) alignGuides.push({dir:'v',pos:ob.x,min:Math.min(db.y,ob.y)-20,max:Math.max(db.y+db.h,ob.y+ob.h)+20});
      // Right - right
      if(Math.abs(db.x+db.w-ob.x-ob.w)<THRESH) alignGuides.push({dir:'v',pos:ob.x+ob.w,min:Math.min(db.y,ob.y)-20,max:Math.max(db.y+db.h,ob.y+ob.h)+20});
    });
  });
}

// ── MINIMAP ──
function drawMinimap(){
  const mc=document.getElementById('minimap-canvas');
  if(!mc)return;
  const mctx=mc.getContext('2d');
  const mw=mc.width=170, mh=mc.height=120;
  mctx.clearRect(0,0,mw,mh);
  mctx.fillStyle=canvasBg; mctx.fillRect(0,0,mw,mh);
  if(!boxes.length)return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  boxes.forEach(b=>{minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);maxX=Math.max(maxX,b.x+b.w);maxY=Math.max(maxY,b.y+b.h);});
  const pad=20, rw=maxX-minX+pad*2, rh=maxY-minY+pad*2;
  const s=Math.min(mw/rw,mh/rh);
  const ox=(mw-rw*s)/2-minX*s+pad*s, oy=(mh-rh*s)/2-minY*s+pad*s;
  mctx.save(); mctx.translate(ox,oy); mctx.scale(s,s);
  wires.forEach(w=>{
    const pts=getWirePts(w);
    if(pts.length<2)return;
    mctx.strokeStyle=w.color||'#d32f2f'; mctx.lineWidth=Math.max(1,w.width||1.5);
    mctx.beginPath(); mctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++)mctx.lineTo(pts[i].x,pts[i].y);
    mctx.stroke();
  });
  boxes.forEach(b=>{
    mctx.fillStyle=b.fill||'#e3f2fd'; mctx.strokeStyle=b.stroke||'#1565c0'; mctx.lineWidth=1;
    mctx.beginPath(); mctx.roundRect(b.x,b.y,b.w,b.h,Math.min(b.r||4,b.w/2,b.h/2)); mctx.fill(); mctx.stroke();
  });
  mctx.restore();
  // Viewport rect
  const vx=(-pan.x/scale), vy=(-pan.y/scale), vw=canvas.width/scale, vh=canvas.height/scale;
  mctx.save(); mctx.translate(ox,oy); mctx.scale(s,s);
  mctx.strokeStyle='rgba(108,99,255,0.8)'; mctx.lineWidth=2/s;
  mctx.fillStyle='rgba(108,99,255,0.1)';
  mctx.beginPath(); mctx.rect(vx,vy,vw,vh); mctx.fill(); mctx.stroke();
  mctx.restore();
}
