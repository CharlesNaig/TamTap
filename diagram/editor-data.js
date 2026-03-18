// ════════════════════════════════════════════════════════════
//  TamTap Diagram Editor — Default TamTap Diagram Data
// ════════════════════════════════════════════════════════════

function loadTamTap(){
  pushUndo();
  canvasBg='#ffffff';
  document.getElementById('g-bg').value='#ffffff';
  gridMode='dots';
  document.getElementById('g-grid').value='dots';

  boxes=[
    {id:'encl',label:'White box enclosure',sub:'all components inside',x:20,y:10,w:740,h:840,r:12,fill:'rgba(245,245,245,0.4)',stroke:'#bdbdbd',textColor:'#9e9e9e',fontSize:10,fontWeight:'normal',strokeWidth:1,shape:'rect',dash:'dashed',opacity:1},
    {id:'front',label:'Front panel',sub:'user-facing side',x:30,y:20,w:150,h:820,r:8,fill:'rgba(240,240,240,0.5)',stroke:'#cccccc',textColor:'#9e9e9e',fontSize:9,fontWeight:'normal',strokeWidth:0.8,shape:'rect',dash:'dashed',opacity:1},
    {id:'cam',label:'Pi Camera v2',sub:'CSI ribbon · 5MP',x:50,y:40,w:110,h:52,r:6,fill:'#e3f2fd',stroke:'#1565c0',textColor:'#0d47a1',fontSize:10,fontWeight:'bold',strokeWidth:1.8,shape:'rect',dash:'solid',opacity:1},
    {id:'lcd',label:'I2C LCD 16×2',sub:'0x27 · SDA SCL 5V GND',x:40,y:120,w:130,h:52,r:5,fill:'#e0f2f1',stroke:'#00695c',textColor:'#004d40',fontSize:10,fontWeight:'bold',strokeWidth:1.8,shape:'rect',dash:'solid',opacity:1},
    {id:'rled',label:'Red LED',sub:'GPIO 27 · fail',x:45,y:520,w:60,h:60,r:30,fill:'#ffebee',stroke:'#c62828',textColor:'#b71c1c',fontSize:9,fontWeight:'bold',strokeWidth:2,shape:'circle',dash:'solid',opacity:1},
    {id:'gled',label:'Green LED',sub:'GPIO 17 · ok',x:80,y:520,w:60,h:60,r:30,fill:'#e8f5e9',stroke:'#2e7d32',textColor:'#1b5e20',fontSize:9,fontWeight:'bold',strokeWidth:2,shape:'circle',dash:'solid',opacity:1},
    {id:'rc522',label:'RC522 RFID',sub:'SPI · GPIO 8-11,25 · 3.3V',x:38,y:640,w:124,h:100,r:5,fill:'#e8eaf6',stroke:'#283593',textColor:'#1a237e',fontSize:9,fontWeight:'bold',strokeWidth:1.8,shape:'rect',dash:'solid',opacity:1},
    {id:'pi',label:'Raspberry Pi 4B · 4GB RAM',sub:'tamtap.py · server.js · MongoDB',x:220,y:40,w:380,h:80,r:8,fill:'#e8f5e9',stroke:'#2e7d32',textColor:'#1b5e20',fontSize:12,fontWeight:'bold',strokeWidth:2.2,shape:'rect',dash:'solid',opacity:1},
    {id:'ups',label:'UPS 18650 Battery (dual)',sub:'5V uninterruptible power',x:260,y:160,w:300,h:48,r:6,fill:'#fff8e1',stroke:'#f57f17',textColor:'#e65100',fontSize:10,fontWeight:'bold',strokeWidth:1.8,shape:'rect',dash:'solid',opacity:1},
    {id:'fan',label:'Brushless Fan',sub:'5V · cooling',x:630,y:40,w:120,h:52,r:6,fill:'#eceff1',stroke:'#546e7a',textColor:'#263238',fontSize:10,fontWeight:'bold',strokeWidth:1.5,shape:'rect',dash:'solid',opacity:1},
    {id:'bb',label:'Breadboard + GPIO T-Type Extender',sub:'40-pin breakout · SPI I2C GPIO rails',x:230,y:250,w:300,h:380,r:8,fill:'#f3e5f5',stroke:'#6a1b9a',textColor:'#4a148c',fontSize:10,fontWeight:'bold',strokeWidth:2,shape:'rect',dash:'solid',opacity:1},
    {id:'rail5v',label:'5V Power Rail',sub:'VCC bus',x:240,y:266,w:130,h:22,r:3,fill:'#ffcdd2',stroke:'#c62828',textColor:'#b71c1c',fontSize:8,fontWeight:'bold',strokeWidth:1,shape:'rect',dash:'solid',opacity:1},
    {id:'rail33',label:'3.3V Rail',sub:'3V3 bus',x:390,y:266,w:120,h:22,r:3,fill:'#fff9c4',stroke:'#f57f17',textColor:'#e65100',fontSize:8,fontWeight:'bold',strokeWidth:1,shape:'rect',dash:'solid',opacity:1},
    {id:'gnd',label:'GND Rail',sub:'common ground',x:240,y:596,w:280,h:22,r:3,fill:'#263238',stroke:'#212121',textColor:'#b0bec5',fontSize:8,fontWeight:'bold',strokeWidth:1,shape:'rect',dash:'solid',opacity:1},
    {id:'stop',label:'STOP',sub:'GPIO 13',x:260,y:360,w:64,h:64,r:32,fill:'#ffebee',stroke:'#c62828',textColor:'#b71c1c',fontSize:9,fontWeight:'bold',strokeWidth:2,shape:'circle',dash:'solid',opacity:1},
    {id:'rst',label:'RST',sub:'GPIO 6',x:348,y:360,w:64,h:64,r:32,fill:'#fff8e1',stroke:'#f57f17',textColor:'#e65100',fontSize:9,fontWeight:'bold',strokeWidth:2,shape:'circle',dash:'solid',opacity:1},
    {id:'start',label:'START',sub:'GPIO 5',x:436,y:360,w:64,h:64,r:32,fill:'#e8f5e9',stroke:'#2e7d32',textColor:'#1b5e20',fontSize:9,fontWeight:'bold',strokeWidth:2,shape:'circle',dash:'solid',opacity:1},
    {id:'relay',label:'Relay module',sub:'GPIO 18 · 5V · GND',x:230,y:680,w:140,h:48,r:5,fill:'#fff3e0',stroke:'#e65100',textColor:'#bf360c',fontSize:10,fontWeight:'bold',strokeWidth:1.5,shape:'rect',dash:'solid',opacity:1},
    {id:'buzz',label:'Buzzer',sub:'via relay · 5V · GND',x:390,y:680,w:130,h:48,r:5,fill:'#fbe9e7',stroke:'#bf360c',textColor:'#b71c1c',fontSize:10,fontWeight:'bold',strokeWidth:1.5,shape:'rect',dash:'solid',opacity:1},
  ];

  wires=[
    {id:'w_csi',fromId:'cam',toId:'pi',x1:105,y1:66,x2:300,y2:80,color:'#546e7a',width:4,style:'solid',route:'ortho',arrow:'end',label:'CSI ribbon'},
    {id:'w_fan',fromId:'fan',toId:'pi',x1:690,y1:66,x2:600,y2:80,color:'#d32f2f',width:1.5,style:'dashed',route:'ortho',arrow:'none',label:'5V'},
    {id:'w_ups_pwr',fromId:'pi',toId:'ups',x1:380,y1:120,x2:380,y2:160,color:'#d32f2f',width:2,style:'solid',route:'straight',arrow:'end',label:'5V'},
    {id:'w_pi_gnd',fromId:'pi',toId:'gnd',x1:340,y1:120,x2:340,y2:596,color:'#212121',width:1.5,style:'solid',route:'ortho',arrow:'end',label:'GND'},
    {id:'w_pi_5v',fromId:'ups',toId:'rail5v',x1:300,y1:184,x2:300,y2:266,color:'#d32f2f',width:2,style:'solid',route:'ortho',arrow:'end',label:'5V rail'},
    {id:'w_pi_33',fromId:'pi',toId:'rail33',x1:430,y1:120,x2:430,y2:266,color:'#f57f17',width:1.5,style:'solid',route:'ortho',arrow:'end',label:'3.3V'},
    {id:'w_gpio',fromId:'pi',toId:'bb',x1:250,y1:120,x2:280,y2:250,color:'#795548',width:5,style:'solid',route:'ortho',arrow:'end',label:'40-pin GPIO ribbon'},
    {id:'w_sda',fromId:'lcd',toId:'bb',x1:170,y1:140,x2:230,y2:310,color:'#388e3c',width:1.5,style:'solid',route:'ortho',arrow:'end',label:'SDA'},
    {id:'w_scl',fromId:'lcd',toId:'bb',x1:170,y1:148,x2:230,y2:320,color:'#f9a825',width:1.5,style:'solid',route:'ortho',arrow:'end',label:'SCL'},
    {id:'w_lcd_vcc',fromId:'rail5v',toId:'lcd',x1:305,y1:266,x2:170,y2:160,color:'#d32f2f',width:1,style:'dashed',route:'ortho',arrow:'end',label:'5V'},
    {id:'w_lcd_gnd',fromId:'gnd',toId:'lcd',x1:250,y1:596,x2:170,y2:168,color:'#212121',width:1,style:'dashed',route:'ortho',arrow:'none',label:'GND'},
    {id:'w_mosi',fromId:'rc522',toId:'bb',x1:162,y1:668,x2:230,y2:440,color:'#e65100',width:1.5,style:'solid',route:'ortho',arrow:'end',label:'MOSI GPIO10'},
    {id:'w_miso',fromId:'rc522',toId:'bb',x1:162,y1:676,x2:230,y2:450,color:'#1565c0',width:1.5,style:'solid',route:'ortho',arrow:'end',label:'MISO GPIO9'},
    {id:'w_sck',fromId:'rc522',toId:'bb',x1:162,y1:684,x2:230,y2:460,color:'#f9a825',width:1.5,style:'solid',route:'ortho',arrow:'end',label:'SCK GPIO11'},
    {id:'w_cs',fromId:'rc522',toId:'bb',x1:162,y1:692,x2:230,y2:470,color:'#388e3c',width:1.5,style:'solid',route:'ortho',arrow:'end',label:'CS GPIO8'},
    {id:'w_rst_pin',fromId:'rc522',toId:'bb',x1:162,y1:700,x2:230,y2:480,color:'#6a1b9a',width:1.5,style:'solid',route:'ortho',arrow:'end',label:'RST GPIO25'},
    {id:'w_rc_vcc',fromId:'rail33',toId:'rc522',x1:400,y1:266,x2:162,y2:656,color:'#f57f17',width:1,style:'dashed',route:'ortho',arrow:'end',label:'3.3V'},
    {id:'w_rc_gnd',fromId:'gnd',toId:'rc522',x1:260,y1:596,x2:162,y2:714,color:'#212121',width:1,style:'dashed',route:'ortho',arrow:'none',label:'GND'},
    {id:'w_gled',fromId:'bb',toId:'gled',x1:450,y1:420,x2:110,y2:550,color:'#388e3c',width:1.8,style:'solid',route:'ortho',arrow:'end',label:'GPIO 17'},
    {id:'w_rled',fromId:'bb',toId:'rled',x1:240,y1:430,x2:75,y2:550,color:'#d32f2f',width:1.8,style:'solid',route:'ortho',arrow:'end',label:'GPIO 27'},
    {id:'w_led_gnd',fromId:'gnd',toId:'rled',x1:250,y1:618,x2:75,y2:580,color:'#212121',width:1,style:'dashed',route:'ortho',arrow:'none',label:'GND'},
    {id:'w_relay_sig',fromId:'bb',toId:'relay',x1:310,y1:630,x2:300,y2:680,color:'#e65100',width:1.8,style:'solid',route:'straight',arrow:'end',label:'GPIO 18'},
    {id:'w_relay_out',fromId:'relay',toId:'buzz',x1:370,y1:704,x2:390,y2:704,color:'#e65100',width:2.5,style:'solid',route:'straight',arrow:'end',label:'relay out'},
    {id:'w_buzz_gnd',fromId:'gnd',toId:'buzz',x1:430,y1:618,x2:455,y2:680,color:'#212121',width:1,style:'dashed',route:'ortho',arrow:'none',label:'GND'},
    {id:'w_relay_vcc',fromId:'rail5v',toId:'relay',x1:340,y1:288,x2:300,y2:680,color:'#d32f2f',width:1,style:'dashed',route:'ortho',arrow:'end',label:'5V'},
  ];

  groups=[];
  selectedIds.clear(); selectedWireIds.clear();
  syncIdCounter(); validateWires(); autoSaveLocal(); updatePanel(); redraw(); resetView(); markSaved();
  toast('TamTap full diagram loaded!','ok');
}
