// @ts-nocheck
// Simulator 5.5 UI, unchanged in look and behavior, now driven by the engine in src/engine.
// (Type-checking is off for this file; it is the original untyped UI code. The engine is fully typed.)
import { SimEngine, catalog, mechanical, j1939, buildBits, SUPPLY_GROUP, ROUTE_3D, TYPE_OF as ENGINE_TYPE_OF } from '../engine';

// ===================== helpers =====================
const $=id=>document.getElementById(id);
const svgNS='http://www.w3.org/2000/svg';
function el(tag,attrs,parent){const e=document.createElementNS(svgNS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
function tx(p,x,y,s,a){const t=el('text',Object.assign({x,y},a||{}),p);t.textContent=s;return t;}
const hex=(n,w)=>(n>>>0).toString(16).toUpperCase().padStart(w,'0');
const bin=(n,w)=>(n>>>0).toString(2).padStart(w,'0');
const rnd=a=>(Math.random()-.5)*a;
const le16=v=>[v&255,(v>>8)&255];
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');

// ===================== engine =====================
// Everything below that used to simulate the truck now asks the shared engine (src/engine).
// This file only draws: it reads engine state, module memories, bus frames and tool results,
// and turns clicks into engine actions.
const FMI=catalog.FMI;
const ECUS=structuredClone(catalog.ECUS);
const SA2ECU=catalog.SA2ECU;
const C=catalog.C.map(c=>({...c}));
const NETF=catalog.NETF;
const MCHK=mechanical.MCHK,MFAULT=mechanical.MFAULT;
const lampByte=j1939.lampByte,dtcBytes=j1939.dtcBytes;
const SEED=Math.floor(Date.now()%1e9);
let eng=new SimEngine({seed:SEED});
window.simEngine=eng;

// ===================== state =====================
// UI-only state. Truck state, faults and DTCs live in the engine; the getters below are read-only views.
const S={paused:false,speed:1,sel:null,selMon:null,toolLog:[],curTab:'faults',scanTab:'faults',scanSel:null,scanSig:'',cutout:null,regen:null,quiz:null,quizMsg:'',prevShown:false,dm2:[],scanFF:null,focus:null};
const CTRL={get key(){return eng.state.key},get mph(){return eng.state.driver.setMph},get load(){return eng.state.driver.load},get road(){return eng.state.driver.road},get brake(){return eng.state.driver.brake}};
const MODKEYS=['ecm','acm','tcm','abs','clu'];
function ffView(ff,setAt){return ff?{rpm:ff.rpm,mph:ff.mph,ectC:ff.coolantC,oilKpa:ff.oilKpa,boostKpa:ff.boostKpa,load:ff.loadPct,batt:ff.batteryV,t:ff.tSec*1000}:undefined;}
function dtcLegacy(d){
  const net=d.cid==='net';
  let fkey;if(!net){const p=eng.presetOn(d.cid);const c=C.find(x=>x.id===d.cid);const pf=p&&c&&c.faults.find(f=>f.key===p);fkey=pf&&pf.fmi===d.fmi?p:(c&&(c.faults.find(f=>f.fmi===d.fmi)||{}).key);}
  return{spn:d.spn,fmi:d.fmi,cid:net?undefined:d.cid,netKey:net?(eng.presetOn('net')||'noterm'):undefined,fkey,status:d.status==='previous'?'inactive':d.status,oc:d.oc,lamps:d.lamps,ff:ffView(d.freezeFrame)};
}
function dtcView(which){const o={tool:[]};for(const e of MODKEYS){const m=eng.module(e);o[e]=(which==='previous'?m.dtcs('previous'):m.dtcs('pending').concat(m.dtcs('active'))).map(dtcLegacy);}return o;}
Object.defineProperties(S,{
  t:{get:()=>eng.timeMs},
  mphAct:{get:()=>eng.state.speedMph},
  net:{get:()=>eng.presetOn('net')||'none'},
  termOut:{get:()=>{const h=eng.electrical.harness.terminators;return{L:!h.L,R:!h.R};}},
  faults:{get:()=>{const o={};for(const c of C){const k=eng.presetOn(c.id);if(k)o[c.id]=k;}return o;}},
  dtc:{get:()=>dtcView('current')},
  prev:{get:()=>dtcView('previous')},
  v:{get:()=>values()},
  ctrl:{get:()=>CTRL},
});
let tab='ecm';

function setFault(cid,key){
  if(key&&key!=='none'){
    eng.dispatch({type:'applyPreset',cid,key});
    const c=C.find(x=>x.id===cid),f=c.faults.find(x=>x.key===key);
    S.sel={ecu:c.ecu,spn:c.spn,fmi:f.fmi,cid,fkey:key};
  }else eng.dispatch({type:'clearPreset',cid});
  refreshAll();renderExplain();
}
function setNet(key){
  if(key&&key!=='none'){eng.dispatch({type:'applyPreset',cid:'net',key});S.sel={ecu:'net',net:key};}
  else eng.dispatch({type:'clearPreset',cid:'net'});
  refreshAll();renderExplain();
}
const termCount=()=>{const h=eng.electrical.harness.terminators;return(h.L?1:0)+((h.R&&S.net!=='term')?1:0);};
const busDead=()=>eng.bus.health!=='ok';
function toggleTerm(side){const h=eng.electrical.harness.terminators;eng.dispatch({type:'setTerminator',side,installed:!h[side]});S.scanSig='';refreshAll();}
const onBus=ecu=>eng.state.key!=='off'&&!busDead()&&eng.electrical.busHealth().attached[ecu]!==false;

// ===================== vehicle values (view of the engine's truck state) =====================
const SUPPLY=SUPPLY_GROUP;
function F(cid){return S.faults[cid];}
function faultObj(cid){const k=F(cid);if(!k)return null;return C.find(c=>c.id===cid).faults.find(f=>f.key===k);}
function ownerOf(cid){return MODKEYS.find(e=>eng.module(e).owns(cid));}
function isErr(cid){const e=ownerOf(cid);return !!e&&eng.module(e).err(cid);}
function values(){
  const s=eng.state,o=eng.outputs;
  return{key:s.key,stalled:s.stalled,running:s.running,cap:Math.min(o.ecm.speedCapMph,o.acm.inducementCapMph),limp:o.ecm.limp,protect:o.ecm.protect,powerLoss:o.ecm.powerLoss,
    injBad:s.cylinderContribution.filter(x=>x<.5).length,mph:s.speedMph,kmh:s.speedMph*1.609344,gear:s.gear,ratio:s.gearRatio,oss:s.ossRpm,rpm:s.rpm,loadF:s.load,load:s.load*100,
    pedal:s.pedalPct,boostKpa:s.boostKpa,mafKgh:s.mafKgh,oilKpa:s.oilKpa,ectC:s.coolantC,imtC:s.intakeTempC,railMpa:s.railMpa,thr:s.throttlePct,egr:s.egrPct,vgt:s.vgtPct,
    fuelLph:s.fuelRateLph,kmpl:s.kmpl,batt:s.batteryV,def:s.defLevelPct,dpf:+s.dpfDeltaPKpa.toFixed(1),noxin:s.noxInPpm,noxout:s.noxOutPpm,totC:s.transOilC,
    airPri:s.airPrimaryPsi,airSec:s.airSecondaryPsi,ambC:s.ambientC,deftC:s.defTempC,iss:s.issRpm,fuel:Math.round(s.fuelLevelPct),fuelTank:Math.round(s.fuelLevelPct),
    absV:+eng.module('abs').input('abspwr').volts.toFixed(1),absOK:o.abs.absEnabled,braking:s.braking,absActive:s.absActive,lockup:s.lockup,wheels:s.wheelsKmh};
}
function pgnOf(id){return j1939.pgnOf(id);}

// ===================== bus monitor (rows come from the engine's message bus) =====================
const MON=new Map();
function monKey(m){return m.id.toString(16)+(m.seq?'-'+m.seq:'');}
function updateMonitor(){
  MON.clear();
  for(const r of eng.bus.rows()){
    const ecu=r.sa===249?'tool':(SA2ECU[r.sa]||'ecm');
    const period=r.period||999999;
    MON.set(r.key,{...r,ecu,last:r.t,period,sending:r.delivered&&(period>=999999||eng.timeMs-r.t<=Math.max(3000,period*4)),gone:false});
  }
  const load=busDead()||eng.state.key==='off'?0:eng.bus.loadPct();
  $('loadBar').style.width=Math.min(100,load)+'%';$('loadTxt').textContent=busDead()?'bus down':load.toFixed(1)+'%';
  renderMonitor();
}

function renderMonitor(){
  const tb=$('mon').tBodies[0];
  const rows=[...MON.values()].sort((a,b)=>(a.id>>>0)-(b.id>>>0)||(a.seq||0)-(b.seq||0));
  let h='';
  for(const r of rows){
    const stale=!r.sending||r.gone||(S.t-r.last>Math.max(3000,r.period*4)*1);
    const k=monKey(r);
    h+=`<tr data-k="${k}" class="${stale?'stale':''} ${S.selMon===k?'sel':''}"><td>${hex(r.id,8)}</td><td>${hex(r.id&255,2)}</td><td>${r.pgn}</td><td style="font-family:system-ui">${r.acr}${r.gone?' (ended)':''}</td><td>${r.bytes.length}</td><td>${r.bytes.map(b=>hex(b,2)).join(' ')}</td><td>${r.period>=999999?'on request':r.period>=1000?r.period/1000+' s':r.period+' ms'}</td><td>${r.count}</td></tr>`;
  }
  tb.innerHTML=h;
  if(S.selMon&&MON.get(S.selMon))renderDecoder(MON.get(S.selMon),false);
}
$('mon').addEventListener('click',e=>{const tr=e.target.closest('tr[data-k]');if(!tr)return;S.selMon=tr.dataset.k;renderMonitor();renderDecoder(MON.get(S.selMon),true);});

// ===================== CAN frame bits (for scope + bus load) =====================
function drawScope(m){
  const sc=$('scope');sc.innerHTML='';
  if(!m){return;}
  const bits=buildBits(m.id,m.bytes),n=bits.length,x0=60,x1=990,bw=(x1-x0)/n,vy=v=>130-(v-1)/3*100;
  const col={SOF:'#adb5bd',ID:'#ff922b',CTL:'#cc5de8',DATA:'#4dabf7',CRC:'#51cf66',ACK:'#fcc419',EOF:'#adb5bd'};
  const lab={SOF:'',ID:'29-bit ID (+SRR/IDE/RTR)',CTL:'Ctl',DATA:'Data',CRC:'CRC',ACK:'ACK',EOF:'EOF'};
  let i=0;while(i<n){let j=i;while(j<n&&bits[j].g===bits[i].g)j++;const x=x0+i*bw,w=(j-i)*bw;el('rect',{x,y:22,width:w,height:115,fill:col[bits[i].g],opacity:.13},sc);if(w>30)tx(sc,x+w/2,153,lab[bits[i].g],{'text-anchor':'middle','font-size':12,'font-weight':700,fill:col[bits[i].g]});i=j;}
  [[3.5,'3.5 V'],[2.5,'2.5 V'],[1.5,'1.5 V']].forEach(([v,l])=>{el('line',{x1:x0,x2:x1,y1:vy(v),y2:vy(v),stroke:'#2b3a48','stroke-dasharray':'4 4'},sc);tx(sc,6,vy(v)+4,l,{'font-size':11,fill:'#8aa0b3'});});
  let h='',l='';bits.forEach((b,k)=>{const xa=x0+k*bw,xb=xa+bw,d=b.v===0;h+=`${xa},${vy(d?3.5:2.5)} ${xb},${vy(d?3.5:2.5)} `;l+=`${xa},${vy(d?1.5:2.5)} ${xb},${vy(d?1.5:2.5)} `;
    if(b.stuff)el('circle',{cx:xa+bw/2,cy:16,r:2.2,fill:'#ff922b'},sc);});
  el('polyline',{points:h,fill:'none',stroke:'#e0b000','stroke-width':2},sc);
  el('polyline',{points:l,fill:'none',stroke:'#2f9e44','stroke-width':2},sc);
  tx(sc,990,12,`${n} bits incl. ${bits.filter(b=>b.stuff).length} stuff bits (orange dots) · ${(n*4)} µs at 250 kbit/s`,{'text-anchor':'end','font-size':11,fill:'#8aa0b3'});
}

// ===================== decoder =====================
function renderDecoder(m,scope){
  if(!m)return;
  const id=m.id,pri=(id>>26)&7,dp=(id>>24)&1,pf=(id>>16)&255,ps=(id>>8)&255,sa=id&255,pdu1=pf<240;
  let h=`<p style="margin:0 0 4px"><b>${m.acr}</b> · ${m.name} · from <b>${ECUS[m.ecu].name}</b> (SA ${sa})</p>`;
  h+=`<div class="idparts"><div class="idp">Priority<b>${pri}</b></div><div class="idp">DP<b>${dp}</b></div><div class="idp">PF<b>0x${hex(pf,2)} (${pf})</b></div><div class="idp">${pdu1?'PS = dest. addr':'PS = group ext.'}<b>0x${hex(ps,2)}</b></div><div class="idp">SA<b>0x${hex(sa,2)} (${sa})</b></div><div class="idp">PGN<b>${m.pgn} (0x${hex(m.pgn,4)})</b></div><div class="idp">Type<b>${pdu1?'PDU1 → '+(ps===255?'global':'address '+ps):'PDU2 broadcast'}</b></div></div>`;
  h+='<div class="bytes">';
  m.bytes.forEach((b,i)=>{const lab=(m.labels||[])[i]||'';const isHl=(m.hl||[]).includes(i);const err=!m.acr.startsWith('TP')&&!m.dm&&((b===0xFE&&isHl)||(isHl&&m.bytes[i+1]===0xFE&&b===0x00));
    h+=`<div class="byte${isHl?' hl':''}${b===0xFF&&!isHl?' na':''}${err?' err':''}"><div class="n">Byte ${i+1}</div><div class="h">${hex(b,2)}</div><div class="l">${esc(lab)}</div></div>`;});
  h+=`</div><p style="margin:4px 0"><b>Decoded:</b> ${m.decode}</p>`;
  if(m.dm||m.acr==='DM2')h+=dmExplainBytes(m.bytes);
  h+=`<p class="note">0xFF = not available. 0xFE (or 0xFE00 in a two-byte value) = <b>error indicator</b>: the sender knows its sensor is faulty, so receivers show dashes instead of a wrong value and may log FMI 19 (received network data in error).</p>`;
  $('decoder').innerHTML=h;
  if(scope)drawScope(m);
}
function dmExplainBytes(b){
  const lb=b[0];const lamp=(s,n)=>(lb>>s&3)===1?`<b>${n} ON</b>`:`${n} off`;
  let h=`<div class="box">Byte 1 = 0x${hex(lb,2)} = ${bin(lb,8)} → ${lamp(6,'MIL')} · ${lamp(4,'Red stop')} · ${lamp(2,'Amber warning')} · ${lamp(0,'Protect')}`;
  if(b.length>=6){const spn=b[2]|(b[3]<<8)|((b[4]>>5)<<16),fmi=b[4]&31,oc=b[5]&127;
    h+=`<br>Bytes 3–6: SPN = 0x${hex(b[2],2)} + 0x${hex(b[3],2)}×256 + ${(b[4]>>5)}×65536 = <b>${spn}</b> · FMI = byte 5 low 5 bits = <b>${fmi}</b> · OC = <b>${oc}</b>`;}
  return h+'</div>';
}

// ===================== diagram =====================
const net=$('net');
const POS={ecm:{x:40,y:128,w:420,h:60},acm:{x:600,y:128,w:330,h:60},tcm:{x:20,y:300,w:190,h:58},abs:{x:232,y:300,w:276,h:58},clu:{x:530,y:300,w:210,h:58},tool:{x:765,y:300,w:215,h:58}};
const BUS_H=240,BUS_L=252;
const PILLS={};
let packetLayer,netFx;
function layoutPills(){
  const P=(id,x,y,w)=>PILLS[id]={x,y,w,h:24};
  ['crank','cam','map','maf','oilp','ect','rail'].forEach((id,i)=>P(id,46+i*59,14,55));
  ['app','thr','egr','vgt','batt','sup1','sup2'].forEach((id,i)=>P(id,46+i*59,46,55));
  for(let i=1;i<=6;i++)P('inj'+i,46+(i-1)*59,80,55);
  P('noxin',610,48,152);P('noxout',770,48,152);P('def',610,80,152);P('dpf',770,80,152);P('deft',610,14,152);
  P('oss',28,378,174);P('tot',28,408,174);P('iss',28,438,174);
  P('wlf',240,378,128);P('wrf',372,378,128);P('wlr',240,408,128);P('wrr',372,408,128);P('abspwr',240,438,260);
  P('fuel',538,378,95);P('amb',637,378,95);P('airp',538,408,95);P('airs',637,408,95);
}
function buildDiagram(){
  layoutPills();net.innerHTML='';
  const grp=(x,y,w,h,label,lx,ly)=>{el('rect',{x,y,width:w,height:h,rx:10,fill:'#0b0b0e',stroke:'#26262c','stroke-dasharray':'4 3'},net);tx(net,lx,ly,label,{'font-size':10.5,fill:'#868e96','font-style':'italic'});};
  grp(40,6,420,104,'hardwired sensors & injectors',258,123);grp(600,6,330,104,'NOx = smart CAN sensors',773,123);
  grp(20,370,190,96,'hardwired',123,367);grp(232,370,276,96,'hardwired',378,367);grp(530,370,210,66,'hardwired',643,367);
  tx(net,872,380,'9-pin Deutsch: C = CAN-H,',{'text-anchor':'middle','font-size':11,fill:'#868e96'});tx(net,872,395,'D = CAN-L, E = shield',{'text-anchor':'middle','font-size':11,fill:'#868e96'});
  // harness lines
  const harn=(x1,y1,x2,y2)=>el('line',{x1,y1,x2,y2,stroke:'#3a3a42','stroke-width':6,'stroke-linecap':'round'},net);
  harn(250,110,250,128);harn(765,110,765,128);harn(115,358,115,370);harn(370,358,370,370);harn(635,358,635,370);
  // backbone stubs
  for(const k in POS){const p=POS[k],cx=p.x+p.w/2,top=p.y<BUS_H;
    const y=top?p.y+p.h:p.y;
    ECUS[k].stubH=el('line',{x1:cx-7,x2:cx-7,y1:y,y2:BUS_H,stroke:'#e0b000','stroke-width':2.5},net);
    ECUS[k].stubL=el('line',{x1:cx+7,x2:cx+7,y1:y,y2:BUS_L,stroke:'#2f9e44','stroke-width':2.5},net);
    ECUS[k].cx=cx;}
  el('line',{x1:20,x2:980,y1:BUS_H,y2:BUS_H,stroke:'#e0b000','stroke-width':4},net);
  el('line',{x1:20,x2:980,y1:BUS_L,y2:BUS_L,stroke:'#2f9e44','stroke-width':4},net);
  tx(net,30,BUS_H-6,'CAN-H',{'font-size':11,'font-weight':700,fill:'#e0b000'});tx(net,30,BUS_L+15,'CAN-L',{'font-size':11,'font-weight':700,fill:'#2f9e44'});
  tx(net,500,BUS_H-8,'J1939 backbone · 250 kbit/s · twisted pair',{'text-anchor':'middle','font-size':11.5,fill:'#868e96'});
  ECUS.termL=termRes(14,'L');ECUS.termR=termRes(986,'R');
  netFx=el('g',{},net);
  // ECU boxes
  for(const k in POS){const p=POS[k],e=ECUS[k];
    e.g=el('g',{},net);
    e.box=el('rect',{x:p.x,y:p.y,width:p.w,height:p.h,rx:2,fill:'#0b0b0e',stroke:e.color,'stroke-width':2.5},e.g);
    tx(e.g,p.x+12,p.y+22,e.name,{'font-size':14.5,'font-weight':700,fill:e.color});
    tx(e.g,p.x+12,p.y+40,`SA 0x${hex(e.sa,2)} (${e.sa})`,{'font-size':12,fill:'#8a8a93'});
    e.st=tx(e.g,p.x+p.w-10,p.y+40,'',{'text-anchor':'end','font-size':12,'font-weight':700,fill:'#2b8a3e'});
    e.lampDot=el('circle',{cx:p.x+p.w-14,cy:p.y+16,r:6,fill:'#2a2a30'},e.g);
  }
  // pills
  C.forEach(c=>{const p=PILLS[c.id];if(!p)return;
    const g=el('g',{class:'pill'},net);g.addEventListener('click',()=>{tab=c.ecu;S.focus=c.id;renderTabs();renderFaultPanel();const r=document.querySelector(`[data-cid="${c.id}"]`);showTab('faults');if(r)r.scrollIntoView({block:'center',behavior:'smooth'});});
    c.r=el('rect',{x:p.x,y:p.y,width:p.w,height:p.h,rx:2,fill:'#101014',stroke:ECUS[c.ecu].color,'stroke-width':1.3},g);
    c.t=tx(g,p.x+p.w/2,p.y+16,c.label,{'text-anchor':'middle','font-size':c.ecu==='ecm'?10:11,'font-weight':600,fill:'#d9d9de'});
    const ti=el('title',{},g);ti.textContent=`${c.name} · SPN ${c.spn} · click to inject a fault`;
  });
  packetLayer=el('g',{},net);
}
function termRes(x,side){const g=el('g',{style:'cursor:pointer'},net);const ti=el('title',{},g);ti.textContent='Click to remove or reinstall this 120 Ω terminating resistor';g.addEventListener('click',()=>toggleTerm(side));el('rect',{x:x-14,y:BUS_H-10,width:28,height:BUS_L-BUS_H+40,fill:'transparent'},g);el('rect',{x:x-8,y:BUS_H-6,width:16,height:BUS_L-BUS_H+12,rx:1,fill:'#000',stroke:'#aaa','stroke-width':1.5},g);el('path',{d:`M${x} ${BUS_H-4} l3 3 l-6 3 l6 3 l-6 3 l3 3`,fill:'none',stroke:'#aaa','stroke-width':1.2},g);tx(g,x,BUS_L+24,'120Ω',{'text-anchor':'middle','font-size':10.5,'font-weight':600,fill:'#aaa'});return g;}
function renderDiagram(){
  // pills
  C.forEach(c=>{if(!c.r)return;const d=S.dtc[c.ecu].find(x=>x.cid===c.id);
    const st=d?d.status:null;
    c.r.setAttribute('fill',st==='active'?'#3a0d0d':st==='pending'?'#2b2205':'#101014');
    c.r.setAttribute('stroke',st?'#ff3b30':ECUS[c.ecu].color);c.r.setAttribute('stroke-width',st?2.4:1.3);
    c.t.textContent=(st==='active'?'⚠ ':'')+c.label;});
  // ECU status
  for(const k in POS){const e=ECUS[k];const act=S.dtc[k].filter(d=>d.status==='active');
    if(S.ctrl.key==='off'){e.st.textContent=k==='tool'?'no bus traffic':'asleep';e.st.setAttribute('fill','#8a8a93');e.lampDot.setAttribute('fill','#2a2a30');continue;}
    if(k==='tool'){e.st.textContent=busDead()?'NO COMM':'connected';e.st.setAttribute('fill',busDead()?'#e03131':'#69db7c');continue;}
    if(!onBus(k)){e.st.textContent='OFF BUS';e.st.setAttribute('fill','#e03131');}
    else{e.st.textContent=act.length?`${act.length} active DTC${act.length>1?'s':''}`:'no active DTCs';e.st.setAttribute('fill',act.length?'#ff6b6b':'#69db7c');}
    const lb=lampByte(act);e.lampDot.setAttribute('fill',lb&0x10?'#e03131':lb&0x44?'#f5a623':'#2a2a30');}
  // network fx
  netFx.innerHTML='';
  const rOut=S.net==='term'||S.termOut.R;
  ECUS.termL.setAttribute('opacity',S.termOut.L?0.15:1);ECUS.termR.setAttribute('opacity',rOut?0.15:1);
  if(S.termOut.L)tx(netFx,14,BUS_H-14,'✕',{'text-anchor':'middle','font-size':20,'font-weight':800,fill:'#e03131'});
  if(rOut)tx(netFx,986,BUS_H-14,'✕',{'text-anchor':'middle','font-size':20,'font-weight':800,fill:'#e03131'});
  if(termCount()===0){el('rect',{x:310,y:BUS_L+6,width:380,height:18,rx:3,fill:'#0b0b0e',stroke:'#e03131','stroke-width':1},netFx);}if(termCount()===0)tx(netFx,500,BUS_L+19,'no termination: bus signals reflect, frames corrupted',{'text-anchor':'middle','font-size':12,'font-weight':700,fill:'#e03131'});
  if(S.net==='hl'){el('path',{d:`M500 ${BUS_H-2} l-6 6 l8 0 l-6 8`,stroke:'#e03131','stroke-width':3.5,fill:'none'},netFx);tx(netFx,512,BUS_L+18,'H–L short',{'font-size':12,'font-weight':700,fill:'#e03131'});}
  if(S.net==='hg'){el('line',{x1:540,x2:540,y1:BUS_H,y2:BUS_H+38,stroke:'#e03131','stroke-width':3},netFx);[0,1,2].forEach(i=>el('line',{x1:540-12+i*4,x2:540+12-i*4,y1:BUS_H+38+i*5,y2:BUS_H+38+i*5,stroke:'#e03131','stroke-width':2.5},netFx));tx(netFx,550,BUS_H+30,'CAN-H to ground',{'font-size':12,'font-weight':700,fill:'#e03131'});}
  const tcmOpen=S.net==='tcm';ECUS.tcm.stubH.setAttribute('stroke-dasharray',tcmOpen?'6 6':'');ECUS.tcm.stubL.setAttribute('stroke-dasharray',tcmOpen?'6 6':'');
  if(tcmOpen)tx(netFx,ECUS.tcm.cx+16,BUS_L+30,'open',{'font-size':12,'font-weight':700,fill:'#e03131'});
}
// packets
let lastPkt=0;
function spawnPacket(){
  if(busDead()||S.ctrl.key==='off')return;
  const rows=[...MON.values()].filter(r=>r.sending&&!r.gone);if(!rows.length)return;
  // weight by rate, but cap
  const r=rows[Math.floor(Math.random()*rows.length)];
  const cx=ECUS[r.ecu].cx,col=ECUS[r.ecu].color;const y=(BUS_H+BUS_L)/2;
  const a=el('circle',{cx,cy:y,r:5,fill:r.acr.startsWith('DM')||r.acr.startsWith('TP')?'#e03131':col,stroke:'#fff','stroke-width':1.2},packetLayer);
  const b=el('circle',{cx,cy:y,r:5,fill:a.getAttribute('fill'),stroke:'#fff','stroke-width':1.2},packetLayer);
  const t0=performance.now(),dur=900;
  (function an(){const p=(performance.now()-t0)/dur;if(p>=1||S.paused){a.remove();b.remove();return;}
    a.setAttribute('cx',cx-(cx-25)*p);b.setAttribute('cx',cx+(975-cx)*p);a.setAttribute('opacity',1-p*.6);b.setAttribute('opacity',1-p*.6);requestAnimationFrame(an);})();
}

// ===================== fault panel =====================
const TABS=[['ecm','Engine ECM'],['acm','Aftertreatment'],['tcm','Transmission'],['abs','ABS'],['clu','Cluster'],['net','Network wiring']];
function renderTabs(){
  $('tabs').innerHTML=TABS.map(([k,n])=>`<button data-t="${k}" class="${tab===k?'on':''}" style="--c:${k==='net'?'#e0b000':ECUS[k].color}">${n}</button>`).join('');
}
$('tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-t]');if(!b)return;tab=b.dataset.t;renderTabs();renderFaultPanel();});
function qHas(cid){return !!(S.quiz&&(S.quiz.cid===cid||(S.quiz.cids&&S.quiz.cids.includes(cid))));}
function reading(c,v){
  if(qHas(c.id))return '<i class="muted">hidden: use the meter</i>';
  const f=faultObj(c.id);if(f)return `<span style="color:#c92a2a">${f.reading}</span>`;
  const V=(val,max)=>(0.5+4*Math.max(0,Math.min(1,val/max))).toFixed(2)+' V';
  switch(c.id){
    case'crank':return`${Math.round(v.rpm)} rpm · tooth pulses ≈ ${Math.round(v.rpm/60*60)} Hz (60-tooth wheel)`;
    case'cam':return v.rpm?'sync pulses OK':'no rotation';
    case'map':return`${V(v.boostKpa+101,400)} → ${(v.boostKpa*0.145).toFixed(1)} psi boost`;
    case'maf':return`${V(v.mafKgh,2000)} → ${v.mafKgh.toFixed(0)} kg/h`;
    case'oilp':return`${V(v.oilKpa,1000)} → ${(v.oilKpa*0.145).toFixed(0)} psi`;
    case'ect':return`≈ 0.8 V (NTC) → ${v.ectC} °C / ${Math.round(v.ectC*1.8+32)} °F`;
    case'rail':return`${V(v.railMpa,250)} → ${v.railMpa.toFixed(0)} MPa`;
    case'thr':return`${V(v.thr,100)} → ${v.thr.toFixed(0)}% open`;
    case'egr':return`${V(v.egr,100)} → ${v.egr.toFixed(0)}% open`;
    case'vgt':return`${V(v.vgt,100)} → ${v.vgt.toFixed(0)}% closed`;
    case'app':return`track 1 ${V(v.pedal,100)}, track 2 ≈ half of track 1 → ${v.pedal.toFixed(0)}%`;
    case'batt':return`${v.batt.toFixed(1)} V`;
    case'sup1':case'sup2':return v.key==='off'?'0 V (key off)':'5.00 V (ECM-regulated reference)';
    case'noxin':return`${v.noxin.toFixed(0)} ppm (sensor sends it over CAN)`;
    case'noxout':return`${v.noxout.toFixed(0)} ppm (sensor sends it over CAN)`;
    case'def':return`${v.def}%`;case'dpf':return`${v.dpf} kPa ΔP`;
    case'oss':return`${v.oss} rpm`;case'tot':return`${v.totC} °C`;
    case'abspwr':return`${v.absV} V`;case'fuel':return`${v.fuel}%`;
    case'airp':return`${V(v.airPri,150)} → ${v.airPri} psi`;case'airs':return`${V(v.airSec,150)} → ${v.airSec} psi`;
    case'amb':return`${v.ambC} °C / ${Math.round(v.ambC*1.8+32)} °F`;case'deft':return`${v.deftC} °C`;case'iss':return`${v.iss} rpm`;
  }
  if(c.cyl)return v.stalled?'not firing (engine stopped)':'firing, circuit OK';
  if(c.ecu==='abs')return`${(v.kmh).toFixed(0)} km/h · ≈ ${Math.round(v.kmh/3.6/3.2*100)} Hz (100-tooth ring)`;
  return'';
}
function statusBadge(c){
  const d=S.dtc[c.ecu].find(x=>x.cid===c.id);
  if(d)return d.status==='active'?`<span class="badge b-act" data-dtc="${c.ecu}:${d.spn}:${d.fmi}">ACTIVE ${d.spn}-${d.fmi}</span>`:'<span class="badge b-pend">detecting…</span>';
  const p=S.prev[c.ecu].find(x=>x.cid===c.id);
  if(p)return`<span class="badge b-prev" data-dtc="${c.ecu}:${p.spn}:${p.fmi}">inactive ${p.spn}-${p.fmi}</span>`;
  return'<span class="badge b-ok">OK</span>';
}
function renderFaultPanel(){
  const v=S.v||values();
  if(tab==='net'){
    $('faultPanel').innerHTML=`<p class="note" style="margin-top:0">Wiring faults on the backbone affect <b>every</b> module. Check the meter readings (panel 5) for each one.</p>`+
    NETF.map(n=>`<label style="display:block;padding:6px 4px;border-bottom:1px solid #eee"><input type="radio" name="netf" value="${n.key}" ${S.net===n.key&&!(S.quiz&&S.quiz.cid==='net')?'checked':''} ${S.quiz&&S.quiz.cid==='net'?'disabled':''}> ${n.label}</label>`).join('')+(S.quiz&&S.quiz.cid==='net'?'<p class="bad">A mystery wiring fault is active.</p>':'');
    {const b=(sd,nm)=>{const out=S.termOut[sd];return`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 4px;border-bottom:1px solid #eee"><span>${nm}: <b style="color:${out?'#e03131':'#2b8a3e'}">${out?'removed':'installed'}</b></span><button data-term="${sd}">${out?'Reinstall':'Remove'}</button></div>`;};
     const n=termCount();
     $('faultPanel').insertAdjacentHTML('beforeend',`<h4 style="margin:14px 0 4px">Terminating resistors (hands-on)</h4><p class="note" style="margin-top:0">Pull or reinstall a 120 Ω terminator, then measure C to D at the 9-pin with the key off. You can also click a terminator on the network diagram.</p>`+b('L','Terminator 1 (left end of backbone)')+b('R','Terminator 2 (right end of backbone)')+(S.net==='term'?'<p class="note">The wiring fault above also has terminator 2 missing.</p>':'')+(n===0?'<p class="bad">No termination: modules stop communicating and log SPN 639 FMI 2. Reinstall a terminator, then read the stored codes.</p>':''));
     document.querySelectorAll('button[data-term]').forEach(x=>x.onclick=()=>toggleTerm(x.dataset.term));}
    document.querySelectorAll('input[name=netf]').forEach(r=>r.onchange=()=>setNet(r.value));
    return;
  }
  const comps=C.filter(c=>c.ecu===tab);
  let h=`<table class="ftab"><tr><th>Component</th><th>SPN</th><th>Live reading</th><th>Fault</th><th>Status</th></tr>`;
  comps.forEach(c=>{
    h+=`<tr data-cid="${c.id}" class="${S.focus===c.id?'sel':''}"><td><b>${c.name}</b></td><td class="mono">${c.spn}</td><td style="font-size:12.5px" data-read="${c.id}">${reading(c,v)}</td>
    <td>${qHas(c.id)?'<select disabled><option>(hidden: mystery fault)</option></select>':''}<select data-fault="${c.id}" ${qHas(c.id)?'style="display:none"':''}><option value="none">— none —</option>${c.faults.map(f=>`<option value="${f.key}" ${S.faults[c.id]===f.key?'selected':''}>${f.label} (FMI ${f.fmi})</option>`).join('')}</select></td><td data-stat="${c.id}">${statusBadge(c)}</td></tr>`;
  });
  h+='</table>';
  $('faultPanel').innerHTML=h;
  document.querySelectorAll('select[data-fault]').forEach(s=>s.onchange=()=>setFault(s.dataset.fault,s.value));
}
function refreshPanelLive(){
  const v=S.v;if(!v||tab==='net')return;
  C.filter(c=>c.ecu===tab).forEach(c=>{const r=document.querySelector(`[data-read="${c.id}"]`);if(r)r.innerHTML=reading(c,v);const s=document.querySelector(`[data-stat="${c.id}"]`);if(s)s.innerHTML=statusBadge(c);});
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-dtc]');if(!b)return;const[ecu,spn,fmi]=b.dataset.dtc.split(':');S.sel={ecu,spn:+spn,fmi:+fmi};renderExplain();showTab('faults');});

// ===================== cluster =====================
const LAMPS=[['rsl','STOP','red'],['awl','CHECK','amb'],['mil','MIL','amb'],['pl','PROTECT','amb'],['abs','ABS','amb'],['regen','DPF','amb'],['def','DEF','amb'],['com','J1939','red'],['lowAir','LOW AIR','red'],['park','PARK','red']];
function renderCluster(){
  const v=S.v,dead=busDead(),off=S.ctrl.key==='off';
  const D=eng.module('clu').display();
  const st=off||!D?{}:D.lamps;
  $('lamps').innerHTML=LAMPS.map(([k,n,c])=>`<div class="lamp ${c} ${st[k]?'on':''} ${k==='rsl'&&st[k]?'blink':''}">${n}</div>`).join('');
  const g=(name,x,big)=>`<div class="g ${big?'big':''}"><div class="v ${x==='ERR'?'err':''}">${x==null?'--':x}</div><div class="n">${name}</div></div>`;
  const G=D?D.gauges:{};
  $('gauges').innerHTML=[g('rpm',G.rpm,1),g('mph',G.mph,1),g('gear',G.gear,1),g('coolant °F',G.coolantF),g('oil psi',G.oilPsi),g('boost psi',G.boostPsi),g('fuel %',G.fuelPct),g('DEF %',G.defPct),g('mpg',G.mpg),g('air pri psi',D?D.air.primaryPsi:null),g('air sec psi',D?D.air.secondaryPsi:null)].join('');
  let m='';
  if(off)m='<div class="muted">KEY OFF · CLUSTER DARK</div>';
  else{
    if(D&&D.noData.length>=4)m+='<div class="r">J1939 DATA LINK FAULT: NO DATA FROM ECM, TCM, ABS, ACM</div>';
    else if(D)D.noData.forEach(e=>m+=`<div class="r">NO DATA FROM ${ECUS[e].name.toUpperCase()} (SA ${ECUS[e].sa})</div>`);
    if(D&&D.lamps.lowAir)m+='<div class="r">LOW AIR PRESSURE · BUZZER</div>';
    if(v.lockup)m+='<div class="r">WHEEL LOCKUP: ABS DISABLED BY FAULT</div>';
    else if(v.absActive)m+='<div class="w">ABS ACTIVE · MODULATING BRAKES</div>';
    if(D)D.codes.forEach(d=>m+=`<div class="${d.red?'r':'w'}" data-dtc="${d.ecu}:${d.spn}:${d.fmi}" style="cursor:pointer">SA ${d.sa} ${ECUS[d.ecu].name.toUpperCase()} · SPN ${d.spn} FMI ${d.fmi} · OC ${d.oc}</div>`);
    if(!m)m='NO ACTIVE FAULTS';
  }
  $('msgc').innerHTML=m;
  $('cfoot').innerHTML=`<span>BATT ${off?'--':v.batt.toFixed(1)+' V'}</span><span>${S.ctrl.road.toUpperCase()} ROAD</span><span>${({bobtail:'BOBTAIL',loaded:'LOADED',grade:'6% GRADE'})[S.ctrl.load]}</span>`;
  const k=S.ctrl.key;let s;
  if(k==='off')s='KEY OFF · modules asleep · no J1939 traffic';
  else if(k==='on')s='KEY ON · ENGINE OFF · modules awake and broadcasting';
  else if(v.stalled)s='<span class="r">ENGINE STALLED · lost both crank and cam signals</span>';
  else{
    s=`ENGINE RUNNING · ${v.mph.toFixed(0)} mph · ${v.gear?'gear '+v.gear:'neutral'} · ${Math.round(v.rpm)} rpm · load ${Math.round(v.load)}%`;
    const fl=[];
    if(v.braking)fl.push(v.lockup?'<span class="r">BRAKING · WHEELS LOCKED</span>':v.absActive?'<span class="w">BRAKING · ABS ACTIVE</span>':'<span class="w">BRAKING</span>');
    if(eng.state.driver.parkBrake)fl.push('<span class="w">PARKING BRAKE SET</span>');
    if(v.limp)fl.push('<span class="w">LIMP MODE: pedal ignored, 20 mph limit</span>');
    if(eng.outputs.acm.inducementCapMph<10)fl.push('<span class="r">DEF INDUCEMENT: 5 mph limit</span>');
    else if(v.protect)fl.push('<span class="r">ENGINE PROTECTION DERATE: 45 mph limit</span>');
    else if(v.powerLoss)fl.push('<span class="w">POWER DERATE: 45 mph limit</span>');
    if(eng.outputs.tcm.holdGear)fl.push('<span class="w">TCM HOLDING GEAR</span>');
    if(S.ctrl.mph>v.cap&&!v.braking)fl.push(`<span class="w">set speed ${S.ctrl.mph} mph not reachable</span>`);
    if(fl.length)s+=' · '+fl.join(' · ');
  }
  $('truckState').innerHTML=s;
}

// ===================== vehicle controls =====================
function updateCtrlUI(){
  document.querySelectorAll('#keySeg button').forEach(b=>b.classList.toggle('on',b.dataset.k===S.ctrl.key));
  $('mphSlider').disabled=S.ctrl.key!=='run';
  if(document.activeElement!==$('mphSlider')){$('mphSlider').value=S.ctrl.mph;$('mphVal').textContent=S.ctrl.mph+' mph';}
  $('btnBrake').disabled=!(S.ctrl.key==='run'&&S.mphAct>1)||S.ctrl.brake;
  document.querySelectorAll('#dmmBar [data-seg=key] button').forEach(b=>b.classList.toggle('on',b.dataset.v===S.ctrl.key));
}
function setKey(k){
  if(k!==eng.state.key)eng.dispatch({type:'setKey',key:k});
  updateCtrlUI();refreshAll();
}
$('keySeg').addEventListener('click',e=>{const b=e.target.closest('button[data-k]');if(b)setKey(b.dataset.k);});
$('mphSlider').addEventListener('input',e=>{$('mphVal').textContent=e.target.value+' mph';});
$('mphSlider').addEventListener('change',e=>{eng.dispatch({type:'setTargetSpeed',mph:+e.target.value});});
$('loadSel').addEventListener('change',e=>{eng.dispatch({type:'setLoad',load:e.target.value});});
$('roadSel').addEventListener('change',e=>{eng.dispatch({type:'setRoad',road:e.target.value});});
$('btnBrake').addEventListener('click',()=>{if(S.ctrl.key==='run'&&S.mphAct>1){eng.dispatch({type:'brake'});updateCtrlUI();}});
// ===================== tab navigation =====================
const TABNAMES=['faults','air','scan','meter','bus','codes','reference'];
function showTab(t){
  if(!TABNAMES.includes(t))t='faults';
  TABNAMES.forEach(n=>$('sec-'+n).classList.toggle('on',n===t));
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  S.curTab=t;
  try{history.replaceState(null,'','#'+t);}catch(e){}
  if(t==='meter')renderDmm();
  if(t==='scan'){S.scanSig='';renderToolCodes();}
}
$('nav').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b){showTab(b.dataset.tab);$('nav').scrollIntoView({behavior:'smooth',block:'start'});}});
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(TABNAMES.includes(h)&&h!==S.curTab)showTab(h);});

function spnName(spn){if(spn===639)return'J1939 Network #1';const c=C.find(x=>x.spn===spn);return c?c.spnName:'SPN '+spn;}
// ===================== scan tool =====================
// Panel 4 is a view of the engine's ScanTool: everything here comes off the J1939 bus
// (DM1 broadcasts, and replies to DM2 / DM11 / DM3 / DM4 / proprietary requests).
const MIDS={ecm:128,tcm:130,abs:136,clu:140};
function j1587(e,d){const m=MIDS[e];if(!m)return'—';if(e==='ecm'&&d.spn>=651&&d.spn<=656)return`MID 128 SID ${d.spn-650} FMI ${d.fmi}`;if(d.spn<256)return`MID ${m} PID ${d.spn} FMI ${d.fmi}`;return'—';}
function lampTxt(l,e){const a=[];if(l.includes('R'))a.push('<span class="lt r">STOP</span>');if(l.includes('A'))a.push('<span class="lt a">AWL</span>');if(l.includes('M'))a.push('<span class="lt a">MIL</span>');if(e==='abs')a.push('<span class="lt a">ABS</span>');return a.join(' ')||'—';}
function toolLog(s){S.toolLog.unshift(`[${(S.t/1000).toFixed(1)} s] ${s}`);S.toolLog=S.toolLog.slice(0,40);S.scanSig='';}
const SCAN_TABS=[['net','Vehicle / modules'],['faults','Fault codes'],['live','Live data'],['tests','Tests'],['log','Log']];
function quizHides(d){return S.quiz&&((d.cid&&qHas(d.cid))||(d.netKey&&S.quiz.cid==='net'));}
const SCAN_ORDER=['ecm','acm','tcm','abs','clu'];
function scanSignature(){
  return JSON.stringify([S.scanTab,S.prevShown,S.scanSel,S.toolLog.length,S.toolLog[0],S.cutout,S.regen,!!S.quiz,(S.v||{}).stalled,eng.scan.connected(),
    eng.scan.modules().map(m=>m.sa),eng.scan.activeCodes().map(d=>d.sa+':'+d.spn+'-'+d.fmi+'-'+d.oc+d.lamps),S.dm2.map(d=>d.sa+':'+d.spn+'-'+d.fmi)]);
}
function renderToolCodes(){
  const sig=scanSignature();
  if(sig!==S.scanSig){S.scanSig=sig;renderScan();}
  else if(S.scanTab==='live')updateLive();
  $('scanStatus').innerHTML=!eng.scan.connected()?'<span style="color:#ff8787">● No communication on J1939</span>':'<span style="color:#8ce99a">● Connected · J1939 250 kbit/s · 9-pin adapter</span>';
}
function renderScan(){
  $('scanTabs').innerHTML=SCAN_TABS.map(([k,n])=>`<button data-st="${k}" class="${S.scanTab===k?'on':''}">${n}</button>`).join('');
  const b=$('scanBody');
  if(S.ctrl.key==='off'&&S.scanTab!=='log'){b.innerHTML='<div class="scanErr"><b>No vehicle communication.</b><br>The key is OFF, so every module is asleep and the bus is silent. Turn the key ON to connect.</div>';return;}
  if(!eng.scan.connected()&&S.scanTab!=='log'){b.innerHTML=`<div class="scanErr"><b>Unable to connect to the vehicle network.</b><br>The adapter has power, but no J1939 traffic was detected on pins C/D. Check the data link wiring with a multimeter (panel 5 → "J1939 data link at the 9-pin").</div>`;return;}
  if(S.scanTab==='net')b.innerHTML=scanNet();
  if(S.scanTab==='faults')b.innerHTML=scanFaults();
  if(S.scanTab==='live'){b.innerHTML=scanLiveShell();updateLive();}
  if(S.scanTab==='tests')b.innerHTML=scanTests();
  if(S.scanTab==='log')b.innerHTML=`<div class="toolout" style="max-height:300px;margin:0">${S.toolLog.length?S.toolLog.join('<br>'):'No requests sent yet. The tool is listening to the DM1 broadcasts.'}</div>`;
}
$('scanTabs').addEventListener('click',e=>{const t=e.target.closest('button[data-st]');if(!t)return;S.scanTab=t.dataset.st;S.scanSig='';renderToolCodes();});
function scanNet(){
  const codes=eng.scan.activeCodes();
  let h='<p class="note" style="margin-top:0">The tool finds modules from their address claims (PGN 60928) and the messages they broadcast.</p><table class="sct"><tr><th>SA</th><th>Module</th><th>Status</th><th>Active codes</th><th>Lamps requested</th></tr>';
  for(const e of ['ecm','tcm','abs','clu','acm']){const on=eng.scan.responding(ECUS[e].sa);const act=codes.filter(d=>d.ecu===e);
    h+=`<tr><td class="mono">${ECUS[e].sa}</td><td>${ECUS[e].name} <span class="muted">(${ECUS[e].saName})</span></td><td>${on?'<span class="ok">Responding</span>':'<span class="bad">No response</span>'}</td><td>${on?act.length:'?'}</td><td>${on?lampTxt(act.map(d=>d.lamps).join(''),act.length?e:''):'?'}</td></tr>`;}
  return h+'</table>';
}
/** What the student may know about a code: from the tool, plus the bench-mode links (circuit/net) when not hidden. */
function scanCodeInfo(c){const cmp=C.find(x=>x.spn===c.spn&&x.ecu===c.ecu);return{...c,cid:cmp?cmp.id:undefined,netKey:c.spn===639?(S.net!=='none'?S.net:'noterm'):undefined};}
function scanFaults(){
  let h=`<div class="bar" style="margin-bottom:8px"><button onclick="readDM2()">Read inactive codes (DM2)</button><button onclick="clearCodes()">Clear codes (DM11 + DM3)</button><span class="note">Active codes come from each module's DM1 broadcast.</span></div>`;
  h+='<div style="overflow-x:auto"><table class="sct"><tr><th>Module (SA)</th><th>SPN</th><th>FMI</th><th>Status</th><th>OC</th><th>Lamp</th><th>J1587 equivalent</th><th>Description</th></tr>';
  let n=0;
  const act=eng.scan.activeCodes();
  for(const e of SCAN_ORDER){
    const rows=[];
    act.filter(d=>d.ecu===e).forEach(d=>rows.push([d,'active']));
    if(S.prevShown)S.dm2.filter(d=>d.ecu===e).forEach(d=>rows.push([d,'inactive']));
    rows.forEach(([d,st])=>{n++;const key=`${e}:${d.spn}:${d.fmi}:${st}`;
      h+=`<tr class="${S.scanSel===key?'sel':''}" data-scan="${key}"><td>${ECUS[e].name} (${ECUS[e].sa})</td><td class="mono"><b>${d.spn}</b></td><td class="mono"><b>${d.fmi}</b></td><td>${st==='active'?'<span class="badge b-act">Active</span>':'<span class="badge b-prev">Inactive</span>'}</td><td>${d.oc}</td><td>${st==='active'?lampTxt(d.lamps,e):'—'}</td><td class="mono" style="font-size:12px">${j1587(e,d)}</td><td style="font-size:12.5px">${spnName(d.spn)} – ${FMI[d.fmi]}</td></tr>`;});
  }
  const silent=SCAN_ORDER.filter(e=>!eng.scan.responding(ECUS[e].sa));
  silent.forEach(e=>h+=`<tr><td colspan="8" class="bad">${ECUS[e].name} (SA ${ECUS[e].sa}): no response. Codes stored in this module can't be read until it is back on the bus.</td></tr>`);
  h+='</table></div>';
  if(!n&&!silent.length)h+='<p class="muted">No active codes. Press <b>Read inactive codes</b> to request DM2 (previously active codes).</p>';
  if(S.scanSel){const[e,spn,fmi,st]=S.scanSel.split(':');const list=st==='active'?act:S.dm2;const d=list.find(x=>x.ecu===e&&x.spn==spn&&x.fmi==fmi);if(d)h+=scanDetail(e,scanCodeInfo(d),st);}
  else if(n)h+='<p class="note">Click a code for details and freeze-frame data.</p>';
  h+='<p class="note">The J1587 column shows how the same fault reads on older J1587/J1708 tools: MID = module (128 engine, 130 transmission, 136 brakes, 140 cluster), PID = parameter, SID = component.</p>';
  return h;
}
function scanDetail(e,d,st){
  const ff=S.scanFF&&S.scanFF.key===S.scanSel?S.scanFF.ff:null;
  let h=`<div class="scanDetail"><b>${ECUS[e].name} (SA ${ECUS[e].sa}) · SPN ${d.spn} / FMI ${d.fmi} · occurrence count ${d.oc}</b><br>${spnName(d.spn)}: ${FMI[d.fmi]}`;
  if(quizHides(d))h+='<br><i>Mystery mode: the cause is hidden. Use the multimeter to find it.</i>';
  if(ff)h+=`<div style="margin-top:6px"><b>Freeze frame</b> <span class="note">(snapshot stored when the code set; read with DM4, PGN 65229)</span><table class="sct ff"><tr><td>Engine speed</td><td>${Math.round(ff.rpm)} rpm</td><td>Vehicle speed</td><td>${ff.mph.toFixed(0)} mph</td></tr><tr><td>Coolant temp</td><td>${Math.round(ff.coolantC*1.8+32)} °F</td><td>Oil pressure</td><td>${(ff.oilKpa*0.145).toFixed(0)} psi</td></tr><tr><td>Boost</td><td>${(Math.max(0,ff.boostKpa)*0.145).toFixed(1)} psi</td><td>Engine load</td><td>${Math.round(ff.loadPct)} %</td></tr><tr><td>Battery</td><td>${ff.batteryV.toFixed(1)} V</td><td>Time since key on</td><td>${ff.tSec.toFixed(0)} s</td></tr></table></div>`;
  h+=`<div class="bar" style="margin-top:8px"><button onclick="explainFromScan('${e}',${d.spn},${d.fmi})">Explain this code ↓</button>${d.cid&&circuitType(PROBE_ALIAS[d.cid]||d.cid)?`<button onclick="probeFromScan('${d.cid}')">Probe this circuit with the meter ↓</button>`:''}${d.netKey?`<button onclick="probeFromScan('net')">Check the data link with the meter ↓</button>`:''}</div></div>`;
  return h;
}
$('scanBody').addEventListener('click',e=>{const r=e.target.closest('tr[data-scan]');if(!r)return;S.scanSel=r.dataset.scan;
  const[ec,spn,fmi]=S.scanSel.split(':');S.scanFF={key:S.scanSel,ff:eng.scan.freezeFrame(ECUS[ec].sa,+spn,+fmi)};
  S.scanSig='';renderToolCodes();});
function explainFromScan(e,spn,fmi){S.sel={ecu:e,spn,fmi};renderExplain();showTab('faults');}
function probeFromScan(cid){setMeterCircuit(PROBE_ALIAS[cid]||cid);renderDmmBar();showTab('meter');}
function rb1(b,i,f){return b[i]===0xFE?'ERR':b[i]===0xFF?'N/A':f(b[i]);}
function rb2(b,i,f){return b[i+1]===0xFE?'ERR':b[i+1]===0xFF?'N/A':f(b[i]|b[i+1]<<8);}
function scanLiveShell(){
  return '<table class="sct"><tr><th>Parameter</th><th>SPN</th><th>Value</th><th>Unit</th><th>From</th></tr>'+eng.scan.liveData().map((p,i)=>`<tr><td>${p.name}</td><td class="mono">${p.spn}</td><td class="mono" id="live${i}" style="font-weight:700"></td><td>${p.unit}</td><td>${ECUS[p.ecu].name} (${ECUS[p.ecu].sa})</td></tr>`).join('')+'</table><p class="note"><b>ERR</b> = the module sent the error indicator (it knows its sensor is bad). <b>N/A</b> = not available. <b>No data</b> = the message stopped arriving.</p>';
}
function updateLive(){
  eng.scan.liveData().forEach((p,i)=>{const c=$('live'+i);if(!c)return;const v=p.value;
    c.textContent=v;c.style.color=v==='ERR'?'#e03131':v==='No data'||v==='N/A'?'#6a6a73':'#e6e6e9';});
}
function scanTests(){
  let h='<div class="testbox"><b>Cylinder cutout test</b> (truck parked, engine at idle). The tool turns off one injector at a time and measures how much engine speed drops. A cylinder that is already weak or dead barely changes the speed.<div class="bar" style="margin:6px 0"><button onclick="runCutout()">Run cylinder cutout test</button></div>';
  if(S.cutout){h+='<div class="bars">'+S.cutout.map((d,i)=>`<div class="cb"><span>Cyl ${i+1}</span><i style="width:${d*4}px;background:${d<15?'#e03131':'#4dabf7'}"></i><b>${d.toFixed(0)} rpm drop</b>${d<15?' <span class="bad">← weak/dead cylinder</span>':''}</div>`).join('')+'</div><p class="note">Illustrative numbers. Compare cylinders against each other and against the OEM spec.</p>';}
  h+='</div><div class="testbox"><b>Parked DPF regeneration</b> (truck parked, in neutral, parking brake set). The ACM raises exhaust temperature to burn off soot.<div class="bar" style="margin:6px 0"><button onclick="runRegen()" '+(S.regen==='running'?'disabled':'')+'>Request parked regen</button> <span>'+(S.regen==='running'?'Regen in progress… exhaust temperature rising':'')+'</span></div></div>';
  return h;
}
function runCutout(){
  if(!eng.scan.responding(0)){toolLog('Cylinder cutout test failed: no response from the engine ECM.');return;}
  const d=eng.scan.cylinderCutout();
  if(!d){toolLog('Cylinder cutout test refused: the engine is not running.');return;}
  S.cutout=d;toolLog('Cylinder cutout test complete.');S.scanSig='';renderToolCodes();
}
function runRegen(){
  const code=eng.scan.parkedRegen();
  if(code===null){toolLog('Parked regen failed: no response from the ACM.');return;}
  toolLog(eng.module('acm').regenMsg);
  if(code===0)S.regen='running';
  S.scanSig='';renderToolCodes();
}
function readDM2(){
  if(!eng.scan.connected()){toolLog('Request failed: no response on J1939 (bus fault).');return;}
  S.dm2=eng.scan.requestDM2();
  toolLog('Sent Request (18EAFFF9) for DM2, PGN 65227, to all modules.');
  for(const e of SCAN_ORDER){
    if(!eng.scan.lastAnswered.includes(ECUS[e].sa)){toolLog(`${ECUS[e].name}: no response.`);continue;}
    const list=S.dm2.filter(d=>d.ecu===e);
    toolLog(`${ECUS[e].name} replied DM2: ${list.length?list.map(d=>`${d.spn}-${d.fmi} (OC ${d.oc})`).join(', '):'none'}${list.length>1?' (via BAM)':''}`);
  }
  S.prevShown=true;S.scanSig='';renderToolCodes();updateMonitor();
}
function clearCodes(){
  if(!eng.scan.connected()){toolLog('Clear failed: no communication.');return;}
  const acked=eng.scan.clearCodes();
  toolLog('Sent DM11 request (clear active DTCs) and DM3 request (clear inactive DTCs) to all modules.');
  SCAN_ORDER.forEach(e=>{if(!acked.includes(ECUS[e].sa))toolLog(`${ECUS[e].name}: no response (not cleared).`);});
  S.prevShown=false;S.scanSel=null;S.dm2=[];
  S.clearCheckAt=eng.timeMs+2500;
  refreshAll();
}

// ===================== multimeter lab =====================
// The meter readings come from the engine's Multimeter, which only sees the solved harness.
const TYPE_OF={...ENGINE_TYPE_OF};delete TYPE_OF.net;
function circuitType(cid){return cid==='net'?'F':TYPE_OF[cid];}
const DMM={cid:'map',key:'on',conn:'on',mode:'dcv',spin:false,red:null,black:null,next:'red'};
const ELECTRICAL={A:['gnd','high','open','erratic'],B:['open','gnd'],C:['open','short','erratic','gap'],D:['open','short'],E:['low'],G:['nocom'],H:['open','gnd'],F:['term','tcm','hl','hg']};
function ownerName(cid){if(cid==='net')return'9-pin diagnostic connector';return ECUS[C.find(c=>c.id===cid).ecu].name;}
function compName(cid){if(cid==='net')return'J1939 data link at the 9-pin';return C.find(c=>c.id===cid).name;}
// Test points use the engine's harness node names: c0u_* module pins, c1u_* harness side of the
// component connector, c1d_* component pins (the bench schematic route: module → one section → connector).
function layoutFor(cid){
  const t=circuitType(cid),c=cid==='net'?null:C.find(x=>x.id===cid);
  const L=(lab,w,col)=>({lab,L:'c0u_'+w,H:'c1u_'+w,R:'c1d_'+w,col});
  switch(t){
    case'A':return{left:ownerName(cid),right:c.name,lines:[L('5 V reference','ref','#e03131'),L('Signal','sig','#f59f00'),L('Sensor return','ret','#343a40')]};
    case'B':return{left:ownerName(cid),right:c.name+' (NTC thermistor)',lines:[L('Signal','sig','#f59f00'),L('Sensor return','ret','#343a40')]};
    case'C':return{left:ownerName(cid),right:c.name+' (2-wire magnetic)',lines:[L('Signal +','a','#f59f00'),L('Signal −','b','#868e96')]};
    case'D':return{left:'Engine ECM (injector drivers)',right:c.name,lines:[L('High side','hi','#e03131'),L('Low side','lo','#1971c2')]};
    case'E':return{left:'Batteries & fuse panel',right:cid==='batt'?'Engine ECM power connector':'ABS ECU power connector',lines:[L('Power feed (fused)','pwr','#e03131'),{...L('Ground','gnd','#343a40'),L:'gnd'}],extra:[{n:'batpos',label:'Battery + post',x:105,y:42}]};
    case'F':return{left:'9-pin diagnostic connector',right:'Transmission TCM (end of its stub)',lines:[{lab:'CAN-H (pin C)',L:'C',H:'tcm_h',R:'tcmm_h',col:'#e0b000'},{lab:'CAN-L (pin D)',L:'D',H:'tcm_l',R:'tcmm_l',col:'#2f9e44'}],extra:[{n:'A',label:'Pin A (ground)',x:60,y:170},{n:'B',label:'Pin B (battery +)',x:140,y:170}]};
    case'G':return{left:'Aftertreatment ACM & fuse',right:c.name+' module',lines:[L('Power (fused 12 V)','pwr','#e03131'),{...L('Ground','gnd','#343a40'),L:'gnd'},L('CAN-H','h','#e0b000'),L('CAN-L','l','#2f9e44')]};
    case'H':return{left:'Instrument cluster',right:'Fuel level sender (in tank)',lines:[L('Signal','sig','#f59f00'),L('Sender return','ret','#343a40')]};
  }
}
/** Connector 1 is the component connector on the bench schematic (the TCM connector for the data link). */
function applyMeterPlug(){const unplugged=DMM.conn!=='on';const set=eng.electrical.harness.unplugged.get(DMM.cid);const is=!!(set&&set.has(1));if(is!==unplugged)eng.dispatch({type:unplugged?'unplug':'plug',circuit:DMM.cid,connector:1});}
function setMeterCircuit(cid){
  const set=eng.electrical.harness.unplugged.get(DMM.cid);if(set&&set.has(1))eng.dispatch({type:'plug',circuit:DMM.cid,connector:1});
  if(DMM.spin)eng.dispatch({type:'spinWheel',circuit:DMM.cid,on:false});
  DMM.cid=cid;DMM.red=DMM.black=null;DMM.next='red';DMM.spin=false;applyMeterPlug();
}
function meterReq(){return{circuit:DMM.cid,red:DMM.red,black:DMM.black,mode:DMM.mode,isolateModule:true};}
function measureNow(reference){return eng.meter.measure(meterReq(),!!reference);}
/** What the owning module sees on this input, from the module's own input reading. */
function ecmSees(cid){
  const t=circuitType(cid);
  if(eng.state.key==='off')return'Module is asleep (key off).';
  if(t==='F')return`Bus average: CAN-H <b>${eng.electrical.volts('net','C').toFixed(2)} V</b>, CAN-L <b>${eng.electrical.volts('net','D').toFixed(2)} V</b>`;
  const own=ownerOf(cid);const r=own?eng.module(own).input(cid):null;if(!r)return'';
  const bad=s=>` → <span class="bad">${s}</span>`;
  switch(t){
    case'A':{const sup=SUPPLY[cid];const sr=sup?eng.module('ecm').input(sup):null;
      if(r.inhibited)return`${ownerName(cid)} sees signal = <b>${r.volts.toFixed(2)} V</b>${bad(`5 V supply out of range (${eng.electrical.volts(cid,'sup').toFixed(2)} V): supply code set instead`)}`;
      return`${ownerName(cid)} sees signal = <b>${r.volts.toFixed(2)} V</b>${r.fmi===4?bad('below range: sets FMI 4'):r.fmi===3?bad('above range: sets FMI 3'):' → in range (0.25–4.75 V)'}`;}
    case'B':return`${ownerName(cid)} sees signal = <b>${r.volts.toFixed(2)} V</b>${r.fmi===4?bad('below range: sets FMI 4'):r.fmi===3?bad('above range (open): sets FMI 3'):' → in range'}`;
    case'C':return`${ownerName(cid)} sees <b>${(r.acVolts||0).toFixed(2)} V~</b> of pulses${r.fmi===5?bad('open circuit: sets FMI 5'):r.fmi!==null?bad(`shorted: sets FMI ${r.fmi}`):(r.acVolts||0)<0.2?(eng.state.key==='run'||DMM.spin?bad('no usable signal'):' (nothing turning)'):''}`;
    case'D':return r.fmi===5?`Injector driver sees an open coil (${r.driverOhms>1e6?'OL':r.driverOhms.toFixed(1)+' Ω'})${bad('sets FMI 5')}`:r.fmi===6?`Injector driver sees a short${bad('sets FMI 6, driver switched off')}`:'Injector drivers fire only while the engine runs. Driver check: coil OK.';
    case'E':return`Module supply = <b>${r.volts.toFixed(2)} V</b>${r.volts<10.5?bad('low: module may set a supply-voltage code'):''}`;
    case'G':return`NOx module supply = <b>${r.volts.toFixed(2)} V</b>${r.volts<9?bad("no power: the sensor can't talk on CAN (FMI 9)"):''}`;
    case'H':return`Cluster sees signal = <b>${r.volts.toFixed(2)} V</b>${r.fmi===3?bad('open circuit (FMI 3)'):r.fmi===4?bad('shorted (FMI 4)'):''}`;
  }
  return'';
}
const GUIDES={
  A:['Key ON, plugged in (back-probe): 5 V ref to ground ≈ 5.0 V.','Key ON, plugged in: signal to ground ≈ 0.5–4.5 V and moves with pressure or position.','Key ON, plugged in: sensor return to ground (voltage drop) under 0.1 V.','Key ON, <b>unplugged</b>: harness signal pin to ground ≈ 0 V (ECM pull-down). 5 V there means the signal wire is shorted to 5 V ref.','Key OFF, unplugged at both ends: each wire end to end under 5 Ω; signal to ground OL.','Don\'t ohm-test an electronic (3-wire) sensor: test it with voltage while it is powered.'],
  B:['Key ON, unplugged: harness signal pin ≈ 5 V (ECM pull-up). 0 V there means an open or a short to ground.','Key ON, plugged in: the voltage drops as temperature rises.','Key OFF, sensor unplugged: sensor resistance should match the OEM temperature chart (low when hot).'],
  C:['Key OFF, unplugged: coil resistance across the sensor pins (spec varies; WS-24 wheel sensors ≈ 1500–2500 Ω).','Key OFF: each pin to ground should be OL.','V~ mode with the engine running or the wheel turning: AC voltage rises with speed (wheel at 0.5 rev/s: at least 0.25 V~ for Bendix).'],
  D:['Key OFF, ECM connector unplugged: high side to low side = coil + harness (spec usually under 2 Ω).','Each wire to ground: OL.','If the ECM end reads OL but the injector terminals read correct, the harness is open.','Never probe injector circuits with the engine running.'],
  E:['Key ON (circuit loaded): battery + post to module power pin = voltage drop on the feed. It should be under about 0.5 V.','Module ground pin to battery − (chassis): under about 0.2 V.','Module power pin to ground should be within about 0.5 V of battery voltage.'],
  F:['Key OFF: C to D ≈ 60 Ω (two 120 Ω terminators).','Key OFF: C to A and D to A should be OL.','Key ON: C ≈ 2.5–3.0 V, D ≈ 2.0–2.5 V to ground.','At a module (unplugged), H to L ≈ 60 Ω proves its stub reaches the backbone.'],
  G:['Key ON, plugged in: power pin to ground ≈ battery voltage.','Ground pin voltage drop under 0.2 V.','Key OFF: CAN-H to CAN-L ≈ 60 Ω on the aftertreatment sub-network.','If power, ground and CAN are all good, the sensor itself has failed.'],
  H:['Key OFF, unplugged: sender resistance (this demo uses 33 Ω full and 240 Ω empty; check OEM values).','Key ON, unplugged: harness signal pin ≈ 5 V from the cluster pull-up.'],
};
const PT={};
DMM.log=[];DMM.logSig='';
const PROBE_ALIAS={sup1:'map',sup2:'oilp'};
function pointLabel(n){return(PT[n]&&PT[n].label)||n;}
function renderDmmBar(){
  const groups={};C.forEach(c=>{if(!circuitType(c.id))return;(groups[c.ecu]=groups[c.ecu]||[]).push(c);});
  let sel=`<select id="dmmCkt">`;for(const e in groups)sel+=`<optgroup label="${ECUS[e].name}">${groups[e].map(c=>`<option value="${c.id}" ${DMM.cid===c.id?'selected':''}>${c.name}</option>`).join('')}</optgroup>`;
  sel+=`<optgroup label="Network"><option value="net" ${DMM.cid==='net'?'selected':''}>J1939 data link at the 9-pin</option></optgroup></select>`;
  const seg=(name,opts,cur)=>`<span class="seg" data-seg="${name}">${opts.map(([k,l])=>`<button data-v="${k}" class="${cur===k?'on':''}">${l}</button>`).join('')}</span>`;
  const wheel=DMM.cid[0]==='w'&&circuitType(DMM.cid)==='C';
  $('dmmBar').innerHTML=`<div><div class="lab">Circuit</div>${sel}</div><div><div class="lab">Key (same as vehicle key)</div>${seg('key',[['off','Off'],['on','On'],['run','Run']],S.ctrl.key)}</div><div><div class="lab">Connector</div>${seg('conn',[['on','Plugged in (back-probe)'],['off','Unplugged']],DMM.conn)}</div>${wheel?`<div><div class="lab">Wheel</div><label class="small"><input type="checkbox" id="dmmSpin" ${DMM.spin?'checked':''}> Spin by hand (≈0.5 rev/s)</label></div>`:''}`;
  $('dmmFn').innerHTML=[['dcv','V ⎓'],['acv','V ~'],['ohm','Ω']].map(([k,l])=>`<button data-fn="${k}" class="${DMM.mode===k?'on':''}">${l}</button>`).join('');
  $('dmmLeads').innerHTML=`<button class="lead red ${DMM.next==='red'?'on':''}" data-lead="red"><b>Red · V Ω</b><span>${DMM.red?pointLabel(DMM.red):'click a test point'}</span></button><button class="lead blk ${DMM.next==='black'?'on':''}" data-lead="black"><b>Black · COM</b><span>${DMM.black?pointLabel(DMM.black):'click a test point'}</span></button>`;
  $('dmmChecksList').innerHTML=(GUIDES[circuitType(DMM.cid)]||[]).map(x=>`<li>${x}</li>`).join('');
}
$('dmmBar').addEventListener('click',e=>{
  const b=e.target.closest('.seg button');if(!b)return;const k=b.closest('.seg').dataset.seg;
  if(k==='key'){setKey(b.dataset.v);renderDmmBar();return;}
  DMM[k]=b.dataset.v;if(k==='conn')applyMeterPlug();renderDmmBar();renderDmm();
});
$('dmmBar').addEventListener('change',e=>{
  if(e.target.id==='dmmCkt'){setMeterCircuit(e.target.value);renderDmmBar();renderDmm();}
  if(e.target.id==='dmmSpin'){DMM.spin=e.target.checked;eng.dispatch({type:'spinWheel',circuit:DMM.cid,on:DMM.spin});renderDmmReading();}
});
$('dmmFn').addEventListener('click',e=>{const b=e.target.closest('button[data-fn]');if(!b)return;DMM.mode=b.dataset.fn;renderDmmBar();renderDmmReading();});
$('dmmLeads').addEventListener('click',e=>{const b=e.target.closest('button[data-lead]');if(!b)return;DMM.next=b.dataset.lead;renderDmmBar();});
$('dmmSwap').addEventListener('click',()=>{[DMM.red,DMM.black]=[DMM.black,DMM.red];renderDmmBar();renderDmm();});
$('dmmClear').addEventListener('click',()=>{DMM.red=DMM.black=null;DMM.next='red';renderDmmBar();renderDmm();});
$('dmmRef').addEventListener('change',renderDmmReading);
$('dmmLogClear').addEventListener('click',()=>{DMM.log=[];DMM.logSig='';renderDmmLog();});
function renderDmm(){
  const svg=$('dmm');if(!svg)return;svg.innerHTML='';for(const k in PT)delete PT[k];
  const lay=layoutFor(DMM.cid),n=lay.lines.length,gap=n>3?48:n>2?60:74,y=i=>84+i*gap,bot=y(n-1)+38;
  const conn=DMM.conn==='on',sx=conn?600:668,quiz=(S.quiz&&S.quiz.cid===DMM.cid)||DMM.level===2;
  const t=circuitType(DMM.cid),f=DMM.cid==='net'?S.net:S.faults[DMM.cid];
  const sup=SUPPLY[DMM.cid]&&S.faults[SUPPLY[DMM.cid]];
  const T=(x,yy,s,a)=>tx(svg,x,yy,s,Object.assign({fill:'#8a8a93','font-size':12,'font-family':'Titillium Web, sans-serif'},a||{}));
  el('rect',{x:24,y:44,width:170,height:bot-44+(t==='F'?66:0),fill:'#0d0d10',stroke:'#3a3a42','stroke-width':1.5},svg);
  T(24,30,lay.left.toUpperCase(),{'font-size':11,fill:'#e6e6e9','letter-spacing':'1.5'});
  el('rect',{x:sx+30,y:44,width:250,height:bot-44,fill:'#141007',stroke:'#f5a623','stroke-width':1.5},svg);
  T(sx+30,30,lay.right.toUpperCase(),{'font-size':11,fill:'#f5a623','letter-spacing':'1.5'});
  el('rect',{x:538,y:58,width:28,height:bot-70,fill:'#1a1a20',stroke:'#4a4a52'},svg);
  el('rect',{x:sx-6,y:58,width:28,height:bot-70,fill:'#1a1a20',stroke:'#4a4a52'},svg);
  T(552,bot+8,'HARNESS SIDE',{'text-anchor':'middle','font-size':10,'letter-spacing':'1'});
  T(sx+8,bot+22,conn?'COMPONENT SIDE':'COMPONENT (UNPLUGGED)',{'text-anchor':'middle','font-size':10,'letter-spacing':'1'});
  const letters='ABCDEF';
  lay.lines.forEach((l,i)=>{
    const yy=y(i),col=l.col==='#343a40'?'#9aa0a6':l.col;
    el('line',{x1:194,x2:552,y1:yy,y2:yy,stroke:col,'stroke-width':4},svg);
    T(372,yy-10,l.lab,{'text-anchor':'middle',fill:'#e6e6e9','font-size':13.5});
    if(conn)el('line',{x1:552,x2:sx+8,y1:yy,y2:yy,stroke:col,'stroke-width':4},svg);
    el('line',{x1:sx+8,x2:sx+46,y1:yy,y2:yy,stroke:col,'stroke-width':3.5},svg);
    T(178,yy+5,t==='F'?'CD'[i]:'P'+(i+1),{'text-anchor':'end','font-family':'IBM Plex Mono, monospace',fill:'#c9c9cf','font-size':13});
    T(552,yy-17,letters[i],{'text-anchor':'middle','font-family':'IBM Plex Mono, monospace',fill:'#fff','font-size':13,'font-weight':600});
    T(sx+8,yy-17,letters[i],{'text-anchor':'middle','font-family':'IBM Plex Mono, monospace',fill:'#fff','font-size':13,'font-weight':600});
  });
  const pts=[];
  lay.lines.forEach((l,i)=>{const yy=y(i);
    pts.push([194,yy,l.L,t==='F'?`9-pin pin ${'CD'[i]} · ${l.lab.replace(/ \(pin .\)/,'')}`:`${lay.left} pin P${i+1} · ${l.lab}`]);
    pts.push([552,yy,l.H,`Harness connector pin ${letters[i]} · ${l.lab}`]);
    pts.push([sx+8,yy,l.R,`${lay.right} pin ${letters[i]} · ${l.lab}`]);});
  if(t==='E'){el('line',{x1:110,x2:110,y1:54,y2:y(0),stroke:'#ff3b30','stroke-width':2.5},svg);T(118,y(0)-20,'fuse');T(126,58,'BATT +',{fill:'#e6e6e9'});pts.push([110,54,'batpos','Battery + post']);}
  if(t==='F'){T(34,bot+56,'120 Ω terminators on backbone',{'font-size':10.5});T(88,bot+32,'A',{fill:'#fff','font-family':'IBM Plex Mono, monospace','font-size':13});T(168,bot+32,'B',{fill:'#fff','font-family':'IBM Plex Mono, monospace','font-size':13});pts.push([70,bot+28,'A','9-pin pin A · ground']);pts.push([150,bot+28,'B','9-pin pin B · battery +']);}
  const gx=430,gy=bot+62;
  el('line',{x1:gx,x2:gx,y1:gy-18,y2:gy,stroke:'#e6e6e9','stroke-width':2},svg);
  [0,1,2].forEach(i=>el('line',{x1:gx-15+i*5,x2:gx+15-i*5,y1:gy+i*5,y2:gy+i*5,stroke:'#e6e6e9','stroke-width':2},svg));
  T(gx+20,gy-13,'CHASSIS GROUND',{fill:'#e6e6e9','font-size':10.5,'letter-spacing':'1.2'});
  pts.push([gx,gy-18,'gnd','Chassis ground / battery −']);
  if(!quiz){if(f&&f!=='none')drawFaultMark(svg,t,f,y,gx,gy);
    if(sup){const red='#ff3b30';el('path',{d:`M470,${y(0)} L470,${gy-30} L${gx},${gy-30} L${gx},${gy-18}`,fill:'none',stroke:red,'stroke-width':2.5,'stroke-dasharray':'6 4'},svg);T(476,y(0)+20,sup==='gnd'?'shared 5 V ref shorted to ground':'shared 5 V ref shorted to battery',{fill:red,'font-weight':700});}}
  if(quiz)T(372,14,'MYSTERY FAULT · FIND IT WITH THE METER',{'text-anchor':'middle',fill:'#ff3b30','font-size':11,'letter-spacing':'1.5'});
  // meter body (bottom right)
  const mx=sx+34,my=bot+40,mw=240,mh=118;
  el('rect',{x:mx,y:my,width:mw,height:mh,rx:12,fill:'#f5a623',stroke:'#000','stroke-width':2},svg);
  el('rect',{x:mx+14,y:my+12,width:mw-28,height:46,rx:4,fill:'#0d1a12',stroke:'#1f3a28'},svg);
  DMM.svgMode=tx(svg,mx+22,my+28,{dcv:'V ⎓',acv:'V ~',ohm:'Ω'}[DMM.mode],{'font-size':11,'font-family':'IBM Plex Mono, monospace',fill:'#7fe0a0'});
  DMM.svgLcd=tx(svg,mx+mw-22,my+50,'',{'text-anchor':'end','font-size':26,'font-family':'IBM Plex Mono, monospace',fill:'#b8ffcf'});
  const jr=[mx+70,my+92],jb=[mx+170,my+92];
  el('circle',{cx:jr[0],cy:jr[1],r:10,fill:'#ff3b30',stroke:'#000','stroke-width':2},svg);
  el('circle',{cx:jb[0],cy:jb[1],r:10,fill:'#111',stroke:'#000','stroke-width':2},svg);
  tx(svg,jr[0]+16,jr[1]+5,'V Ω',{'font-size':12,'font-weight':700,fill:'#000','font-family':'Titillium Web, sans-serif'});
  tx(svg,jb[0]+16,jb[1]+5,'COM',{'font-size':12,'font-weight':700,fill:'#000','font-family':'Titillium Web, sans-serif'});
  // probe points
  const ptLayer=el('g',{},svg);
  pts.forEach(([x,yy,nn,label])=>pp(ptLayer,x,yy,nn,label));
  // leads (drawn above points)
  const lead=(p,j,col,edge)=>{if(!p||!PT[p])return;const[x,yy]=PT[p].xy;
    const d=`M${j[0]},${j[1]} C${j[0]},${j[1]+70} ${x},${Math.max(yy+90,j[1]+40)} ${x},${yy+14}`;
    el('path',{d,fill:'none',stroke:edge,'stroke-width':8,'stroke-linecap':'round'},svg);
    el('path',{d,fill:'none',stroke:col,'stroke-width':5,'stroke-linecap':'round'},svg);
    el('path',{d:`M${x-5},${yy+24} L${x+5},${yy+24} L${x+2},${yy+6} L${x-2},${yy+6} Z`,fill:col,stroke:edge,'stroke-width':1.5},svg);
    el('circle',{cx:x,cy:yy,r:13,fill:'none',stroke:col==='#1a1a1a'?'#e6e6e9':col,'stroke-width':3},svg);};
  lead(DMM.black,jb,'#1a1a1a','#e6e6e9');lead(DMM.red,jr,'#ff3b30','#000');
  // hover label layer
  DMM.hov=el('g',{style:'pointer-events:none'},svg);
  svg.setAttribute('viewBox',`0 0 960 ${Math.max(gy+30,my+mh+70)}`);
  renderDmmReading();renderQuizBox();
}
function pp(layer,x,y,n,label){
  if(!PT[n])PT[n]={xy:[x,y],label};
  const isR=DMM.red===n,isB=DMM.black===n;
  const c=el('circle',{cx:x,cy:y,r:9,fill:isR?'#ff3b30':isB?'#1a1a1a':'#000',stroke:isB?'#e6e6e9':'#e6e6e9','stroke-width':2.2,class:'pp'},layer);
  const hit=el('circle',{cx:x,cy:y,r:16,fill:'transparent',class:'pp'},layer);
  const show=()=>{const h=DMM.hov;if(!h)return;h.innerHTML='';
    const txt=`${label}  →  click to attach ${DMM.next==='red'?'RED':'BLACK'}`;
    const w=txt.length*6.6+16,bx=Math.min(Math.max(8,x-w/2),952-w),by=y-44;
    el('rect',{x:bx,y:by,width:w,height:22,fill:'#000',stroke:DMM.next==='red'?'#ff3b30':'#e6e6e9','stroke-width':1.5},h);
    tx(h,bx+8,by+15,txt,{'font-size':12,'font-family':'Titillium Web, sans-serif',fill:'#fff'});
    c.setAttribute('stroke',DMM.next==='red'?'#ff3b30':'#6fd3ff');c.setAttribute('stroke-width',3.5);};
  const hide=()=>{if(DMM.hov)DMM.hov.innerHTML='';c.setAttribute('stroke','#e6e6e9');c.setAttribute('stroke-width',2.2);};
  hit.addEventListener('mouseenter',show);hit.addEventListener('mouseleave',hide);
  hit.addEventListener('click',()=>{PT[n]={xy:[x,y],label};DMM[DMM.next]=n;DMM.next=DMM.next==='red'?'black':'red';renderDmmBar();renderDmm();});
}
function drawFaultMark(svg,t,f,y,gx,gy){
  const red='#ff3b30',T=(x,yy,s,a)=>tx(svg,x,yy,s,Object.assign({fill:red,'font-size':11,'font-weight':700,'font-family':'Titillium Web, sans-serif'},a||{}));
  const X=(x,yy)=>el('path',{d:`M${x-9},${yy-9} L${x+9},${yy+9} M${x+9},${yy-9} L${x-9},${yy+9}`,stroke:red,'stroke-width':4},svg);
  const sigRow={A:1,B:0,C:0,D:0,H:0}[t];
  if(f==='open'&&sigRow!=null){X(320,y(sigRow));T(320,y(sigRow)+24,'open',{'text-anchor':'middle'});}
  if((f==='gnd'||f==='short')&&sigRow!=null){el('path',{d:`M500,${y(sigRow)} L500,${gy-28} L${gx},${gy-28} L${gx},${gy-16}`,fill:'none',stroke:red,'stroke-width':3,'stroke-dasharray':'6 4'},svg);T(494,y(sigRow)+20,'short to ground',{'text-anchor':'end'});}
  if(f==='high'){el('path',{d:`M480,${y(0)} l-8,${(y(1)-y(0))/2} l12,0 l-6,${(y(1)-y(0))/2}`,fill:'none',stroke:red,'stroke-width':3},svg);T(492,y(0)+(y(1)-y(0))/2,'short to 5 V ref');}
  if(f==='erratic')T(552,y(sigRow||0)+26,'loose pin',{'text-anchor':'middle'});
  if(f==='gap')T(760,y(0)+26,'air gap too large');
  if(t==='E'&&f==='low')T(130,y(0)-34,'corroded fuse/feed (high resistance)');
  if(t==='G'&&f==='nocom'){X(194,y(0));T(210,y(0)+24,'blown fuse');}
  if(t==='F'){
    {const m=(S.termOut.L?1:0)+((f==='term'||S.termOut.R)?1:0);if(m)T(40,y(1)+30,m===2?'both terminators missing':'one terminator missing');}
    if(f==='tcm'){X(450,y(0));X(450,y(1));T(450,y(1)+26,'TCM stub open',{'text-anchor':'middle'});}
    if(f==='hl'){el('path',{d:`M300,${y(0)} l-8,${(y(1)-y(0))/2} l12,0 l-6,${(y(1)-y(0))/2}`,fill:'none',stroke:red,'stroke-width':3},svg);T(312,y(0)+(y(1)-y(0))/2,'H–L short');}
    if(f==='hg'){el('path',{d:`M500,${y(0)} L500,${gy-28} L${gx},${gy-28} L${gx},${gy-16}`,fill:'none',stroke:red,'stroke-width':3,'stroke-dasharray':'6 4'},svg);T(506,y(0)+20,'CAN-H to ground');}
  }
}
function renderDmmReading(){
  if(!$('lcdVal'))return;
  const m=measureNow();
  $('lcdVal').textContent=m.text;
  if(DMM.svgLcd)DMM.svgLcd.textContent=m.text;if(DMM.svgMode)DMM.svgMode.textContent={dcv:'V ⎓',acv:'V ~',ohm:'Ω'}[DMM.mode];
  $('lcdMode').textContent={dcv:'V ⎓',acv:'V ~',ohm:'Ω'}[DMM.mode];
  const t=circuitType(DMM.cid);
  let h=`<div class="box" style="margin:0">`;
  if(!DMM.red||!DMM.black)h+=`<span class="muted">Click two test points on the drawing. The highlighted lead button shows which lead goes next.</span>`;
  else{
    h+=`<span class="mono" style="font-size:20px;color:#b8ffcf">${m.text}</span> <span class="muted">· ${{dcv:'DC volts',acv:'AC volts',ohm:'resistance'}[DMM.mode]} · key ${S.ctrl.key} · ${DMM.conn==='on'?'plugged in':'unplugged'}</span>`;
    if(DMM.level!==2&&$('dmmRef').checked&&!m.warn){const good=measureNow(true);h+=`<div class="muted" style="margin-top:4px">Known-good circuit: <span class="mono" style="color:#e6e6e9">${good.text}</span></div>`;}
  }
  if(m.warn)h+=`<div class="bad" style="margin-top:6px">${m.warn}</div>`;
  if(m.note)h+=`<div class="note" style="margin-top:6px">${m.note}</div>`;
  let sees=ecmSees(DMM.cid);if((S.quiz&&S.quiz.cid===DMM.cid)||DMM.level===2)sees=sees.replace(/ → <span class="bad">.*?<\/span>/,'');
  h+=`<div style="margin-top:8px;padding-top:8px;border-top:1px solid #24242a">${sees}</div></div>`;
  $('dmmInfo').innerHTML=h;
  if(DMM.red&&DMM.black&&!m.warn){
    const sig=[DMM.cid,S.ctrl.key,DMM.conn,DMM.mode,DMM.red,DMM.black,DMM.spin].join('|');
    if(sig!==DMM.logSig){DMM.logSig=sig;eng.meter.probe(meterReq());DMM.log.unshift({c:DMM.cid==='net'?'J1939 link':C.find(x=>x.id===DMM.cid).name,k:S.ctrl.key,conn:DMM.conn==='on'?'in':'out',mode:{dcv:'V⎓',acv:'V~',ohm:'Ω'}[DMM.mode],r:pointLabel(DMM.red),b:pointLabel(DMM.black),v:m.text});DMM.log=DMM.log.slice(0,14);renderDmmLog();}
  }
}
function renderDmmLog(){
  $('dmmLog').innerHTML=DMM.log.length?`<table class="logt"><tr><th>Circuit</th><th>Key</th><th>Plug</th><th>Fn</th><th>Red</th><th>Black</th><th>Reading</th></tr>${DMM.log.map(l=>`<tr><td>${l.c}</td><td>${l.k}</td><td>${l.conn}</td><td>${l.mode}</td><td style="white-space:normal">${l.r}</td><td style="white-space:normal">${l.b}</td><td class="v">${l.v}</td></tr>`).join('')}</table>`:'<p class="muted small">Each new lead placement or setting change is logged here so you can compare readings.</p>';
}

// ---------- mystery fault quiz ----------
function renderQuizBox(){
  const q=S.quiz;
  if(!q){$('dmmQuiz').innerHTML=`<b>Mystery fault</b><p style="margin:4px 0 8px">The simulator picks a random wiring or component fault and hides it. Read the code on the scan tool, then use the meter to find the cause.</p><button class="dark" onclick="startQuiz()">Start a mystery fault</button>${S.quizMsg?`<p>${S.quizMsg}</p>`:''}`;return;}
  const t=circuitType(q.cid);
  const opts=t==='F'?NETF.filter(n=>n.key!=='none').map(n=>[n.key,n.label]):C.find(c=>c.id===q.cid).faults.filter(fl=>ELECTRICAL[t].includes(fl.key)).map(fl=>[fl.key,fl.label]);
  $('dmmQuiz').innerHTML=`<b>Mystery fault active</b><p style="margin:4px 0">Hint: start with the scan tool (panel 4). The faulty circuit is already selected in the meter. What is wrong with the <b>${compName(q.cid)}</b> circuit?</p><select id="quizAns">${opts.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select> <button class="dark" onclick="checkQuiz()">Check my diagnosis</button> <button onclick="giveUpQuiz()">Reveal</button><p class="note">Tip: compare readings plugged in and unplugged, and at both ends of a wire.</p>`;
}
function startQuiz(){
  $('btnReset').click();
  const pool=[];C.forEach(c=>{const t=circuitType(c.id);if(!t)return;c.faults.forEach(fl=>{if(ELECTRICAL[t].includes(fl.key))pool.push([c.id,fl.key]);});});
  ['term','tcm','hl','hg'].forEach(k=>pool.push(['net',k]));
  const[cid,key]=pool[Math.floor(Math.random()*pool.length)];
  S.quiz={cid,key};S.quizMsg='';
  if(cid==='net')setNet(key);else setFault(cid,key);
  S.sel=null;$('explainBody').innerHTML='<p class="muted">Mystery fault active: explanations are hidden until you check your diagnosis.</p>';
  DMM.conn='on';setMeterCircuit(cid);DMM.mode='dcv';
  S.scanTab=cid==='net'?'net':'faults';S.scanSig='';
  renderDmmBar();refreshAll();showTab('scan');
}
function checkQuiz(){
  const q=S.quiz,a=$('quizAns').value;
  eng.dispatch({type:'submitDiagnosis',circuit:q.cid,location:'',kind:a});
  if(a===q.key){S.quizMsg=`<span class="ok"><b>Correct!</b></span> The fault was: ${quizLabel(q)}. Repair it in panel 1 (set it back to none), then clear the codes with the scan tool.`;S.quiz=null;}
  else{S.quizMsg=null;$('dmmQuiz').insertAdjacentHTML('beforeend','<p class="bad"><b>Not quite.</b> Check your readings again: compare what the module sees plugged in with what the harness reads unplugged.</p>');return;}
  refreshAll();renderQuizBox();
}
function giveUpQuiz(){const q=S.quiz;S.quizMsg=`The fault was: <b>${quizLabel(q)}</b>.`;S.quiz=null;refreshAll();renderQuizBox();}
function quizLabel(q){if(q.cid==='net')return NETF.find(n=>n.key===q.key).label;const c=C.find(x=>x.id===q.cid);return`${c.name}: ${c.faults.find(fl=>fl.key===q.key).label}`;}

// ===================== common codes =====================
const COMMON=[
 ['Engine',100,1,'Engine oil pressure low – most severe','Low oil level, worn bearings, oil pump or relief valve, fuel dilution. Verify with a mechanical gauge before replacing the sensor.','Red stop lamp; engine protection derate/shutdown.'],
 ['Engine',100,18,'Engine oil pressure low – moderately severe','Same causes as 100/1, less severe.','Warning level.'],
 ['Engine','100','3 / 4','Oil pressure sensor circuit high / low','Shorted signal, open ground, failed sensor, 5 V ref problem.','Circuit fault: the sensor reading is not trusted.'],
 ['Engine',110,0,'Coolant temperature high – most severe','Low coolant, fan clutch, thermostat, water pump, plugged radiator.','Red stop lamp; derate/shutdown.'],
 ['Engine','110','3 / 4','Coolant temperature sensor circuit high / low','Open circuit reads high (cold); short to ground reads low (hot).',''],
 ['Engine',111,1,'Coolant level low – most severe','Leak, overfilled/underfilled tank, level sensor fault.','Often paired with 110 codes.'],
 ['Engine','102','3 / 4','Intake manifold (boost) pressure sensor circuit high / low','Wiring, 5 V reference, sensor.','Derate.'],
 ['Engine','102','16 / 18','Boost higher / lower than expected','VGT or wastegate sticking (high); charge-air leak, turbo or air filter restriction (low).','FMI choice varies by OEM.'],
 ['Engine','157','3 / 4','Fuel rail pressure sensor circuit high / low','Wiring or sensor.',''],
 ['Engine','157','1 / 16 / 18','Fuel rail pressure low','Plugged filters, air in fuel, worn high-pressure pump, leaking injector returns or relief valve.','Detroit reports "rail pressure too low" as 157/16; others use 18 or 1.'],
 ['Engine',190,2,'Engine speed (crank) signal erratic','Damaged tone wheel, loose sensor, electrical noise.','Cummins-style crank code.'],
 ['Engine',190,0,'Engine overspeed','Downhill overspeed, missed shift, runaway.','Event code; check for a mechanical cause.'],
 ['Engine','636 / 637 / 723','2, 5, 7, 8','Engine position / timing / speed 2 sensors (cam & crank)','Sensor, wiring, tone wheel, gear-train timing (FMI 7 = cam/crank out of sync).','SPN assignment varies: Cummins crank 190 & cam 723; Detroit crank 636 & cam 723; Mack/Volvo crank 637 & cam 636.'],
 ['Engine','651–656',5,'Injector cylinder 1–6 circuit open','Open coil, broken wire in the under-cover harness, connector.','Cylinder misfire, power loss.'],
 ['Engine','651–656','6 / 3 / 4','Injector circuit shorted','Wire chafed to ground or to the other injector wire, shorted coil.','May shut down a whole driver bank.'],
 ['Engine','651–656',7,'Injector cylinder 1–6 mechanical / low contribution','Sticking or worn injector, low compression.','Confirm with a cylinder cutout and compression test.'],
 ['Engine',168,18,'Battery voltage low – moderately severe','Charging system, battery cables, weak batteries.',''],
 ['Engine',168,16,'Battery voltage high','Alternator regulator.',''],
 ['Engine','91','3 / 4','Accelerator pedal position sensor circuit','Pedal sensor, wiring, connector at the pedal.','Engine goes to idle or limp-home.'],
 ['Engine','3509–3514','3 / 4','Sensor supply voltage (5 V reference) 1–6 high / low','One shorted sensor or harness pulling down a shared 5 V reference.','Sets alongside several sensor codes at once. Unplug sensors on that reference one at a time.'],
 ['Engine',27,7,'EGR valve position: mechanical, not responding','Sticking/carboned EGR valve, actuator.','Common on EGR engines.'],
 ['Engine','641','7 / 12','VGT actuator: mechanical / bad smart device','Sticking vanes, failed smart actuator.','Low or high boost codes often follow.'],
 ['Engine',1569,31,'Engine protection torque derate active','Secondary code: another fault triggered the derate.','Fix the root-cause code first.'],
 ['Aftertreatment',3719,16,'DPF soot load moderately high','Missed or interrupted regens, short-trip duty, engine making soot.','Regen needed. FMI 0 = most severe (may need DPF removal).'],
 ['Aftertreatment','3251','0 / 16','DPF differential pressure high','Soot or ash loading, plugged DPF.',''],
 ['Aftertreatment','3251','3 / 4 / 2','DPF differential pressure sensor circuit / erratic','Cracked or plugged sensor hoses, wiring, sensor.','Check the hoses first.'],
 ['Aftertreatment','3216 / 3226',20,'Inlet / outlet NOx sensor drifted high','Aging sensor, exhaust leaks, DEF deposits; for outlet, real low SCR efficiency.','Compare inlet and outlet readings.'],
 ['Aftertreatment','3216 / 3226','9 / 2 / 12','NOx sensor communication / erratic / internal fault','Lost power or ground, CAN wiring to the smart sensor, failed sensor.',''],
 ['Aftertreatment',4364,18,'SCR conversion efficiency low','Poor DEF quality, doser problem, NOx sensor drift, failed SCR catalyst, exhaust leak.','Very common on 2010+ trucks; leads to inducement.'],
 ['Aftertreatment','1761','17 / 1','DEF tank level low / empty','Tank needs filling, or a level sensor fault.','Empty → inducement derate.'],
 ['Aftertreatment',5246,0,'SCR operator inducement active','Secondary code: an unresolved emissions fault has triggered an inducement.','Speed or power limit; fix the root code.'],
 ['Transmission','191','2 / 5 / 8','Output shaft speed sensor','Sensor, wiring, air gap, tone wheel.','Speedometer loss, gear hold/limp mode.'],
 ['Transmission','177','0 / 16 / 3 / 4','Transmission oil temperature high / sensor circuit','Low fluid, cooler restriction, retarder overuse; or wiring.',''],
 ['ABS','789–792',1,'Wheel speed sensor: excessive air gap (Bendix)','Sensor pushed back from the tone ring, bearing endplay, worn sleeve.','ABS lamp; push the sensor in and check output.'],
 ['ABS','789–792','5 / 6','Wheel speed sensor open / shorted (WABCO-style FMIs)','Broken wire near the wheel end, connector, sensor.','ABS lamp; ATC off.'],
 ['ABS','789–792','7 / 8','Wheel end problem / erratic signal (Bendix)','Damaged tone ring, loose sensor, wrong tire size.',''],
 ['ABS','627','3 / 4','ABS ECU supply voltage high / low','Corroded fuse/feed, poor ground, charging system.','ABS disabled until voltage recovers.'],
 ['ABS',629,12,'ABS controller internal fault','Failed ECU.','Verify power, ground and connectors before replacing.'],
 ['Network',639,'2 / 9 / 14 / 19','J1939 Network #1 (primary data link)','Shorted/open CAN wires, missing terminator, a module off the bus.','Example (Eaton TCM): FMI 2 = messages missing 1 s, FMI 9 = missing 5 s. Check 60 Ω at the 9-pin.'],
 ['Cluster','96','3 / 4','Fuel level sender circuit','Open sender or ground (3), wire chafed to frame (4).',''],
];
function renderCodes(){
  const q=($('codeSearch').value||'').toLowerCase().trim(),sys=$('codeSys').value;
  const rows=COMMON.filter(r=>(!sys||r[0]===sys)&&(!q||r.join(' ').toLowerCase().includes(q)));
  $('codeTable').innerHTML='<tr><th>System</th><th>SPN</th><th>FMI</th><th>Description</th><th>Common causes</th><th>Notes</th></tr>'+rows.map(r=>`<tr><td>${r[0]}</td><td class="mono"><b>${r[1]}</b></td><td class="mono"><b>${r[2]}</b></td><td>${r[3]}</td><td style="font-size:12.5px">${r[4]}</td><td style="font-size:12.5px" class="muted">${r[5]}</td></tr>`).join('')+(rows.length?'':'<tr><td colspan="6" class="muted">No match.</td></tr>');
}
$('codeSys').innerHTML+=[...new Set(COMMON.map(r=>r[0]))].map(s=>`<option>${s}</option>`).join('');
$('codeSearch').addEventListener('input',renderCodes);$('codeSys').addEventListener('change',renderCodes);

// ===================== explainer =====================
function renderExplain(){
  const s=S.sel;const out=$('explainBody');
  if(!s){return;}
  if(s.ecu==='net'&&S.quiz&&S.quiz.cid==='net'){out.innerHTML='<p class="muted">Mystery wiring fault: explanation hidden.</p>';return;}
  if(s.ecu==='net'){
    const n=NETF.find(x=>x.key===s.net);
    out.innerHTML=`<h3>Wiring fault: ${n.label}</h3><p>Look at the cluster, the service tool, the bus monitor and the meter readings. ${s.net==='hl'||s.net==='hg'?'With the backbone shorted, <b>no</b> module can talk. The engine keeps running on its own, but the cluster loses its gauges, the TCM goes to a default shift mode, and ABS keeps basic ABS but loses traction control. Each module stores <b>SPN 639</b> (J1939 Network #1) internally; you can only read those codes after the bus is repaired.':s.net==='tcm'?'Only the TCM drops off the bus. Its ETC1 frames stop, so the ECM can\'t calculate road speed and the <b>speedometer goes to dashes</b>. The ECM logs SPN 639 FMI 9 (abnormal update rate: the messages stopped arriving). The TCM logs SPN 639 too, but the tool can\'t read it until the stub is repaired.':'The bus usually still works with one terminator on a short truck harness, but it is out of spec. Intermittent communication faults are common.'}</p>
    <div class="box"><b>Typical codes:</b> SPN 639 J1939 Network #1, with FMI 2 (erratic), 9 (abnormal update rate: messages stopped), 14 or 19 depending on OEM. Example: an Eaton TCM sets SPN 639 FMI 2 when messages are missing for 1 s and FMI 9 after 5 s.</div>
    <div class="box"><b>How to diagnose:</b><ol><li>Key off: measure C–D at the 9-pin. 60 Ω good, ≈120 Ω one terminator missing or backbone open, ≈0 Ω H–L short.</li><li>Measure C to ground and D to ground: they should be open (no continuity).</li><li>Key on: CAN-H ≈ 2.5–3.0 V, CAN-L ≈ 2.0–2.5 V to ground.</li><li>Unplug modules one at a time; if communication returns, that module or its stub is the problem.</li><li>Use a scope on CAN-H and CAN-L for intermittent problems.</li></ol></div>`;
    return;
  }
  let d=null,c=null,f=null;
  d=S.dtc[s.ecu].find(x=>x.spn===s.spn&&x.fmi===s.fmi)||S.prev[s.ecu].find(x=>x.spn===s.spn&&x.fmi===s.fmi);
  if(!d){out.innerHTML='<p class="muted">That code is no longer stored.</p>';return;}
  if(d.cid){c=C.find(x=>x.id===d.cid);f=c.faults.find(x=>x.key===d.fkey);}
  if(quizHides(d)){const e2=ECUS[s.ecu];out.innerHTML=`<h3>SA ${e2.sa} (${e2.name}) · SPN ${d.spn} FMI ${d.fmi}</h3><p><b>SPN ${d.spn}</b> = ${spnName(d.spn)}. <b>FMI ${d.fmi}</b> = ${FMI[d.fmi]}.</p><p class="muted">Mystery mode: causes and readings are hidden. Use the multimeter (panel 5) to find the fault, then check your diagnosis.</p>`;return;}
  const e=ECUS[s.ecu];
  if(d.spn===639){out.innerHTML=`<h3>SA ${e.sa} (${e.name}) · SPN 639 FMI ${d.fmi}</h3><p><b>SPN 639</b> = J1939 Network #1 (primary vehicle network). <b>FMI ${d.fmi}</b> = ${FMI[d.fmi]}. This module stopped receiving messages it needs. Check the network wiring (Network wiring tab and the meter readings).</p>`;return;}
  const b=dtcBytes(d);
  const lamps=[d.lamps.includes('R')?'<b style="color:#e03131">Red stop lamp</b>':'',d.lamps.includes('A')?'<b style="color:#e67700">Amber warning lamp</b>':'',d.lamps.includes('M')?'<b style="color:#e67700">MIL</b> (emissions-related)':'',s.ecu==='abs'?'<b style="color:#e67700">ABS lamp</b>':''].filter(Boolean).join(' + ');
  const kind=f.cond?'<b>Real-condition fault</b>: the sensor and wiring are fine; the system really is out of range. Verify it with an independent measurement before replacing parts.':[3,4,5,6].includes(d.fmi)?'<b>Circuit fault</b>: the module saw an electrical value that can\'t be valid, so suspect the sensor, connector or wiring first. The module stops trusting the signal, sends the 0xFE error indicator on the bus instead of a value, and uses a default.':d.fmi===9?'<b>Communication fault</b>: the data stopped arriving.':'<b>Signal plausibility fault</b>: the signal is in range electrically but doesn\'t make sense.';
  out.innerHTML=`<h3>SA ${e.sa} (${e.name}) · SPN ${d.spn} FMI ${d.fmi} · OC ${d.oc}</h3>
  <div class="kv"><div>SPN ${d.spn}</div><div>${c.spnName}: <b>${c.name}</b></div>
  <div>FMI ${d.fmi}</div><div>${FMI[d.fmi]}</div>
  <div>What the module saw</div><div>${f.reading}</div>
  <div>Lamps</div><div>${lamps}</div>
  <div>Status</div><div>${d.status!=='inactive'?'Active: broadcast in DM1 once per second':'Previously active (inactive): stored, read with DM2'}</div></div>
  <div class="box">${kind}</div>
  <div class="box"><b>Typical effect on the truck:</b> ${f.effect}</div>
  <div class="row r2" style="gap:10px"><div class="box"><b>Likely causes</b><ul>${(f.causes||[]).map(x=>`<li>${x}</li>`).join('')}</ul></div>
  <div class="box"><b>How to diagnose</b><ol>${(f.steps||[]).map(x=>`<li>${x}</li>`).join('')}</ol></div></div>
  ${f.note?`<p class="note">${f.note}</p>`:''}
  <div class="box"><b>How this code travels in DM1 (PGN 65226, ID 18FECA${hex(e.sa,2)}):</b>
  <div class="dtcbytes"><div>Byte 3<b>${hex(b[0],2)}</b>SPN bits 1–8</div><div>Byte 4<b>${hex(b[1],2)}</b>SPN bits 9–16</div><div>Byte 5<b>${hex(b[2],2)}</b>${bin(b[2],8).slice(0,3)} = SPN bits 17–19 · ${bin(b[2],8).slice(3)} = FMI ${d.fmi}</div><div>Byte 6<b>${hex(b[3],2)}</b>bit 8 = CM 0 · OC ${d.oc}</div></div>
  SPN = 0x${hex(b[0],2)} + 0x${hex(b[1],2)} × 256 = ${d.spn}. If a module has two or more active codes, its DM1 is longer than 8 bytes and is sent with the transport protocol (TP.CM BAM + TP.DT); look for 1CECFF${hex(e.sa,2)} in the bus monitor.</div>
  <p class="note">Fault codes are often written SA/SPN/FMI, for example ${e.sa}/${d.spn}/${d.fmi}. FMIs and lamp behavior vary by OEM and model year; always confirm with the OEM troubleshooting manual.</p>`;
}

// ===================== FMI table =====================
$('fmiTable').innerHTML='<tr><th>FMI</th><th>Meaning</th><th>Typical cause type</th></tr>'+Object.entries(FMI).map(([k,v])=>{const t={0:'real condition (most severe)',1:'real condition (most severe)',2:'signal plausibility / intermittent',3:'circuit',4:'circuit',5:'circuit (open)',6:'circuit (short/grounded)',7:'mechanical',8:'signal frequency',9:'communication (message missing)',10:'signal changing too fast',11:'unknown',12:'smart device / module internal',13:'calibration',14:'OEM-specific',15:'real condition (least severe)',16:'real condition (moderate)',17:'real condition (least severe)',18:'real condition (moderate)',19:'network data error',20:'sensor drift',21:'sensor drift',31:'condition / event'}[k];return`<tr><td class="mono"><b>${k}</b></td><td>${v}</td><td class="muted">${t}</td></tr>`;}).join('');

// ===================== main loop =====================
function refreshAll(){renderDiagram();renderFaultPanel();renderCluster();renderToolCodes();renderDmm();if(DMM.level>=3&&typeof hRenderAll==='function'){hRenderTop();hRenderMeterBar();hRenderReading();}}
let lastT=performance.now(),uiAcc=0,pktAcc=0,lastDtcSig='';
function dtcSignature(){return MODKEYS.map(e=>{const m=eng.module(e);return e+m.dtcs('pending').concat(m.dtcs('active')).map(d=>d.spn+'/'+d.fmi+d.status).join()+'|'+m.dtcs('previous').length;}).join(';');}
function tick(now){
  const dt=Math.min(100,now-lastT);lastT=now;
  if(!S.paused){
    eng.advance(dt*S.speed);uiAcc+=dt;pktAcc+=dt*S.speed;
    const sig=dtcSignature();
    if(sig!==lastDtcSig){lastDtcSig=sig;refreshAll();renderExplain();}
    if(S.regen==='running'&&eng.outputs.acm.regenActiveSinceMs===null){S.regen=null;toolLog('Parked regen complete: soot load back to normal, DPF ΔP normal. The 3251 code goes inactive.');}
    if(S.clearCheckAt&&eng.timeMs>=S.clearCheckAt){S.clearCheckAt=null;const n=eng.scan.activeCodes().length;if(n)toolLog(`${n} code(s) came straight back: the fault is still present, so the module detects it again after clearing. Repair first, then clear.`);}
    if(uiAcc>250){updateMonitor();renderDiagram();renderCluster();refreshPanelLive();renderToolCodes();if(S.curTab==='meter')renderDmmReading();updateCtrlUI();uiAcc=0;}
    if(pktAcc>220){spawnPacket();pktAcc=0;}
  }
  requestAnimationFrame(tick);
}
$('speed').onchange=e=>S.speed=+e.target.value;
$('btnPause').onclick=()=>{S.paused=!S.paused;$('btnPause').textContent=S.paused?'Resume':'Pause';};
$('btnReset').onclick=()=>{eng.resetTruck();DMM.conn='on';S.sel=null;S.prevShown=false;S.dm2=[];S.toolLog=[];S.quiz=null;S.cutout=null;S.regen=null;S.scanSel=null;S.scanFF=null;S.scanSig='';MON.clear();$('explainBody').innerHTML='<p class="muted">Inject a fault, then click its code to see it explained.</p>';refreshAll();};

// ===================== harness levels (3D) =====================
DMM.level=1;
const HW={D:[['hi','High side','#e6e6e6'],['lo','Low side','#3f76d6']],A:[['ref','5 V ref','#ff3b30'],['sig','Signal','#f5a623'],['ret','Return','#9aa0a6']],B:[['sig','Signal','#f5a623'],['ret','Return','#9aa0a6']],C:[['a','Signal +','#f5a623'],['b','Signal −','#9aa0a6']],H:[['sig','Signal','#f5a623'],['ret','Sender return','#9aa0a6']]};
const COMPLAINT={thr:'Low power and black smoke, MIL on',egr:'Rough idle at times, MIL on',vgt:'Low power, slow to build boost, MIL on',inj1:'Misfire, rough idle, check-engine lamp on',inj2:'Misfire, rough idle, check-engine lamp on',inj3:'Misfire, rough idle, check-engine lamp on',inj4:'Misfire, rough idle, check-engine lamp on',inj5:'Misfire, rough idle, check-engine lamp on',inj6:'Misfire, rough idle, check-engine lamp on',map:'Low power, check-engine (MIL) lamp on',oilp:'Oil pressure gauge dead, amber lamp on',rail:'Low power and hard starting',ect:'Coolant gauge reads wrong, fan runs all the time',crank:'Rough running, stalls at times',cam:'Long crank before starting',wlf:'ABS lamp on',wlr:'ABS lamp on, traction control light flashing',wrr:'ABS lamp on',fuel:'Fuel gauge not working',def:'DEF gauge reads wrong, MIL on',wrf:'ABS lamp on after a rough road',app:'Engine stays at idle when the pedal is pressed, check-engine lamp on',oss:'Speedometer drops out, transmission holds a gear',tot:'Transmission temperature gauge reads wrong',iss:'Harsh shifts, transmission service lamp on',airp:'Primary air gauge reads wrong, low-air warning comes and goes',airs:'Secondary air gauge reads wrong, low-air buzzer at times',amb:'Outside temperature display shows dashes',deft:'MIL on, DEF warning after a cold night'};
// Engine (L3): every ECM circuit leaves J1 in one main bundle (HTRUNK) and breaks out to its own inline connector.
// Front bundle F1→F2, rear bundle R1→R7 (along the block, up the rear corner, over the rear gear housing to the right side).
const INJT=[[-0.52,1.05,0.17],...[0,1,2,3,4,5,6,7,8,9,10].map(k=>[+(-0.41+k*0.094).toFixed(3),1.05,0.17])];
const F1=[0.14,0.725,0.465],F2=[0.36,0.765,0.48],R0=[-0.02,0.745,0.47],R1=[-0.12,0.735,0.46],R2=[-0.38,0.745,0.462],R3=[-0.53,0.79,0.47],R4=[-0.60,0.92,0.46],R5=[-0.62,1.05,0.40],R6=[-0.70,1.08,0.20],R7=[-0.71,1.085,0.0];
const ECMJ1=(pins)=>({id:'J1',name:'ECM engine harness connector',pos:[0.05,0.64,0.385],pins});
const ABSJ1=(pins)=>({id:'J1',name:'ABS ECU connector',pos:[-1.25,0.995,0.53],pins});
const HROUTES={
 3:[
  {cid:'map',module:'Engine ECM',comp:'Boost (MAP) sensor',modPos:[0.05,0.48,0.355],nodes:[ECMJ1(['12','27','33']),{id:'X1',name:'Inline connector X1 (front of intake manifold)',pos:[0.28,0.815,0.468]},{id:'C1',name:'Boost sensor connector',pos:[0.25,1.03,0.41]}],
   segs:[{name:'ECM → X1, main engine harness (front branch)',via:[F1,[0.21,0.79,0.48]]},{name:'X1 → up the intake manifold',via:[[0.33,0.89,0.462],[0.31,0.97,0.45]]}],compPos:[0.25,0.975,0.37]},
  {cid:'oilp',module:'Engine ECM',comp:'Oil pressure sensor',modPos:[0.05,0.48,0.355],nodes:[ECMJ1(['8','14','33']),{id:'X1',name:'Inline connector X1 (front left of block)',pos:[0.32,0.585,0.44]},{id:'C1',name:'Oil pressure sensor connector',pos:[0.42,0.35,0.38]}],
   segs:[{name:'ECM → X1, main engine harness (front branch)',via:[F1,[0.24,0.665,0.462]]},{name:'X1 → oil pressure sensor, behind the alternator',via:[[0.40,0.46,0.42]]}],compPos:[0.42,0.31,0.335]},
  {cid:'rail',module:'Engine ECM',comp:'Rail pressure sensor',modPos:[0.05,0.48,0.355],nodes:[ECMJ1(['12','41','33']),{id:'X1',name:'Inline connector X1 (above the fuel pump units)',pos:[-0.33,0.67,0.445]},{id:'C1',name:'Rail pressure sensor connector',pos:[-0.53,0.81,0.39]}],
   segs:[{name:'ECM → X1, main engine harness (rear branch)',via:[R0,R1,[-0.24,0.70,0.452]]},{name:'X1 → rear end of the common rail',via:[[-0.44,0.70,0.43],[-0.50,0.75,0.42]]}],compPos:[-0.52,0.765,0.355]},
  {cid:'ect',module:'Engine ECM',comp:'Coolant temp sensor',modPos:[0.05,0.48,0.355],nodes:[ECMJ1(['21','47']),{id:'X1',name:'Inline connector X1 (right rear, on the gear housing)',pos:[-0.69,1.065,-0.33]},{id:'C1',name:'Coolant temp sensor connector',pos:[-0.60,0.74,-0.40]}],
   segs:[{name:'ECM → X1: main harness along the block, up and over the rear gear housing',via:[R0,R1,R2,R3,R4,R5,R6,R7,[-0.70,1.07,-0.18]]},{name:'X1 → down the right rear of the block',via:[[-0.68,0.95,-0.42]]}],compPos:[-0.57,0.71,-0.33]},
  {cid:'crank',module:'Engine ECM',comp:'Crank speed sensor',modPos:[0.05,0.48,0.355],nodes:[ECMJ1(['18','19']),{id:'X1',name:'Inline connector X1 (rear left of block)',pos:[-0.58,0.50,0.45]},{id:'C1',name:'Crank sensor connector',pos:[-0.82,0.27,0.50]}],
   segs:[{name:'ECM → X1, main harness then down the lower block',via:[R0,R1,[-0.20,0.60,0.475],[-0.45,0.53,0.47]]},{name:'X1 → flywheel housing',via:[[-0.74,0.40,0.49]]}],compPos:[-0.82,0.21,0.43]},
  {cid:'cam',module:'Engine ECM',comp:'Cam speed sensor',modPos:[0.05,0.48,0.355],nodes:[ECMJ1(['24','25']),{id:'X1',name:'Inline connector X1 (rear left corner)',pos:[-0.63,0.80,0.51]},{id:'C1',name:'Cam sensor connector',pos:[-0.69,0.99,0.43]}],
   segs:[{name:'ECM → X1, main engine harness (rear branch)',via:[R0,R1,R2,R3,[-0.585,0.78,0.50]]},{name:'X1 → rear gear housing',via:[[-0.67,0.90,0.50]]}],compPos:[-0.70,0.93,0.39]},
  {cid:'thr',module:'Engine ECM',comp:'Intake throttle actuator',modPos:[0.05,0.48,0.355],nodes:[ECMJ1(['12','35','33']),{id:'X1',name:'Inline connector X1 (front left, below the throttle)',pos:[0.42,0.835,0.478]},{id:'C1',name:'Throttle actuator connector',pos:[0.47,1.10,0.40]}],
   segs:[{name:'ECM → X1, main engine harness (front branch)',via:[F1,F2]},{name:'X1 → up beside the air inlet to the throttle',via:[[0.46,0.95,0.47]]}],compPos:[0.47,1.022,0.37]},
  {cid:'egr',module:'Engine ECM',comp:'EGR valve actuator',modPos:[0.05,0.48,0.355],nodes:[ECMJ1(['12','37','33']),{id:'X1',name:'Inline connector X1 (front left corner of block)',pos:[0.55,0.74,0.465]},{id:'C1',name:'EGR valve connector',pos:[0.62,1.30,-0.26]}],
   segs:[{name:'ECM → X1, main engine harness (front branch)',via:[F1,F2,[0.45,0.755,0.476]]},{name:'X1 → across the front of the head → EGR valve',via:[[0.60,0.86,0.47],[0.585,0.99,0.455],[0.55,1.13,0.33],[0.60,1.235,0.12],[0.62,1.255,-0.08]]}],compPos:[0.60,1.222,-0.30]},
  {cid:'vgt',module:'Engine ECM',comp:'VGT actuator',modPos:[0.05,0.48,0.355],nodes:[ECMJ1(['8','39','33']),{id:'X1',name:'Inline connector X1 (top of rear gear housing)',pos:[-0.72,1.14,-0.19]},{id:'X2',name:'Inline connector X2 (behind the turbo)',pos:[-0.58,1.25,-0.38]},{id:'C1',name:'VGT actuator connector',pos:[-0.34,1.31,-0.50]}],
   segs:[{name:'ECM → X1: main harness along the block, up and over the rear gear housing',via:[R0,R1,R2,R3,R4,R5,R6,R7,[-0.72,1.12,-0.08]]},{name:'X1 → X2, across the top of the rear housing',via:[[-0.68,1.20,-0.27]]},{name:'X2 → turbo actuator (hot zone)',via:[[-0.45,1.29,-0.45]]}],compPos:[-0.30,1.217,-0.52]},
 ],
 4:[
  {cid:'wlr',module:'ABS ECU',comp:'LR wheel speed sensor',modPos:[-1.25,0.88,0.49],nodes:[ABSJ1(['4','5']),{id:'X1',name:'Inline connector X1 (left rail, behind the fuel tank)',pos:[-2.2,1.04,0.495]},{id:'X2',name:'Inline connector X2 (suspension hanger)',pos:[-3.62,1.0,0.53]},{id:'C1',name:'LR sensor connector',pos:[-3.95,0.64,0.72]}],
   segs:[{name:'ABS ECU → X1, outside of the left frame rail',via:[[-1.45,1.04,0.50],[-1.85,1.04,0.495]]},{name:'Left rail → suspension hanger',via:[[-2.6,1.04,0.495],[-3.3,1.035,0.495]]},{name:'Axle housing → wheel end',via:[[-3.78,0.92,0.58],[-3.88,0.80,0.64]]}],compPos:[-4.0,0.55,0.79]},
  {cid:'wrr',module:'ABS ECU',comp:'RR wheel speed sensor',modPos:[-1.25,0.88,0.49],nodes:[ABSJ1(['6','7']),{id:'X1',name:'Inline connector X1 (left rail, behind the fuel tank)',pos:[-2.2,1.04,0.495]},{id:'X2',name:'Inline connector X2 (suspension hanger)',pos:[-3.62,1.0,-0.53]},{id:'C1',name:'RR sensor connector',pos:[-3.95,0.64,-0.72]}],
   segs:[{name:'ABS ECU → X1, outside of the left frame rail',via:[[-1.45,1.04,0.50],[-1.85,1.04,0.495]]},{name:'Over the crossmember → right rail → hanger',via:[[-2.6,1.04,0.495],[-2.64,1.14,0.49],[-2.68,1.135,0.40],[-2.70,1.08,0.22],[-2.70,1.08,-0.22],[-2.72,1.135,-0.40],[-2.76,1.14,-0.49],[-2.86,1.03,-0.495],[-3.3,1.03,-0.495]]},{name:'Axle housing → wheel end',via:[[-3.78,0.92,-0.58],[-3.88,0.80,-0.64]]}],compPos:[-4.0,0.55,-0.79]},
  {cid:'wlf',module:'ABS ECU',comp:'LF wheel speed sensor',modPos:[-1.25,0.88,0.49],nodes:[ABSJ1(['1','2']),{id:'X1',name:'Inline connector X1 (left rail, under the cab)',pos:[0.5,0.97,0.495]},{id:'X2',name:'Inline connector X2 (front of the left rail)',pos:[2.25,0.97,0.50]},{id:'C1',name:'LF sensor connector',pos:[2.3,0.72,0.74]}],
   segs:[{name:'ABS ECU → X1, outside of the left frame rail',via:[[-1.05,1.04,0.50],[-0.65,1.04,0.495],[-0.2,1.03,0.495]]},{name:'Left rail forward, beside the engine',via:[[1.0,0.95,0.495],[1.5,0.95,0.495],[1.9,0.955,0.495]]},{name:'Front of rail → steer knuckle',via:[[2.42,0.96,0.50],[2.47,0.87,0.60],[2.40,0.79,0.69]]}],compPos:[2.2,0.55,0.81]},
  {cid:'fuel',module:'Instrument cluster',comp:'Fuel level sender',modPos:[0.75,1.95,0.45],nodes:[{id:'J1',name:'Cluster connector',pos:[0.70,1.85,0.45],pins:['9','10']},{id:'X1',name:'Cab bulkhead connector (floor)',pos:[0.40,1.30,0.50]},{id:'X2',name:'Frame rail inline connector',pos:[-0.62,1.11,0.495]},{id:'C1',name:'Fuel sender connector',pos:[-1.0,1.04,0.80]}],
   segs:[{name:'Dash harness → cab floor',via:[[0.62,1.6,0.47],[0.5,1.4,0.48]]},{name:'Bulkhead → outside of the left frame rail',via:[[0.30,1.18,0.51],[0.05,1.11,0.495],[-0.3,1.11,0.495]]},{name:'Frame rail → fuel tank sender',via:[[-0.78,1.11,0.52],[-0.9,1.08,0.66]]}],compPos:[-1.0,0.985,0.87]},
  {cid:'def',module:'Aftertreatment ACM',comp:'DEF level sensor',modPos:[-1.9,0.88,-0.49],nodes:[{id:'J1',name:'ACM connector',pos:[-1.9,0.995,-0.53],pins:['3','11','17']},{id:'X1',name:'Inline connector X1 (outside of the right rail)',pos:[-1.1,1.03,-0.495]},{id:'X2',name:'DEF tank bracket connector X2',pos:[-0.80,1.02,-0.60]},{id:'C1',name:'DEF sender connector',pos:[-0.67,0.98,-0.80]}],
   segs:[{name:'ACM → X1, outside of the right rail',via:[[-1.75,1.03,-0.50],[-1.4,1.03,-0.495]]},{name:'X1 → DEF tank bracket',via:[[-0.95,1.03,-0.50]]},{name:'Tank bracket → DEF sender',via:[[-0.70,1.0,-0.70]]}],compPos:[-0.67,0.94,-0.82]},
  {cid:'wrf',module:'ABS ECU',comp:'RF wheel speed sensor',modPos:[-1.25,0.88,0.49],nodes:[ABSJ1(['8','9']),{id:'X1',name:'Inline connector X1 (left rail, under the cab)',pos:[0.5,0.97,0.495]},{id:'X2',name:'Inline connector X2 (front of the right rail)',pos:[2.5,0.96,-0.58]},{id:'C1',name:'RF sensor connector',pos:[2.3,0.72,-0.74]}],
   segs:[{name:'ABS ECU → X1, outside of the left frame rail',via:[[-1.05,1.04,0.50],[-0.65,1.04,0.495],[-0.2,1.03,0.495]]},{name:'Left rail forward, across the front of the frame to the right rail',via:[[1.0,0.95,0.495],[1.9,0.955,0.495],[2.5,0.98,0.50],[2.52,1.14,0.51],[2.56,1.15,0.40],[2.56,1.15,-0.40],[2.52,1.14,-0.53],[2.53,1.06,-0.57]]},{name:'Front of right rail → steer knuckle',via:[[2.46,0.87,-0.64],[2.40,0.79,-0.70]]}],compPos:[2.2,0.55,-0.81]},
  {cid:'airp',module:'Instrument cluster',comp:'Primary air pressure sensor',modPos:[0.75,1.95,0.45],nodes:[{id:'J1',name:'Cluster connector',pos:[0.70,1.85,0.45],pins:['3','4','5']},{id:'X1',name:'Cab bulkhead connector (floor)',pos:[0.40,1.30,0.50]},{id:'X2',name:'Air tank harness connector (left rail, behind the fuel tank)',pos:[-1.95,0.92,0.53]},{id:'C1',name:'Primary air sensor connector',pos:[-2.30,1.12,0.72]}],
   segs:[{name:'Dash harness → cab floor',via:[[0.62,1.6,0.47],[0.5,1.4,0.48]]},{name:'Bulkhead → outside of the left rail, back past the fuel tank',via:[[0.30,1.18,0.51],[0.05,1.11,0.495],[-0.3,1.11,0.495],[-1.0,1.11,0.495],[-1.62,1.08,0.50],[-1.80,0.97,0.52]]},{name:'X2 → primary (upper) air tank',via:[[-2.10,0.98,0.56],[-2.20,1.08,0.66]]}],compPos:[-2.30,1.03,0.72]},
  {cid:'airs',module:'Instrument cluster',comp:'Secondary air pressure sensor',modPos:[0.75,1.95,0.45],nodes:[{id:'J1',name:'Cluster connector',pos:[0.70,1.85,0.45],pins:['3','6','5']},{id:'X1',name:'Cab bulkhead connector (floor)',pos:[0.40,1.30,0.50]},{id:'X2',name:'Air tank harness connector (left rail, behind the fuel tank)',pos:[-1.95,0.92,0.53]},{id:'C1',name:'Secondary air sensor connector',pos:[-2.30,0.58,0.98]}],
   segs:[{name:'Dash harness → cab floor',via:[[0.62,1.6,0.47],[0.5,1.4,0.48]]},{name:'Bulkhead → outside of the left rail, back past the fuel tank',via:[[0.30,1.18,0.51],[0.05,1.11,0.495],[-0.3,1.11,0.495],[-1.0,1.11,0.495],[-1.62,1.08,0.50],[-1.80,0.97,0.52]]},{name:'X2 → down to the secondary (lower) air tank',via:[[-2.04,0.88,0.62],[-2.06,0.80,0.92],[-2.18,0.66,0.98]]}],compPos:[-2.30,0.58,0.89]},
  {cid:'amb',module:'Instrument cluster',comp:'Ambient air temp sensor',modPos:[0.75,1.95,0.45],nodes:[{id:'J1',name:'Cluster connector',pos:[0.70,1.85,0.45],pins:['11','12']},{id:'X1',name:'Firewall pass-through (front of cab, left)',pos:[0.98,1.42,0.56]},{id:'X2',name:'Front harness connector (front of the left rail)',pos:[2.45,1.06,0.57]},{id:'C1',name:'Ambient sensor connector (behind the bumper)',pos:[3.0,0.97,0.80]}],
   segs:[{name:'Dash harness → firewall',via:[[0.80,1.75,0.48],[0.92,1.55,0.54]]},{name:'Hood harness along the top of the left rail',via:[[1.10,1.20,0.55],[1.4,1.07,0.56],[2.0,1.06,0.56]]},{name:'Front of rail → behind the bumper',via:[[2.75,1.10,0.66],[2.95,1.02,0.76]]}],compPos:[3.07,0.94,0.80]},
  {cid:'deft',module:'Aftertreatment ACM',comp:'DEF tank temp sensor',modPos:[-1.9,0.88,-0.49],nodes:[{id:'J1',name:'ACM connector',pos:[-1.9,0.995,-0.53],pins:['5','13']},{id:'X1',name:'Inline connector X1 (outside of the right rail)',pos:[-1.1,1.03,-0.495]},{id:'X2',name:'DEF tank bracket connector X2',pos:[-0.80,1.02,-0.60]},{id:'C1',name:'DEF temp sensor connector',pos:[-0.56,0.98,-0.70]}],
   segs:[{name:'ACM → X1, outside of the right rail',via:[[-1.75,1.03,-0.50],[-1.4,1.03,-0.495]]},{name:'X1 → DEF tank bracket',via:[[-0.95,1.03,-0.50]]},{name:'Tank bracket → DEF tank header',via:[[-0.66,1.01,-0.66]]}],compPos:[-0.56,0.94,-0.71]},
  {cid:'oss',module:'Transmission TCM',comp:'Output shaft speed sensor',modPos:[-0.15,0.98,0.49],nodes:[{id:'J1',name:'TCM connector',pos:[-0.15,1.095,0.53],pins:['21','22']},{id:'X1',name:'Transmission harness connector (inside the left rail)',pos:[0.30,1.17,0.36]},{id:'C1',name:'Output speed sensor connector',pos:[0.08,1.10,0.29]}],
   segs:[{name:'TCM → over the left rail to the transmission',via:[[-0.05,1.16,0.50],[0.10,1.18,0.44]]},{name:'X1 → rear of the transmission (output)',via:[[0.16,1.15,0.32]]}],compPos:[0.08,1.08,0.22]},
  {cid:'iss',module:'Transmission TCM',comp:'Input shaft speed sensor',modPos:[-0.15,0.98,0.49],nodes:[{id:'J1',name:'TCM connector',pos:[-0.15,1.095,0.53],pins:['23','24']},{id:'X1',name:'Transmission harness connector (inside the left rail)',pos:[0.30,1.17,0.36]},{id:'C1',name:'Input speed sensor connector',pos:[0.70,1.26,0.29]}],
   segs:[{name:'TCM → over the left rail to the transmission',via:[[-0.05,1.16,0.50],[0.10,1.18,0.44]]},{name:'X1 → front of the transmission (input)',via:[[0.50,1.22,0.33]]}],compPos:[0.70,1.24,0.22]},
  {cid:'tot',module:'Transmission TCM',comp:'Trans oil temp sensor',modPos:[-0.15,0.98,0.49],nodes:[{id:'J1',name:'TCM connector',pos:[-0.15,1.095,0.53],pins:['31','32']},{id:'X1',name:'Transmission harness connector (inside the left rail)',pos:[0.30,1.17,0.36]},{id:'C1',name:'Oil temp sensor connector',pos:[0.45,1.04,0.29]}],
   segs:[{name:'TCM → over the left rail to the transmission',via:[[-0.05,1.16,0.50],[0.10,1.18,0.44]]},{name:'X1 → lower side of the transmission (sump)',via:[[0.40,1.10,0.33]]}],compPos:[0.45,1.00,0.22]},
  {cid:'app',module:'Engine ECM',comp:'Accelerator pedal sensor',eng:true,modPos:[1.70,1.28,0.355],nodes:[{id:'J1',name:'ECM engine harness connector',pos:[1.70,1.44,0.385],pins:['22','30','31']},{id:'X1',name:'Firewall bulkhead connector (engine side)',pos:[1.0,1.70,0.56]},{id:'C1',name:'Pedal sensor connector (cab floor)',pos:[0.84,1.52,0.62]}],
   segs:[{name:'ECM → back along the engine to the firewall',via:[[1.62,1.60,0.50],[1.25,1.70,0.56]]},{name:'Firewall → behind the dash → pedal',via:[[0.93,1.63,0.60]]}],compPos:[0.80,1.45,0.62]},
 ]};
for(let i=1;i<=6;i++){const xi=0.47-(i-1)*0.188;HROUTES[3].push({cid:'inj'+i,module:'Engine ECM',comp:`Injector ${i} (cylinder ${i})`,modPos:[0.05,0.48,0.355],under:['s2','c2','comp'],
  nodes:[ECMJ1([String(47+i*2),String(48+i*2)]),{id:'X1',name:'Valve cover pass-through connector',pos:[-0.57,1.02,0.33]},{id:'C1',name:`Injector ${i} connector`,pos:[xi,1.075,0.075]}],
  segs:[{name:'ECM → valve cover pass-through, main engine harness',via:[R0,R1,R2,R3,R4,[-0.585,0.99,0.40]]},{name:`Under the valve cover: injector harness → injector ${i}`,via:[...INJT.filter(q=>q[0]<=xi+0.061),[xi+0.02,1.068,0.135]]}],compPos:[xi,1.04,0.0]});}
// shared bundles: drawn once, thicker; each circuit runs inside its bundle until it breaks out
const HTRUNK={3:[{cid:'map',j:0,r:0.0135,pts:[F1,F2]},{cid:'rail',j:0,r:0.0135,pts:[R0,R1,R2,R3,R4,R5,R6,R7]},{cid:'inj1',j:1,r:0.0135,pts:INJT}],
 4:[{cid:'wlr',j:0,r:0.021,pts:[]},{cid:'wlr',j:1,r:0.021,pts:[[-2.6,1.04,0.495]]}]};
// protective coverings: heat-reflective sleeve near the turbo / exhaust / EGR, spring guard at the wheel ends, abrasion sleeve over the crossmember
const SLEEVE={3:{vgt:{3:'heat'},egr:{2:'heat'},ect:{2:'heat'}},4:{wlr:{3:'guard'},wrr:{2:'wear',3:'guard'},wlf:{3:'guard'},wrf:{2:'wear',3:'guard'}}};
for(const l in SLEEVE)HROUTES[l].forEach(rt=>{const sv=SLEEVE[l][rt.cid];if(sv)for(const k in sv)rt.segs[k-1].sleeve=sv[k];});
// Level 4 also gets the engine circuits: same routes as level 3, moved to where the engine sits between the frame rails
const ENG_OFF=[1.65,0.80,0],engOff=q=>[+(q[0]+ENG_OFF[0]).toFixed(3),+(q[1]+ENG_OFF[1]).toFixed(3),q[2]];
['map','oilp','rail','ect','crank','cam','thr','egr','vgt'].forEach(cid=>{const r=HROUTES[3].find(x=>x.cid===cid);
  HROUTES[4].push(Object.assign({},r,{eng:true,modPos:engOff(r.modPos),compPos:engOff(r.compPos),nodes:r.nodes.map(nd=>Object.assign({},nd,{pos:engOff(nd.pos)})),segs:r.segs.map(sg=>Object.assign({},sg,{via:sg.via.map(engOff)}))}));});
HTRUNK[3].filter(tk=>!tk.cid.startsWith('inj')).forEach(tk=>HTRUNK[4].push({cid:tk.cid,j:tk.j,r:tk.r,pts:tk.pts.map(engOff)}));
HROUTES[5]=HROUTES[4];HTRUNK[5]=HTRUNK[4];
function hSegTrunk(lvl,rt,i){const sg=rt.segs[i];if(!sg||!sg.via[0])return null;for(const tk of (HTRUNK[lvl]||[])){if(!tk.pts.length)continue;const a=HROUTES[lvl].find(r=>r.cid===tk.cid);if(i===tk.j&&a.nodes[tk.j].pos.join()===rt.nodes[i].pos.join()&&sg.via[0].join()===tk.pts[0].join())return tk;}return null;}
// ---------- mechanical faults (wiring and sensor test good) ----------
// checks: [id, label, minutes, normal result, result when an electrical fault is present (optional)]
// MCHK and MFAULT (mechanical checks and faults) now come from the engine's data tables.
function hMechKey(cid){return cid.startsWith('inj')?'inj':cid[0]==='w'?'wss':(cid==='airp'||cid==='airs')?'air':cid;}
function hCheckResult(id){return eng.dispatch({type:'inspect',circuit:HX.job.route.cid,check:id}).text;}
function hRunCheck(id){if(!HX.mchk)HX.mchk=new Set();const c=MCHK[hMechKey(HX.job.route.cid)].find(x=>x[0]===id);HX.mchk.add(id);hAddTime(c?c[2]:5);hRenderSection();}
function hMechHTML(){const j=HX.job,L=MCHK[hMechKey(j.route.cid)];if(!L)return'';if(!HX.mchk)HX.mchk=new Set();
  return`<div class="pinrow"><div class="lab">Mechanical &amp; system checks · use these to rule the wiring in or out</div>${L.map(([id,lab])=>{const done=HX.mchk.has(id);return`<div class="mrow"><button onclick="hRunCheck('${id}')" ${done?'disabled':''}>${done?'✓ ':''}${lab}</button>${done?`<div class="small mres">${hCheckResult(id)}</div>`:''}</div>`;}).join('')}</div>`;}
function hCauseOpts(){const j=HX.job;if(j.causeOpts)return j.causeOpts;const own=(MFAULT[hMechKey(j.route.cid)]||[]).map(m=>m.label),other=[];
  HROUTES[j.level].forEach(r=>(MFAULT[hMechKey(r.cid)]||[]).forEach(m=>{if(!own.includes(m.label)&&!other.includes(m.label))other.push(m.label);}));
  other.sort(()=>Math.random()-0.5);j.causeOpts=own.concat(other.slice(0,Math.max(2,5-own.length))).sort();return j.causeOpts;}
const HX={job:null,sec:'ov',unplug:new Set(),red:null,black:null,next:'red',minutes:0,log:[],logSig:'',wiggle:null,loom:new Set(),insp:new Set(),spin:false,result:null};
function hType(cid){return TYPE_OF[cid];}
function hRandom(a){return a[Math.floor(Math.random()*a.length)];}
function hMakeFault(level,route){
  {const mf=MFAULT[hMechKey(route.cid)];if(mf&&Math.random()<(level>=4?0.28:0.22)){const m=hRandom(mf);return{kind:'mech',m:m.m,sim:m.sim,label:m.label,complaint:m.complaint};}}
  const t=hType(route.cid),W=HW[t].map(w=>w[0]),seg=1+Math.floor(Math.random()*route.segs.length),conn=1+Math.floor(Math.random()*(route.nodes.length-1));
  const pair=({A:[['sig','ret'],['sig','ref'],['ref','ret']],B:[['sig','ret']],C:[['a','b']],D:[['hi','lo']],H:[['sig','ret']]}[t])||[[W[0],W[1]]];
  const notRet=W.filter(w=>!['ret','b'].includes(w));
  const k=hRandom(level>=4?['open','gnd','short','res','res','intermittent','intermittent','comp','bat','pushed','pushed','water','water','strands','strands']:['open','gnd','short','res','intermittent','comp','bat','pushed','water','strands']);
  if(k==='comp')return{kind:k};
  if(k==='short'){const pr=hRandom(pair);return{kind:k,wire:pr[0],wire2:pr[1],seg};}
  if(k==='water'){const pr=hRandom(pair);return{kind:k,wire:pr[0],wire2:pr[1],conn};}
  if(k==='res'||k==='pushed')return{kind:k,wire:hRandom(W),conn};
  return{kind:k,wire:hRandom(k==='gnd'?notRet:W),seg};
}
// ---------- the job's circuits in the engine ----------
/** Route topology for the engine (the 3D positions stay in the UI). */
function hRoute(rt){return{nodes:rt.nodes.map(n=>({id:n.id,name:n.name,pins:n.pins})),segs:rt.segs.map(g=>({name:g.name})),...ROUTE_3D};}
function hInstallRoutes(list,e){(e||eng).dispatch&&list.forEach(rt=>(e||eng).dispatch({type:'setRoute',circuit:rt.cid,route:hRoute(rt)}));}
function hPlugAll(){for(const[cid,set] of eng.electrical.harness.unplugged)[...set].forEach(j=>eng.dispatch({type:'plug',circuit:cid,connector:j}));for(const cid of [...eng.electrical.harness.spinning])eng.dispatch({type:'spinWheel',circuit:cid,on:false});}
/** Dry run on a scratch engine: does the truck really set a code for this fault? (5.5 assumed every fault did.) */
function hDetectable(pairs){
  const st=eng.state,t=new SimEngine({seed:SEED+7,initial:{key:st.key==='off'?'on':st.key,speedMph:st.speedMph,driver:{...st.driver}}});
  pairs.forEach(([rt,f])=>{t.dispatch({type:'setRoute',circuit:rt.cid,route:hRoute(rt)});t.injectHarnessFault(rt.cid,f);});
  t.run(6000);
  return MODKEYS.some(e=>t.module(e).dtcs('pending').concat(t.module(e).dtcs('active')).some(d=>d.spn!==639));
}
function hMeasure(red,black,mode){
  if(!HX.job||!red||!black)return{txt:'- - - -'};
  const r=eng.meter.measure({circuit:HX.job.route.cid,red,black,mode});
  return{txt:r.text,warn:r.warn};
}
// ---------- labels ----------
function hGender(j,side){return hGenderR(HX.job.route,j,side);}
function hGenderR(rt,j,side){const n=rt.nodes.length;if(j===0)return side==='u'?'male':'female';if(j===n-1)return side==='u'?'female':'male';return side==='u'?'male':'female';}
function hPointLabel(nn){
  if(nn==='gnd')return'Chassis ground';
  const pm=/^s(\d+)([ab])_(\w+)$/.exec(nn);
  if(pm&&HX.job){const t=hType(HX.job.route.cid),wl=(HW[t].find(x=>x[0]===pm[3])||[,''])[1];return`S${pm[1]} pierced, ${pm[2]==='a'?'module end':'component end'} · ${wl} wire`;}
  const m=/^c(\d+)([ud])_(\w+)$/.exec(nn);if(!m||!HX.job)return nn;
  const rt=HX.job.route,j=+m[1],s=m[2],w=m[3],t=hType(rt.cid),wi=HW[t].findIndex(x=>x[0]===w),wl=HW[t][wi][1],node=rt.nodes[j],n=rt.nodes.length;
  const pin=node.pins?node.pins[wi]:String(wi+1);
  if(j===0)return s==='u'?`${rt.module} pin ${pin} · ${wl}`:`${node.id} harness side pin ${pin} · ${wl}`;
  if(j===n-1)return s==='u'?`${node.id} harness side pin ${pin} · ${wl}`:`${rt.comp} pin ${pin} · ${wl}`;
  return`${node.id} pin ${pin}, ${s==='u'?'module side':'component side'} · ${wl}`;
}
// ---------- job lifecycle ----------
function hStartJob(){
  hEndJob(true);
  if(DMM.level===5)return hL5Start();
  const lvl=DMM.level,pool=HROUTES[lvl],inj=pool.filter(r=>r.cid.startsWith('inj')),rest=pool.filter(r=>!r.cid.startsWith('inj'));
  let rt,f;for(let i=0;i<30;i++){rt=hRandom(inj.length?rest.concat([hRandom(inj)]):rest);f=hMakeFault(lvl,rt);if(hDetectable([[rt,f]]))break;}
  HX.job={route:rt,fault:f,level:lvl,wo:Math.floor(10000+Math.random()*89999)};
  HX.sec='ov';HX.unplug=new Set();HX.red=HX.black=null;HX.next='red';HX.minutes=0;HX.log=[];HX.logSig='';HX.wiggle=null;HX.loom=new Set();HX.insp=new Set();HX.spin=false;HX.result=null;HX.cover=false;HX.mchk=new Set();HX.clamp=null;HX.removed=new Set();HX.clampZero=(Math.random()<0.5?-1:1)*(0.02+Math.random()*0.04);
  $('btnReset').click();
  hInstallRoutes([rt]);eng.injectHarnessFault(rt.cid,f);S.quiz={cid:rt.cid,harness:true};S.sel=null;
  $('explainBody').innerHTML='<p class="muted">A harness job is active: explanations are hidden until you submit a diagnosis.</p>';
  if(S.ctrl.key==='off')setKey('on');
  refreshAll();hRenderAll();h3Build();h3Focus('ov');
}
function hEndJob(silent){
  if(!HX.job)return;
  HX.job=null;HX.clamp=null;S.quiz=null;
  eng.dispatch({type:'clearAllFaults'});hPlugAll();
  for(const cid of [...eng.electrical.harness.routes.keys()])eng.dispatch({type:'setRoute',circuit:cid,route:null});
  if(!silent){refreshAll();hRenderAll();}
}

// ---------- Level 5: compound faults (several circuits, one work order) ----------
const L5PAT=[['separate','Separate, unrelated faults on different circuits'],['supply','One shorted 5 V sensor supply taking down every sensor on it'],['connector','One shared connector affecting several circuits'],['cascade','Crank and cam signals both lost together: no start'],['mixed','A real mechanical problem plus a separate wiring fault']];
const L5SHARED=[[['wlr','wrr'],'X1','ABS lamp on, traction control light flashing'],[['oss','iss','tot'],'X1','Harsh shifts, speedometer drops out, transmission holding a gear'],[['airp','airs'],'X2','Both air gauges read wrong, low-air buzzer at times'],[['def','deft'],'X2','DEF gauge reads wrong and a DEF temperature code, MIL on'],[['wlf','wrf'],'X1','ABS lamp on after a pressure wash'],[['fuel','airp','airs'],'X1','Fuel and air gauges all act up after rain']];
const hR4=cid=>HROUTES[5].find(r=>r.cid===cid);
function hElecFault(lvl,rt){let f;for(let i=0;i<30;i++){f=hMakeFault(lvl,rt);if(f.kind!=='mech'&&hDetectable([[rt,f]]))break;}return f;}
function hL5Scenario(){
  const pat=hRandom(['separate','supply','supply','connector','connector','cascade','mixed','mixed']);
  if(pat==='supply'){const sup=hRandom(['sup1','sup1','sup2']),mem=HROUTES[5].filter(r=>SUPPLY[r.cid]===sup),root=hRandom(mem),seg=1+Math.floor(Math.random()*root.segs.length);
    return{pat,supDown:sup,complaint:'Low power, MIL on, and several engine codes all set at the same moment',parts:mem.map(r=>r===root?{cid:r.cid,role:'fault',fault:{kind:'gnd',wire:'ref',seg}}:{cid:r.cid,role:'victim',fault:{kind:'none'}})};}
  if(pat==='connector'){const[cids,id,complaint]=hRandom(L5SHARED),kind=hRandom(['water','water','res','pushed']);
    return{pat,complaint,parts:cids.map(cid=>{const rt=hR4(cid),t=hType(cid),W=HW[t].map(w=>w[0]),conn=rt.nodes.findIndex(n=>n.id===id);
      if(kind==='water'){const pr=({A:[['sig','ret'],['sig','ref']],B:[['sig','ret']],C:[['a','b']],H:[['sig','ret']]}[t])||[[W[0],W[1]]],q=hRandom(pr);return{cid,role:'fault',fault:{kind,wire:q[0],wire2:q[1],conn}};}
      return{cid,role:'fault',fault:{kind,wire:hRandom(W),conn}};})};}
  if(pat==='cascade'){const mk=cid=>{const rt=hR4(cid),k=hRandom(['open','open','pushed','comp']),W=HW.C.map(w=>w[0]);return k==='comp'?{kind:k}:k==='pushed'?{kind:k,wire:hRandom(W),conn:1+Math.floor(Math.random()*(rt.nodes.length-1))}:{kind:k,wire:hRandom(W),seg:1+Math.floor(Math.random()*rt.segs.length)};};
    return{pat,complaint:'Cranks but won\'t start. It ran rough, then stalled on the highway and wouldn\'t restart',parts:[{cid:'crank',role:'fault',fault:mk('crank')},{cid:'cam',role:'fault',fault:mk('cam')}]};}
  const pool=HROUTES[5].filter(r=>!r.cid.startsWith('inj'));
  if(pat==='mixed'){const mr=hRandom(pool.filter(r=>MFAULT[hMechKey(r.cid)])),m=hRandom(MFAULT[hMechKey(mr.cid)]),er=hRandom(pool.filter(r=>r.cid!==mr.cid&&r.module!==mr.module));
    return{pat,complaint:`${m.complaint||COMPLAINT[mr.cid]}; also ${(COMPLAINT[er.cid]||'a second warning').toLowerCase()}`,parts:[{cid:mr.cid,role:'fault',fault:{kind:'mech',m:m.m,sim:m.sim,label:m.label}},{cid:er.cid,role:'fault',fault:hElecFault(5,er)}]};}
  const n=Math.random()<0.4?3:2,picked=[];while(picked.length<n){const r=hRandom(pool);if(!picked.some(p=>p.cid===r.cid||p.module===r.module))picked.push(r);}
  return{pat:'separate',complaint:picked.map(r=>COMPLAINT[r.cid]||'warning lamp on').join('; '),parts:picked.map(r=>({cid:r.cid,role:'fault',fault:hElecFault(5,r)}))};
}
function hL5ResetView(){hPlugAll();HX.sec='ov';HX.unplug=new Set();HX.red=HX.black=null;HX.next='red';HX.wiggle=null;HX.loom=new Set();HX.insp=new Set();HX.spin=false;HX.cover=false;HX.mchk=new Set();HX.clamp=null;HX.removed=new Set();HX.logSig='';}
function hL5Start(){
  let sc;for(let i=0;i<15;i++){sc=hL5Scenario();if(hDetectable(sc.parts.filter(p=>p.role==='fault').map(p=>[hR4(p.cid),p.fault])))break;}
  const start=hRandom(HROUTES[5]);
  HX.job={level:5,wo:Math.floor(10000+Math.random()*89999),scen:sc,parts:sc.parts,supDown:sc.supDown||null,route:start,fault:{kind:'none'},findings:{}};
  hL5ResetView();HX.minutes=0;HX.log=[];HX.result=null;HX.clampZero=(Math.random()<0.5?-1:1)*(0.02+Math.random()*0.04);
  $('btnReset').click();
  hInstallRoutes(HROUTES[5]);
  sc.parts.forEach(pt=>{if(pt.role==='fault')eng.injectHarnessFault(pt.cid,pt.fault);});
  S.quiz={cid:sc.parts[0].cid,cids:sc.parts.map(p=>p.cid).concat(sc.supDown?[sc.supDown]:[]),harness:true};S.sel=null;
  hL5Point(start.cid,true);
  $('explainBody').innerHTML='<p class="muted">A compound-fault job is active: explanations are hidden until you submit the work order.</p>';
  if(S.ctrl.key==='off')setKey('on');
  refreshAll();hRenderAll();h3Build();h3Focus('ov');
}
function hL5Point(cid,silent){const j=HX.job,rt=hR4(cid),pt=j.parts.find(p=>p.cid===cid);j.route=rt;j.fault=pt&&pt.role==='fault'?pt.fault:{kind:'none'};j.causeOpts=null;}
function hL5Switch(cid){const j=HX.job;if(!j||j.route.cid===cid)return;hL5Point(cid);hL5ResetView();hAddTime(3);h3Build();h3Focus('ov');hRenderAll();}
function hL5Top(j){
  const groups={};HROUTES[5].forEach(r=>{(groups[r.module]=groups[r.module]||[]).push(r);});
  const opts=Object.entries(groups).map(([m,rs])=>`<optgroup label="${m}">${rs.map(r=>`<option value="${r.cid}" ${r.cid===j.route.cid?'selected':''}>${r.comp}${j.findings[r.cid]?' ✓':''}</option>`).join('')}</optgroup>`).join('');
  const nf=Object.keys(j.findings).length,B=hBudget(j);
  return`<div style="flex:1;min-width:0"><div class="lab">Work order ${j.wo} · Level 5 · compound faults</div><b>Complaint:</b> ${j.scen.complaint}. <span class="muted">More than one code is set. Read them all, decide which circuits to test, and record a finding for each circuit you test. Some codes may be caused by a fault on a different circuit.</span>
    <div class="bar" style="margin-top:8px;align-items:center;gap:8px;flex-wrap:wrap"><span class="lab" style="margin:0">Circuit on the meter</span><select onchange="hL5Switch(this.value)" style="min-width:260px">${opts}</select><span class="muted small">Switching circuits costs 3 min · ${nf} finding${nf===1?'':'s'} recorded</span></div></div>
    <div class="labor"><div class="lab">Labor · flat rate ${B} min</div><b style="color:${HX.minutes>B?'#ff6b6b':'#b8ffcf'}">${HX.minutes} min</b></div><button onclick="hStartJob()">New job</button>`;
}
function hL5Answer(el){
  const j=HX.job,rt=j.route,t=hType(rt.cid);
  const locs=[];rt.nodes.forEach((nd,k)=>{if(k>0)locs.push(['c'+k,`${nd.name}: terminals`]);if(k<rt.segs.length)locs.push(['s'+(k+1),`Harness section: ${rt.segs[k].name}`]);});locs.push(['comp',`The ${rt.comp.toLowerCase()} itself`]);locs.push(['mech','Mechanical system (not the wiring or the sensor)']);
  const kinds=[['none','No fault in this circuit (its code comes from a fault somewhere else)']].concat(HKINDS);
  const list=Object.entries(j.findings).map(([cid,a])=>{const r=hR4(cid);return`<tr><td>${r.comp}</td><td>${a.kind==='none'?'<i>no fault here</i>':kinds.find(k=>k[0]===a.kind)[1]}</td><td><button onclick="delete HX.job.findings['${cid}'];hRenderTop();hRenderAnswer()">Remove</button></td></tr>`;}).join('');
  el.innerHTML=`<b>Record a finding for the ${rt.comp.toLowerCase()} circuit</b><div class="ansgrid"><label>Where<select id="ansLoc">${locs.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label><label>What<select id="ansKind">${kinds.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label><label>Which wire<select id="ansWire"><option value="">n/a (component / mechanical)</option>${HW[t].map(w=>`<option value="${w[0]}">${w[1]}</option>`).join('')}</select></label><label>Mechanical cause (if mechanical)<select id="ansCause"><option value="">n/a (electrical)</option>${hCauseOpts().map(c=>`<option>${c}</option>`).join('')}</select></label></div><button onclick="hL5Record()">Save finding for this circuit</button>
  <div style="margin-top:12px"><b>Findings on this work order</b>${list?`<table class="logt" style="margin-top:4px">${list}</table>`:'<p class="muted small">None yet.</p>'}</div>
  <div style="margin-top:10px"><div class="lab">How are these faults related?</div><select id="ansPat" style="width:100%;max-width:560px;margin-top:4px"><option value="">Choose…</option>${L5PAT.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></div>
  <button class="dark" style="margin-top:8px" onclick="hL5Submit()">Submit work order</button>`;
}
function hL5Record(){const j=HX.job;j.findings[j.route.cid]={loc:$('ansLoc').value,kind:$('ansKind').value,wire:$('ansWire').value,cause:$('ansCause').value};hRenderTop();$('hAnswer').dataset.wo='';hRenderAnswer();}
function hL5Grade(cid,f,a){
  const rt=hR4(cid),t=hType(cid),wl=w=>(HW[t].find(x=>x[0]===w)||[,''])[1];
  if(!a)return{sc:0,txt:`not tested or not recorded`};
  if(f.kind==='mech'){const lo=a.loc==='mech',ko=a.kind==='mech',co=a.cause===f.label;return{sc:(lo?35:0)+(ko?25:0)+(co?40:0),txt:`mechanical: ${f.label} · location ${lo?'✓':'✗'} type ${ko?'✓':'✗'} cause ${co?'✓':'✗'}`};}
  const atConn=['res','pushed','water'].includes(f.kind),trueLoc=f.kind==='comp'?'comp':atConn?'c'+f.conn:'s'+f.seg;
  const locOK=a.loc===trueLoc,kindOK=a.kind===f.kind,wireOK=f.kind==='comp'||a.wire===f.wire||(!!f.wire2&&a.wire===f.wire2);
  const where=f.kind==='comp'?`the ${rt.comp.toLowerCase()} itself`:atConn?`${rt.nodes[f.conn].name}, ${wl(f.wire)}${f.wire2?' / '+wl(f.wire2):''} terminal`:`"${rt.segs[f.seg-1].name}", ${wl(f.wire)} wire`;
  return{sc:(locOK?50:0)+(kindOK?35:0)+(wireOK?15:0),txt:`${HKINDS.find(k=>k[0]===f.kind)[1]} at ${where} · location ${locOK?'✓':'✗'} type ${kindOK?'✓':'✗'} wire ${wireOK?'✓':'✗'}`};
}
function hL5Submit(){
  const j=HX.job,pat=$('ansPat').value,rows=[];let sum=0,nF=0,fp=0;
  Object.entries(j.findings).forEach(([cid,a])=>eng.dispatch({type:'submitDiagnosis',circuit:cid,location:a.loc,kind:a.kind,wire:a.wire,cause:a.cause}));
  j.parts.forEach(pt=>{const r=hR4(pt.cid),a=j.findings[pt.cid];
    if(pt.role==='fault'){const g=hL5Grade(pt.cid,pt.fault,a);sum+=g.sc;nF++;rows.push(`<li><b>${r.comp}</b>: ${g.sc}/100 · ${g.txt}</li>`);}
    else{const bad=a&&a.kind!=='none';if(bad)fp++;rows.push(`<li><b>${r.comp}</b>: circuit was good; its code came from the shared supply. ${a?(bad?'<span class="bad">You recorded a fault here (−15).</span>':'✓ You found it was good.'):'Not tested (fine).'}</li>`);}});
  Object.entries(j.findings).forEach(([cid,a])=>{if(j.parts.some(p=>p.cid===cid))return;const bad=a.kind!=='none';if(bad)fp++;rows.push(`<li><b>${hR4(cid).comp}</b>: not part of this job. ${bad?'<span class="bad">You recorded a fault on a good circuit (−15).</span>':'✓ Correctly found good.'}</li>`);});
  const patOK=pat===j.scen.pat,base=Math.round((nF?sum/nF:0)*0.85+(patOK?15:0)),pen=base?hTimePen(j):0,score=Math.max(0,base-15*fp-pen);
  const vd=score>=90?'<span class="ok">Work order complete.</span>':score>=50?'<span style="color:var(--amber);font-weight:700">Partly correct.</span>':'<span class="bad">Not correct.</span>';
  HX.result=`<b>${vd}</b> Score ${score}/100<div class="small" style="margin-top:6px">What was wrong: <b>${L5PAT.find(p=>p[0]===j.scen.pat)[1]}</b> ${patOK?'✓':'✗ (you chose: '+((L5PAT.find(p=>p[0]===pat)||[,'nothing'])[1])+')'}<ul style="margin:6px 0 0;padding-left:18px">${rows.join('')}</ul>${fp?`<span class="bad">${fp} false finding${fp>1?'s':''}: −${15*fp}</span>`:''}${hTimeNote(j,pen)}</div><div style="margin-top:8px"><button class="dark" onclick="hStartJob()">Start next job</button></div>`;
  hEndJob();
}
const H4_BUDGET=75;
const H5_BUDGET=120,hBudget=j=>j.level===5?H5_BUDGET:H4_BUDGET;
function hAddTime(m,why){HX.minutes+=m;if(m)eng.dispatch({type:'labor',what:why||'',minutes:m});if(HX.job&&HX.job.level>=4&&$('hTop'))hRenderTop();}
function hTimePen(j){if(j.level<4)return 0;return Math.min(25,Math.ceil(Math.max(0,HX.minutes-hBudget(j))/3));}
function hTimeNote(j,p){return j.level>=4?`<br>Labor: ${HX.minutes} min (flat rate ${hBudget(j)} min)${p?` · <span class="bad">−${p} points for going over</span>`:' · within flat rate'}`:'';}
// ---------- rendering ----------
function hRenderAll(){hRenderTop();hRenderSecs();hRenderSection();hRenderMeterBar();hRenderReading();hRenderAnswer();hRenderLog();}
function hRenderTop(){
  const j=HX.job;
  if(!j){$('hTop').innerHTML=`<div><b>No job open.</b> <span class="muted">Start a job to get a truck with ${DMM.level===5?'several faults at once. Some are linked: one shorted supply or one bad connector can set codes on several circuits':DMM.level===3?'a hidden engine harness fault':'a hidden fault somewhere on the truck: engine, chassis, transmission, air system or aftertreatment'}.${DMM.level>=4?` Labor counts: you lose points past ${DMM.level===5?H5_BUDGET:H4_BUDGET} minutes.`:''}</span></div><button class="dark" onclick="hStartJob()">Start new job</button>`;return;}
  if(j.level===5){$('hTop').innerHTML=hL5Top(j);return;}
  const l4=j.level===4;
  $('hTop').innerHTML=`<div><div class="lab">Work order ${j.wo} · Level ${j.level}</div><b>Complaint:</b> ${j.fault.complaint||COMPLAINT[j.route.cid]}. <span class="muted">${l4?'The fault could be anywhere on the truck, engine or chassis. Read the codes on the scan tool to work out which circuit to trace.':`Read the codes on the scan tool, then trace the ${j.route.comp.toLowerCase()} circuit.`}</span></div>${l4?`<div class="labor"><div class="lab">Labor · flat rate ${H4_BUDGET} min</div><b style="color:${HX.minutes>H4_BUDGET?'#ff6b6b':'#b8ffcf'}">${HX.minutes} min</b></div>`:''}<button onclick="hStartJob()">New job</button>`;
}
function hSections(){if(!HX.job)return[];const rt=HX.job.route,out=[['ov','Overview'],['mod',rt.module+' (module)']];rt.nodes.forEach((nd,j)=>{out.push(['c'+j,nd.name]);if(j<rt.segs.length)out.push(['s'+(j+1),'Harness: '+rt.segs[j].name]);});out.push(['comp',rt.comp]);return out;}
function hRenderSecs(){
  $('hSecs').innerHTML=hSections().map(([k,n])=>`<button data-sec="${k}" class="${HX.sec===k?'on':''} ${k[0]==='s'?'sg':''}">${k[0]==='s'?'⟿ ':k[0]==='c'?'▣ ':''}${n}</button>`).join('');
}
$('hSecs').addEventListener('click',e=>{const b=e.target.closest('button[data-sec]');if(b)hGo(b.dataset.sec);});
function hGo(sec){if(!HX.job)return;if(sec!==HX.sec&&sec!=='ov'&&HX.sec!=='ov')hAddTime(HX.job.level>=4?2:1);HX.sec=sec;h3Build();h3Focus(sec);hRenderAll();}
function hPinRow(j,side,title){
  const rt=HX.job.route,t=hType(rt.cid),nd=rt.nodes[j],un=HX.unplug.has(j),gd=hGender(j,side);
  const gtxt=un?(gd==='male'?' · male pins':' · female terminals'):' · back-probe beside the wire seal';
  return`<div class="pinrow"><div class="lab">${title}<span style="color:${gd==='male'?'#f5c46b':'#6fd3ff'}">${gtxt}</span></div><div class="pins">${HW[t].map((w,i)=>{const nn=`c${j}${side}_${w[0]}`,pin=nd.pins?nd.pins[i]:String(i+1);const cls=HX.red===nn?'r':HX.black===nn?'b':'';
    return`<button class="pin ${cls}" data-node="${nn}" title="${hPointLabel(nn)}"><i style="background:${w[2]}"></i><b>${pin}</b><span>${w[1]}</span></button>`;}).join('')}</div></div>`;
}
function hUnder(sec){return!!(HX.job&&HX.job.route.under&&HX.job.route.under.includes(sec)&&!HX.cover);}
function hNodeUnder(nn){if(!HX.job||!HX.job.route.under||HX.cover)return false;const m=/^(c|s)(\d+)/.exec(nn);if(!m)return false;const k=m[1]==='c'?'c'+m[2]:'s'+m[2];return HX.job.route.under.includes(k)||(k==='c'+(HX.job.route.nodes.length-1)&&HX.job.route.under.includes('comp'));}
function hToggleRemove(sec){if(!HX.removed)HX.removed=new Set();if(HX.removed.has(sec))HX.removed.delete(sec);else HX.removed.add(sec);hAddTime(sec==='mod'?20:10);h3Build();h3Focus(sec);hRenderAll();}
function hRemovedNote(){const j=HX.job,f=j.fault,cid=j.route.cid,bad=f.kind==='comp';
  if(!bad)return'The sensor is out. The housing, seal and tip look normal. You can bench-test its pins.';
  if(['crank','cam'].includes(cid)||cid[0]==='w')return'The sensor is out. There are fine metal particles stuck to the magnetic tip, and the tip face is scuffed.';
  if(cid==='ect')return'The sensor is out. The plastic body is cracked next to the connector and there is coolant residue in the crack.';
  return'The sensor is out. The housing is cracked next to the connector and there is oil residue in the crack.';}
function hToggleCover(){HX.cover=!HX.cover;hAddTime(25);h3Build();h3Focus(HX.sec);hRenderAll();}
function hRenderSection(){
  const el=$('hSection');
  if(!HX.job){el.innerHTML='<p class="muted">Pick a level and start a job.</p>';return;}
  const rt=HX.job.route,s=HX.sec,n=rt.nodes.length,gnd=`<button class="pin gndp ${HX.red==='gnd'?'r':HX.black==='gnd'?'b':''}" data-node="gnd"><i style="background:#555"></i><b>⏚</b><span>Chassis ground (nearest)</span></button>`;
  let h='';
  if(s==='ov')h=`<h3>Overview</h3>${HX.job.level===3?`<div class="bar" style="margin-bottom:8px"><button onclick="hToggleCover()">${HX.cover?'Reinstall valve cover':'Remove valve cover'}</button><span class="small muted">${HX.cover?'Valve cover off: injectors, rocker gear and the injector harness are exposed.':'Take the cover off to inspect the injectors and the harness under it.'}</span></div>`:''}<p class="small">The ${rt.comp.toLowerCase()} circuit runs from the ${rt.module} through ${n-2} inline connector${n>3?'s':''} to the sensor. Pick a section in the list or click the harness in 3D to go there. Leads stay attached when you move, like long test leads.</p>${hMechHTML()}`;
  else if(/^c\d+$/.test(s)){
    const j=+s.slice(1),nd=rt.nodes[j],un=HX.unplug.has(j);
    h=`<h3>${nd.name}</h3><p class="small muted" style="margin-top:-4px">${hConnSpec(j).name}</p><div class="bar" style="margin-bottom:8px"><span class="badge ${un?'b-pend':'b-ok'}">${un?'UNPLUGGED':'PLUGGED IN'}</span><button onclick="hTogglePlug(${j})">${un?'Plug in':'Unplug'}</button>${un?`<button onclick="hInspectConn(${j})">Inspect terminals</button>`:''}</div>`;
    if(j===0)h+=un?hPinRow(0,'u',`${rt.module} pins (module side)`)+hPinRow(0,'d','Harness connector pins'):hPinRow(0,'d','Back-probe the harness side');
    else if(j===n-1)h+=un?hPinRow(j,'u','Harness connector pins')+hPinRow(j,'d',`${rt.comp} pins`):hPinRow(j,'u','Back-probe the harness side');
    else h+=hPinRow(j,'u',un?'Module-side half':'Back-probe, module side of the connector')+hPinRow(j,'d',un?'Component-side half':'Back-probe, component side of the connector');
    const ins=HX.insp.has('c'+j);
    if(ins){const f=HX.job.fault,pn=w=>(nd.pins||['1','2','3','4'])[HW[hType(rt.cid)].findIndex(x=>x[0]===w)],hit=f.conn===j&&['res','pushed','water'].includes(f.kind);
      h+=`<p class="small ${hit?'bad':''}">${!hit?'Terminals look clean and tight. Seals are intact.':f.kind==='res'?`Green corrosion and a spread terminal on pin ${pn(f.wire)}.`:f.kind==='pushed'?`The terminal in cavity ${pn(f.wire)} is pushed back into the housing. It isn't making contact with its mating pin.`:`Water inside the connector and green corrosion between pins ${pn(f.wire)} and ${pn(f.wire2)}. The rear seal is torn.`}</p>`;}
  }
  else if(s[0]==='s'){
    const j=+s.slice(1),sg=rt.segs[j-1];
    const wig=HX.wiggle&&HX.wiggle.seg===j&&performance.now()<HX.wiggle.until;
    h=`<h3>Harness section: ${sg.name}</h3><p class="small muted">No connector here. Isolate the section from the connectors on each end, or use a pierce probe through the insulation (seal every hole afterward: piercing lets water wick into the wire).</p><div class="bar"><button onclick="hWiggle(${j})" ${wig?'disabled':''}>${wig?'Wiggling… watch the meter':'Wiggle test this section'}</button><button onclick="hOpenLoom(${j})" ${HX.loom.has(j)?'disabled':''}>${HX.loom.has(j)?'Loom opened':'Open loom & inspect'}</button></div>`;
    {const t=hType(rt.cid);['a','b'].forEach(e=>{h+=`<div class="pinrow"><div class="lab">Pierce probe · ${e==='a'?'module end of this section':'component end of this section'}</div><div class="pins">${HW[t].map(w=>{const nn=`s${j}${e}_${w[0]}`,cls=HX.red===nn?'r':HX.black===nn?'b':'';return`<button class="pin ${cls}" data-node="${nn}" title="${hPointLabel(nn)}"><i style="background:${w[2]}"></i><span>${w[1]}</span></button>`;}).join('')}</div></div>`;});}
    if(HX.loom.has(j)){const f=HX.job.fault,hit=f.seg===j&&['open','gnd','short','bat','strands'].includes(f.kind);
      h+=`<p class="small ${hit?'bad':''}">${hit?{open:'Found it: a wire is broken where the harness rubs on a clip.',gnd:'Found it: insulation rubbed through against the bracket, copper touching metal.',short:'Found it: two wires chafed through and touching each other.',bat:'Found it: insulation chafed through against a powered battery-feed wire.',strands:'Found it: the wire is kinked and partly cut; most of the strands are broken.'}[f.kind]:'Wires look good: no chafing or damage visible. (Damage inside the insulation won\'t show.)'}</p>`;}
  }
  else if(s==='comp'||s==='mod'){
    const isM=s==='mod',jj=isM?0:n-1,un=HX.unplug.has(jj),nd=rt.nodes[jj],spec=hConnSpec(jj),dev=isM?rt.module:rt.comp;
    h=`<h3>${dev}</h3><p class="small muted">${nd.name} · ${spec.name}. ${isM?'The module has the male header pins; the harness plug has the female terminals.':'The sensor has the male pins; the harness plug has the female terminals.'}</p>
    <div class="bar" style="margin-bottom:8px"><span class="badge ${un?'b-pend':'b-ok'}">${un?'UNPLUGGED':'PLUGGED IN'}</span><button onclick="hTogglePlug(${jj})" ${HX.removed.has(s)?'disabled title="Reinstall it first"':''}>${un?'Plug in':'Unplug'}</button>${un&&jj>0?`<button onclick="hInspectConn(${jj})">Inspect terminals</button>`:''}
      ${rt.cid.startsWith('inj')&&!isM?'':`<button onclick="hToggleRemove('${s}')" ${!un&&!HX.removed.has(s)?'disabled title="Unplug the connector first"':''}>${HX.removed.has(s)?'Reinstall':'Remove '+(isM?'module':'sensor')}</button>`}</div>
    ${HX.removed.has(s)?`<p class="small">${isM?`The ${dev} is unbolted and set out where you can inspect it. Its header pins can still be probed on the bench.`:hRemovedNote()}</p>`:(!un?`<p class="small muted">Unplug the connector before removing the ${isM?'module':'sensor'}.</p>`:'')}`;
    if(isM)h+=un?hPinRow(0,'u',`${dev} header pins`)+hPinRow(0,'d','Harness plug at the module'):hPinRow(0,'d',`Back-probe at the ${dev} connector (module powered and connected)`);
    else h+=un?hPinRow(n-1,'d',`${dev} pins`)+hPinRow(n-1,'u','Harness plug at the sensor'):hPinRow(n-1,'u',`Back-probe at the ${dev} connector`);
    h+=`<p class="small muted">${isM?'Only this circuit\'s pins are labeled; the module\'s power, ground and other circuits are not modeled.':'The outside of the sensor looks normal.'}</p>`;
  }
  if(s!=='ov'&&hUnder(s))h=`<h3>${s==='comp'?rt.comp:/^c\d+$/.test(s)?rt.nodes[+s.slice(1)].name:'Harness section: '+rt.segs[+s.slice(1)-1].name}</h3><p class="small">This is under the valve cover. Remove the cover to reach it.</p><button onclick="hToggleCover()">Remove valve cover</button>`;
  if(s[0]==='s'&&!hUnder(s))h+=hClampRow(+s.slice(1));
  h+=`<div class="pinrow"><div class="lab">Always available</div><div class="pins">${gnd}</div></div>`;
  el.innerHTML=h;
}
$('hSection').addEventListener('click',e=>{const b=e.target.closest('button[data-node]');if(!b)return;hSetLead(b.dataset.node);});
function hTogglePlug(j){setTimeout(()=>h3Focus(HX.sec),0);const was=HX.unplug.has(j);if(was)HX.unplug.delete(j);else HX.unplug.add(j);eng.dispatch({type:was?'plug':'unplug',circuit:HX.job.route.cid,connector:j});hAddTime(j===0||HX.job.route.nodes[j].name.includes('bulkhead')?4:2);h3Build();hRenderAll();}
function hInspectConn(j){HX.insp.add('c'+j);hAddTime(3);h3Build();hRenderAll();}
function hWiggle(j){HX.wiggle={seg:j,until:performance.now()+6000};eng.dispatch({type:'wiggle',circuit:HX.job.route.cid,seg:j,ms:6000});hAddTime(2);hRenderAll();setTimeout(()=>{hRenderSection();},6100);}
function hOpenLoom(j){HX.loom.add(j);hAddTime(HX.job.level>=4?12:8);h3Build();hRenderAll();}
HX.tool='dmm';HX.clampMode='dc';
function hSetTool(t){HX.tool=t;h3Build();hRenderAll();}
function hClampRow(j){const t=hType(HX.job.route.cid),open=HX.loom.has(j),on=x=>HX.tool==='clamp'&&HX.clamp&&HX.clamp.seg===j&&HX.clamp.wire===x?'r':'';
  return`<div class="pinrow"><div class="lab">Amp clamp on this section${open?'':' · open the loom to clamp a single wire'}</div><div class="pins"><button class="pin ${on('all')}" onclick="hSetClamp(${j},'all')"><b>⊙</b><span>Around the whole loom</span></button>${HW[t].map(w=>`<button class="pin ${on(w[0])}" ${open?'':'disabled'} onclick="hSetClamp(${j},'${w[0]}')"><i style="background:${w[2]}"></i><span>${w[1]} wire only</span></button>`).join('')}</div></div>`;}
function hSetClamp(j,w){HX.clamp={seg:j,wire:w};HX.tool='clamp';hAddTime(0.5);h3Build();hRenderAll();}
function hClampLabel(){if(!HX.clamp||!HX.job)return'not clamped';const t=hType(HX.job.route.cid),w=HX.clamp.wire;return`S${HX.clamp.seg} · ${w==='all'?'whole loom':(HW[t].find(x=>x[0]===w)||[,''])[1]+' wire'}`;}
function hClampAmps(){
  const job=HX.job,c=HX.clamp;if(!job||!c)return null;
  return eng.meter.clamp({circuit:job.route.cid,seg:c.seg,wire:c.wire,mode:HX.clampMode==='dc'?'dc':'ac'});
}
function hClampText(){const I=hClampAmps();if(I===null)return'- - - -';let x=I+(HX.clampMode==='dc'?HX.clampZero:0)+(Math.random()-0.5)*0.002;if(Math.abs(x)<0.0015)x=0;
  return Math.abs(x)<1?(x*1000).toFixed(0)+' mA':x.toFixed(2)+' A';}
function hClampZeroBtn(){if(HX.clamp){$('hWarn').innerHTML='<span class="small muted">Take the clamp off the wire before zeroing it.</span>';}HX.clampZero=HX.clamp?HX.clampZero:0;hRenderReading();}
function hRenderMeterBar(){
  const seg=(opts,cur,attr)=>opts.map(([k,l])=>`<button ${attr}="${k}" class="${cur===k?'on':''}">${l}</button>`).join('');
  $('hKey').innerHTML=seg([['off','Off'],['on','On'],['run','Run']],S.ctrl.key,'data-hk');
  $('hTool').innerHTML=seg([['dmm','Multimeter'],['clamp','Amp clamp']],HX.tool,'data-ht');
  if(HX.tool==='clamp'){$('hFn').innerHTML=seg([['dc','A ⎓'],['ac','A ~']],HX.clampMode,'data-hc')+`<button onclick="hClampZeroBtn()">Zero</button>`;
    $('hLeads').innerHTML=`<div class="lead on" style="cursor:default"><b>Clamp jaws</b><span>${hClampLabel()}</span></div><button class="lead" onclick="HX.clamp=null;h3Build();hRenderAll()"><b>Remove clamp</b><span>${HX.clampZero?'not zeroed yet':'zeroed'}</span></button>`;
    $('hSpin').innerHTML='';return;}
  $('hFn').innerHTML=seg([['dcv','V ⎓'],['acv','V ~'],['ohm','Ω']],DMM.mode,'data-hf');
  $('hLeads').innerHTML=`<button class="lead red ${HX.next==='red'?'on':''}" data-hl="red"><b>Red · V Ω</b><span>${HX.red?hPointLabel(HX.red):'click a pin'}</span></button><button class="lead blk ${HX.next==='black'?'on':''}" data-hl="black"><b>Black · COM</b><span>${HX.black?hPointLabel(HX.black):'click a pin'}</span></button>`;
  const wheel=HX.job&&HX.job.route.cid[0]==='w';
  $('hSpin').innerHTML=wheel?`<label class="small"><input type="checkbox" id="hSpinCb" ${HX.spin?'checked':''}> Spin the wheel by hand (≈0.5 rev/s)</label>`:'';
}
$('hKey').addEventListener('click',e=>{const b=e.target.closest('[data-hk]');if(b){setKey(b.dataset.hk);hRenderAll();}});
$('hTool').addEventListener('click',e=>{const b=e.target.closest('[data-ht]');if(b)hSetTool(b.dataset.ht);});
$('hFn').addEventListener('click',e=>{const c=e.target.closest('[data-hc]');if(c){HX.clampMode=c.dataset.hc;hRenderAll();return;}const b=e.target.closest('[data-hf]');if(b){DMM.mode=b.dataset.hf;h3Build();hRenderAll();}});
$('hLeads').addEventListener('click',e=>{const b=e.target.closest('[data-hl]');if(b){HX.next=b.dataset.hl;hRenderMeterBar();}});
$('hSwapB').addEventListener('click',()=>{[HX.red,HX.black]=[HX.black,HX.red];h3Build();hRenderAll();});
$('hClearB').addEventListener('click',()=>{HX.red=HX.black=null;HX.next='red';h3Build();hRenderAll();});
$('hSpin').addEventListener('change',e=>{if(e.target.id==='hSpinCb'){HX.spin=e.target.checked;eng.dispatch({type:'spinWheel',circuit:HX.job.route.cid,on:HX.spin});hRenderReading();}});
function hRenderReading(){
  if(HX.tool==='clamp'){const txt=hClampText();$('hLcd').textContent=txt;$('hLcdMode').textContent=HX.clampMode==='dc'?'A ⎓ clamp':'A ~ clamp';if(!/Take the clamp/.test($('hWarn').innerHTML))$('hWarn').innerHTML='';
    if(HX.job&&HX.clamp){const sig=['clamp',S.ctrl.key,HX.clampMode,HX.clamp.seg,HX.clamp.wire,[...HX.unplug].join(','),HX.clampZero?1:0].join('|');
      if(sig!==HX.logSig){HX.logSig=sig;HX.log.unshift({k:S.ctrl.key,mode:HX.clampMode==='dc'?'A⎓':'A~',r:'Amp clamp: '+hClampLabel(),b:'—',un:[...HX.unplug].map(j=>HX.job.route.nodes[j].id).join(', ')||'none',v:txt});HX.log=HX.log.slice(0,16);hRenderLog();}}
    return;}
  const m=hMeasure(HX.red,HX.black,DMM.mode);
  $('hLcd').textContent=m.txt;h3DrawLcd(m.txt);$('hLcdMode').textContent={dcv:'V ⎓',acv:'V ~',ohm:'Ω'}[DMM.mode];
  $('hWarn').innerHTML=m.warn?`<span class="bad">${m.warn}</span>`:'';
  if(HX.job&&HX.red&&HX.black&&!m.warn){
    const wig=HX.wiggle&&performance.now()<HX.wiggle.until;const sig=[S.ctrl.key,DMM.mode,HX.red,HX.black,[...HX.unplug].join(','),HX.spin,wig?'w'+m.txt:''].join('|');
    if(sig!==HX.logSig){HX.logSig=sig;HX.log.unshift({k:S.ctrl.key,mode:{dcv:'V⎓',acv:'V~',ohm:'Ω'}[DMM.mode],r:hPointLabel(HX.red),b:hPointLabel(HX.black),un:[...HX.unplug].map(j=>HX.job.route.nodes[j].id).join(', ')||'none',v:m.txt+(wig?' (wiggling S'+HX.wiggle.seg+')':'')});HX.log=HX.log.slice(0,16);hRenderLog();}
  }
}
function hRenderLog(){
  $('hLog').innerHTML=HX.log.length?`<table class="logt"><tr><th>Key</th><th>Fn</th><th>Red</th><th>Black</th><th>Unplugged</th><th>Reading</th></tr>${HX.log.map(l=>`<tr><td>${l.k}</td><td>${l.mode}</td><td style="white-space:normal">${l.r}</td><td style="white-space:normal">${l.b}</td><td>${l.un}</td><td class="v">${l.v}</td></tr>`).join('')}</table>`:'<p class="muted small">Readings are logged here as you take them.</p>';
}
const HKINDS=[['bat','Short to battery voltage (chafed against a powered wire)'],['pushed','Terminal pushed out / not seated'],['water','Water / corrosion bridging two terminals'],['strands','Partly broken wire (high resistance)'],['open','Open circuit (broken wire)'],['gnd','Short to ground (chafed against metal)'],['short','Short between two wires'],['res','High resistance (corroded / spread terminal)'],['intermittent','Intermittent open (fails when moved)'],['comp','Component failed internally'],['mech','Mechanical problem (circuit and sensor test good)']];
function hRenderAnswer(){
  const el=$('hAnswer');
  const wk=HX.job?HX.job.wo+(HX.job.level===5?'|'+HX.job.route.cid+'|'+Object.keys(HX.job.findings).join():''):'';
  if(HX.job&&el.dataset.wo==wk)return;el.dataset.wo=wk;
  if(HX.job&&HX.job.level===5)return hL5Answer(el);
  if(!HX.job){el.innerHTML=HX.result||'<p class="muted small">Your diagnosis result will appear here.</p>';return;}
  const rt=HX.job.route,t=hType(rt.cid);
  const locs=[];rt.nodes.forEach((nd,j)=>{if(j>0)locs.push(['c'+j,`${nd.name}: terminals`]);if(j<rt.segs.length)locs.push(['s'+(j+1),`Harness section: ${rt.segs[j].name}`]);});locs.push(['comp',`The ${rt.comp.toLowerCase()} itself`]);locs.push(['mech','Mechanical system (not the wiring or the sensor)']);
  el.innerHTML=`<b>Submit your diagnosis</b><div class="ansgrid"><label>Where<select id="ansLoc">${locs.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label><label>What<select id="ansKind">${HKINDS.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label><label>Which wire<select id="ansWire"><option value="">n/a (component / mechanical)</option>${HW[t].map(w=>`<option value="${w[0]}">${w[1]}</option>`).join('')}</select></label><label>Mechanical cause (if mechanical)<select id="ansCause"><option value="">n/a (electrical)</option>${hCauseOpts().map(c=>`<option>${c}</option>`).join('')}</select></label></div><button class="dark" onclick="hSubmit()">Submit diagnosis</button>`;
}
function hSubmit(){
  const j=HX.job,f=j.fault,loc=$('ansLoc').value,kind=$('ansKind').value,wire=$('ansWire').value,cause=$('ansCause')?$('ansCause').value:'';
  eng.dispatch({type:'submitDiagnosis',circuit:j.route.cid,location:loc,kind,wire,cause});
  if(f.kind==='mech'){const lo=loc==='mech',ko=kind==='mech',co=cause===f.label,raw=(lo?35:0)+(ko?25:0)+(co?40:0),pen=raw?hTimePen(j):0,sc=Math.max(0,raw-pen);
    const vd=raw===100?'<span class="ok">Correct diagnosis.</span>':raw>=50?'<span style="color:var(--amber);font-weight:700">Partly correct.</span>':'<span class="bad">Not correct.</span>';
    HX.result=`<b>${vd}</b> Score ${sc}/100<div class="small" style="margin-top:6px">The fault was <b>mechanical</b>: ${f.label}. The ${j.route.comp.toLowerCase()} circuit and the sensor were good; the sensor was reporting a real condition.<br>Location ${lo?'✓':'✗'} · Fault type ${ko?'✓':'✗'} · Cause ${co?'✓':'✗'}${hTimeNote(j,pen)}</div><div style="margin-top:8px"><button class="dark" onclick="hStartJob()">Start next job</button></div>`;
    hEndJob();return;}
  const atConn=['res','pushed','water'].includes(f.kind),trueLoc=f.kind==='comp'?'comp':atConn?'c'+f.conn:'s'+f.seg;
  const locOK=loc===trueLoc,kindOK=kind===f.kind,wireOK=f.kind==='comp'||wire===f.wire||(!!f.wire2&&wire===f.wire2);
  const t=hType(j.route.cid),wl=w=>(HW[t].find(x=>x[0]===w)||[,''])[1];
  const where=f.kind==='comp'?`the ${j.route.comp.toLowerCase()} itself`:atConn?`${j.route.nodes[f.conn].name}, ${wl(f.wire)} terminal${f.wire2?' and '+wl(f.wire2)+' terminal':''}`:`harness section "${j.route.segs[f.seg-1].name}", ${wl(f.wire)} wire${f.wire2?' (shorted to the '+wl(f.wire2)+' wire)':''}`;
  const raw=(locOK?50:0)+(kindOK?35:0)+(wireOK?15:0),pen=raw?hTimePen(j):0,score=Math.max(0,raw-pen);
  const verdict=raw===100?'<span class="ok">Correct diagnosis.</span>':raw>=50?'<span style="color:var(--amber);font-weight:700">Partly correct.</span>':'<span class="bad">Not correct.</span>';
  HX.result=`<b>${verdict}</b> Score ${score}/100<div class="small" style="margin-top:6px">The fault was: <b>${HKINDS.find(k=>k[0]===f.kind)[1]}</b> at ${where}.<br>Location ${locOK?'✓':'✗'} · Fault type ${kindOK?'✓':'✗'} · Wire ${wireOK?'✓':'✗'}${hTimeNote(j,pen)}</div><div style="margin-top:8px"><button class="dark" onclick="hStartJob()">Start next job</button></div>`;
  hEndJob();
}
// ---------- removable modules and sensors ----------
function h3RemoveDelta(p,connSec,dist,rem){if(!rem)return new THREE.Vector3();const l4=HX.job&&HX.job.level>=4,vd=h3ViewDir(connSec,p,l4);return vd.multiplyScalar(dist).add(new THREE.Vector3(0,dist*0.25,0));}
function h3Label(text,w,h,bg,fg){const cv=document.createElement('canvas');cv.width=512;cv.height=Math.round(512*h/w);const c=cv.getContext('2d');c.fillStyle=bg;c.fillRect(0,0,cv.width,cv.height);c.fillStyle=fg;c.textBaseline='top';
  const lines=text.split('\n');lines.forEach((t,i)=>{c.font=`${i===0?700:500} ${i===0?34:22}px "IBM Plex Mono",monospace`;c.fillText(t,22,18+i*(i===0?0:30)+(i>0?28:0));});
  for(let i=0;i<46;i++){c.fillRect(300+i*4,cv.height-58,i%3===0?3:1.5,38);}
  return new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(cv),roughness:.7});}
function h3ModuleModel(name,eng){
  const g=new THREE.Group(),alu=h3mat(0xa9afb8,{metalness:.65,roughness:.4}),dk=h3mat(0x6d737c,{metalness:.6,roughness:.45}),blk=h3mat(0x18191c,{roughness:.6}),rub=h3mat(0x0e0e0f,{roughness:.95}),stl=h3mat(0xc9ced6,{metalness:.9,roughness:.25});
  if(name==='Engine ECM'){
    h3cast(g,[.46,.30,.014],[0,0,-.028],dk,.004);
    [[-.235,.08],[-.235,.03]].forEach(([x,y])=>{h3cyl(g,.007,.03,[x-.008,y,-.028],'x',stl,10);h3cyl(g,.011,.012,[x+.002,y,-.028],'x',stl,6);});
    h3cast(g,[.40,.24,.042],[0,0,0],alu,.008);
    for(let i=0;i<9;i++)h3cast(g,[.33,.007,.009],[-.02,-.1+i*.022,.025],alu,.002);
    const lb=new THREE.Mesh(new THREE.PlaneGeometry(.12,.06),h3Label('ENGINE CONTROL MODULE\nP/N 2187341  SW 46.12\nS/N 7Q41-08833',120,60,'#e9e9e2','#1b1b1b'));lb.position.set(.12,.06,.0302);g.add(lb);
    [[-.215,.135],[.215,.135],[-.215,-.135],[.215,-.135]].forEach(([x,y])=>{h3cast(g,[.04,.03,.012],[x,y,-.02],dk,.004);h3cyl(g,.012,.016,[x,y,-.008],'z',rub,14);h3cyl(g,.007,.008,[x,y,.004],'z',stl,6);});
  }else if(name==='ABS ECU'){
    h3cast(g,[.30,.20,.07],[0,0,0],blk,.01);for(let i=0;i<6;i++)h3cast(g,[.26,.008,.01],[0,-.07+i*.028,.038],blk,.002);
    const lb=new THREE.Mesh(new THREE.PlaneGeometry(.1,.05),h3Label('ABS CONTROLLER\n4S/4M  12V\nP/N K0 38812',100,50,'#d8d8d0','#111'));lb.position.set(-.08,.05,.0352);g.add(lb);
    [[-.17,.07],[.17,.07],[-.17,-.07],[.17,-.07]].forEach(([x,y])=>{h3cast(g,[.05,.03,.012],[x,y,-.02],blk,.004);h3cyl(g,.007,.01,[x,y,-.008],'z',stl,6);});
  }else if(name==='Instrument cluster'){
    h3cast(g,[.34,.16,.07],[0,0,0],blk,.01);[-.08,.08].forEach(x=>{h3cyl(g,.05,.006,[x,0,.036],'z',h3mat(0x0b0d12,{roughness:.2}),32);h3torus(g,.05,.004,[x,0,.039],'z',stl);});
  }else{ // aftertreatment ACM
    h3cast(g,[.26,.18,.05],[0,0,0],alu,.008);for(let i=0;i<6;i++)h3cast(g,[.22,.006,.008],[0,-.06+i*.024,.03],alu,.002);
    const lb=new THREE.Mesh(new THREE.PlaneGeometry(.09,.045),h3Label(name==='Transmission TCM'?'TRANSMISSION\nCONTROL MODULE':'AFTERTREATMENT\nCONTROL MODULE',90,45,'#e9e9e2','#1b1b1b'));lb.position.set(.07,.05,.0352);g.add(lb);
  }
  // face the module out toward the viewer side it is mounted on (+z on the engine and the left rail; -z on the right rail)
  return g;
}
function h3SensorModel(cid,eng,damaged){
  const g=new THREE.Group(),sc=eng?1.3:2.2,S=v=>v*sc,blk=h3mat(0x1d1e21,{roughness:.55}),gry=h3mat(0x3a3d42,{roughness:.6}),stl=h3mat(0xc9ced6,{metalness:.9,roughness:.25}),brass=h3mat(0xc9a24a,{metalness:.85,roughness:.3}),rub=h3mat(0x0f0f10,{roughness:.95});
  const thread=(y0,len,r,m)=>{h3cyl(g,S(r),S(len),[0,S(y0+len/2),0],'y',m,16);for(let i=0;i<len/0.0016;i++)h3torus(g,S(r),S(0.0004),[0,S(y0+0.0008+i*0.0016),0],'y',m);};
  const hex=(y,r,h,m)=>h3cyl(g,S(r),S(h),[0,S(y),0],'y',m,6);
  if(cid==='map'){h3cast(g,[S(.042),S(.006),S(.03)],[S(.006),S(.003),0],blk,S(.002));h3cyl(g,S(.006),S(.012),[0,S(-.006),0],'y',blk,14);h3torus(g,S(.0062),S(.0012),[0,S(-.004),0],'y',rub);
    h3cast(g,[S(.03),S(.026),S(.024)],[0,S(.019),0],blk,S(.003));h3cyl(g,S(.0045),S(.004),[S(.022),S(.008),0],'y',stl,6);}
  else if(cid==='oilp'||cid==='rail'||cid==='airp'||cid==='airs'){thread(-.014,.014,.007,stl);hex(.006,.014,.012,stl);
    if(cid==='rail'){h3cyl(g,S(.01),S(.03),[0,S(.027),0],'y',stl,20);h3cyl(g,S(.011),S(.012),[0,S(.048),0],'y',blk,20);}else{h3cyl(g,S(.013),S(.026),[0,S(.025),0],'y',gry,20);h3torus(g,S(.013),S(.0015),[0,S(.013),0],'y',stl);}}
  else if(['ect','tot','amb','deft'].includes(cid)){h3cyl(g,S(.0035),S(.012),[0,S(-.02),0],'y',brass,12);thread(-.014,.014,.007,brass);hex(.006,.012,.011,brass);h3cyl(g,S(.01),S(.022),[0,S(.022),0],'y',gry,18);}
  else if(['crank','cam','oss','iss'].includes(cid)){h3cyl(g,S(.009),S(.034),[0,S(-.017),0],'y',gry,18);h3torus(g,S(.0092),S(.0014),[0,S(-.003),0],'y',rub);
    h3cast(g,[S(.036),S(.004),S(.018)],[S(.01),S(.002),0],stl,S(.001));h3cyl(g,S(.0045),S(.004),[S(.022),S(.006),0],'y',stl,6);h3cyl(g,S(.011),S(.024),[0,S(.016),0],'y',blk,18);}
  else if(cid[0]==='w'){h3cyl(g,S(.009),S(.05),[0,S(-.02),0],'y',stl,18);for(let i=0;i<4;i++)h3torus(g,S(.0096),S(.0008),[0,S(-.03+i*.008),0],'y',h3mat(0x8a8f96,{metalness:.8}));
    h3cyl(g,S(.01),S(.012),[0,S(.01),0],'y',blk,16);h3tube(g,[[0,S(.016),0],[0,S(.03),0],[S(.012),S(.04),0],[S(.025),S(.042),0]],S(.003),blk);}
  else if(cid==='thr'||cid==='egr'||cid==='vgt'){const w={thr:.05,egr:.056,vgt:.064}[cid],dp=w*.8,alu=h3mat(0x9aa1aa,{metalness:.6,roughness:.4});
    h3cast(g,[S(w),S(.006),S(dp)],[0,S(.003),0],alu,S(.002));[[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([a,b])=>h3cyl(g,S(.0035),S(.004),[a*S(w*.42),S(.008),b*S(dp*.4)],'y',stl,6));
    h3cast(g,[S(w*.78),S(cid==='vgt'?.036:.03),S(dp*.72)],[0,S(cid==='vgt'?.024:.021),0],blk,S(.005));
    for(let i=0;i<4;i++)h3box(g,[S(w*.7),S(.0018),S(dp*.74)],[0,S(.012+i*.006),0],blk);
    if(cid!=='thr')h3cyl(g,S(w*.22),S(.012),[S(-w*.12),S(cid==='vgt'?.046:.04),0],'y',blk,20);
    h3cast(g,[S(.014),S(.014),S(.016)],[S(w*.39+.007),S(.024),0],blk,S(.002));}
  else if(cid==='fuel'){h3cyl(g,S(.04),S(.005),[0,S(.0025),0],'y',stl,40);for(let i=0;i<5;i++){const a=i/5*Math.PI*2;h3cyl(g,S(.0035),S(.004),[Math.cos(a)*S(.034),S(.007),Math.sin(a)*S(.034)],'y',stl,6);}h3cyl(g,S(.022),S(.02),[0,S(.015),0],'y',blk,24);}
  else{h3cyl(g,S(.045),S(.008),[0,S(.004),0],'y',gry,36);[-1,1].forEach(s2=>h3tube(g,[[s2*S(.02),S(.008),0],[s2*S(.02),S(.03),0],[s2*S(.04),S(.04),0]],S(.005),h3mat(0x2b2b2b)));h3cyl(g,S(.012),S(.02),[0,S(.018),S(.015)],'y',blk,18);}
  if(damaged){
    if(['crank','cam'].includes(cid)||cid[0]==='w'){for(let i=0;i<24;i++){const d=new THREE.Mesh(new THREE.BoxGeometry(S(.0012),S(.0012),S(.0025)),h3mat(0x2a2c30,{metalness:.9,roughness:.5}));d.position.set((Math.random()-.5)*S(.016),S(cid[0]==='w'?-.045:-.034)+Math.random()*S(.004),(Math.random()-.5)*S(.016));d.rotation.set(Math.random()*3,Math.random()*3,0);g.add(d);}}
    else{const cr=new THREE.Mesh(new THREE.BoxGeometry(S(.0012),S(.016),S(.001)),h3mat(0x050505));cr.position.set(S(.0125),S(.03),0);cr.rotation.z=0.25;g.add(cr);
      const res=new THREE.Mesh(new THREE.SphereGeometry(S(.005),10,8),new THREE.MeshStandardMaterial({color:cid==='ect'?0x3fa35c:0x6b4a12,transparent:true,opacity:.55,roughness:.1}));res.scale.set(1,1.6,.4);res.position.set(S(.013),S(.022),0);g.add(res);}
  }
  return g;
}
function h3MountMarks(W,p,eng,kind){
  const sc=eng?1.3:2.2,hole=h3mat(0x050505,{roughness:1}),stl=h3mat(0xc9ced6,{metalness:.9,roughness:.25}),rub=h3mat(0x0e0e0f,{roughness:.95});
  if(kind==='module'){const vd=h3ViewDir('c0',p,!eng);const g=new THREE.Group();g.position.copy(p);g.lookAt(p.clone().add(new THREE.Vector3(0,0,Math.sign(vd.z)||1)));
    [[-.215,.135],[.215,.135],[-.215,-.135],[.215,-.135]].forEach(([x,y])=>{const st=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.03,8),stl);st.rotation.x=Math.PI/2;st.position.set(x*(eng?1:.75),y*(eng?1:.75),-.01);g.add(st);const r=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.008,14),rub);r.rotation.x=Math.PI/2;r.position.set(x*(eng?1:.75),y*(eng?1:.75),-.026);g.add(r);});
    W.add(g);return;}
  const d=new THREE.Mesh(new THREE.CylinderGeometry(.0075*sc,.0075*sc,.003*sc,18),hole);d.position.copy(p);W.add(d);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.0095*sc,.0018*sc,8,22),stl);rim.position.copy(p);rim.rotation.x=Math.PI/2;W.add(rim);
}
// ---------- Deutsch-style connector models ----------
function hConnSpec(j,rtIn){
  const rt=rtIn||HX.job.route,t=hType(rt.cid),nw=HW[t].length,nd=rt.nodes[j];
  if(j===0){const[rows,cols]={'Engine ECM':[5,12],'ABS ECU':[2,9],'Instrument cluster':[2,12],'Transmission TCM':[2,10]}[rt.module]||[3,8],pitch=0.0055,cav=[];
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)cav.push([(c-(cols-1)/2)*pitch,((rows-1)/2-r)*pitch]);
    return{kind:'mod',W:cols*pitch+0.007,H:rows*pitch+0.007,L:0.04,cav,pitch,wire:HW[t].map((w,i)=>Math.min(cav.length-1,(+(nd.pins||[])[i]||i+1)-1)),name:`${rows*cols}-way module connector`};}
  const n=Math.min(4,Math.max(2,nw));
  const lay={2:{W:.015,H:.0158,pitch:.00546,cav:[[-.00273,0],[.00273,0]],wl:0xe8731a},3:{W:.0184,H:.0237,pitch:.00866,cav:[[-.00433,-.0036],[.00433,-.0036],[0,.0039]],wl:0xe8731a},4:{W:.021,H:.021,pitch:.0092,cav:[[-.0046,.0046],[.0046,.0046],[.0046,-.0046],[-.0046,-.0046]],wl:0x2e9e4a}}[n];
  return Object.assign({kind:'dt',L:.0284,wire:HW[t].map((w,i)=>i),name:`Deutsch DT ${n}-way (DT04-${n}P receptacle / DT06-${n}S plug)`},lay);
}
function h3rr(w,h,r){const s=new THREE.Shape(),x=w/2,y=h/2;r=Math.min(r,x*.95,y*.95);s.moveTo(-x+r,-y);s.lineTo(x-r,-y);s.quadraticCurveTo(x,-y,x,-y+r);s.lineTo(x,y-r);s.quadraticCurveTo(x,y,x-r,y);s.lineTo(-x+r,y);s.quadraticCurveTo(-x,y,-x,y-r);s.lineTo(-x,-y+r);s.quadraticCurveTo(-x,-y,-x+r,-y);return s;}
function h3ext(shape,depth,z0,m){const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:8});g.translate(0,0,z0);return new THREE.Mesh(g,m);}
function h3Conn(spec,gd,K,sel,wiresIn,opt){
  const WIRES=wiresIn||HW[hType(HX.job.route.cid)];opt=opt||{};
  const grp=new THREE.Group(),dt=spec.kind==='dt',W=spec.W*K,H=spec.H*K,em=sel?0x0c3550:0;
  const housing=h3mat(dt?0x5d6168:0x26272b,{roughness:.55,metalness:.1,emissive:em?0x06141f:0}),gold=h3mat(0xd4a017,{metalness:.95,roughness:.22}),hole=h3mat(0x050505,{roughness:1}),wedge=h3mat(spec.wl||0x3a3a3a,{roughness:.6});
  const r=Math.min(W,H)*(dt?0.32:0.1);let body,Lm,sd=0,pinLen=0;
  if(gd==='male'){ // receptacle / module header: shroud around recessed pins
    const wall=0.0018*K,W2=W+2*wall,H2=H+2*wall;Lm=(dt?0.033:0.034)*K;sd=(dt?0.016:0.014)*K;pinLen=(dt?0.011:0.009)*K;
    body=h3ext(h3rr(W2,H2,r+wall),Lm-sd,-Lm/2,housing);grp.add(body);
    const sh=h3rr(W2,H2,r+wall);sh.holes.push(h3rr(W,H,r));grp.add(h3ext(sh,sd,Lm/2-sd,housing));
    if(dt){grp.add(h3ext(h3rr(W*0.82,H*0.7,r*0.7),0.001*K,Lm/2-sd,wedge));const ramp=new THREE.Mesh(new THREE.BoxGeometry(W*0.36,0.0022*K,0.006*K),housing);ramp.position.set(0,H2/2+0.0011*K,Lm/2-0.006*K);grp.add(ramp);}
    else{const fl=new THREE.Mesh(new THREE.BoxGeometry(W2+0.012*K,H2+0.006*K,0.002*K),housing);fl.position.z=-Lm/2+0.006*K;grp.add(fl);}
    spec.cav.forEach(([x,y],ci)=>{const used=spec.wire.includes(ci);if(!dt&&!used){const d=new THREE.Mesh(new THREE.CylinderGeometry(0.0006*K,0.0006*K,pinLen*0.7,8),h3mat(0x8c7a3a,{metalness:.7,roughness:.4}));d.rotation.x=Math.PI/2;d.position.set(x*K,y*K,Lm/2-sd+pinLen*0.35);grp.add(d);return;}
      const pin=new THREE.Mesh(new THREE.CylinderGeometry(0.0008*K,0.0008*K,pinLen,12),gold);pin.rotation.x=Math.PI/2;pin.position.set(x*K,y*K,Lm/2-sd+pinLen/2);grp.add(pin);
      const tip=new THREE.Mesh(new THREE.SphereGeometry(0.0008*K,10,6),gold);tip.position.set(x*K,y*K,Lm/2-sd+pinLen);grp.add(tip);});
  }else{ // plug (female sockets), latch on top, wedgelock on the face
    Lm=(dt?0.0284:0.04)*K;body=h3ext(h3rr(W,H,r),Lm,-Lm/2,housing);grp.add(body);
    if(dt){grp.add(h3ext(h3rr(W*0.9,H*0.84,r*0.8),0.0012*K,Lm/2,wedge));
      const lv=new THREE.Mesh(new THREE.BoxGeometry(W*0.4,0.0024*K,Lm*0.72),housing);lv.position.set(0,H/2+0.0016*K,Lm*0.04);grp.add(lv);
      const hk=new THREE.Mesh(new THREE.BoxGeometry(W*0.4,0.003*K,0.003*K),housing);hk.position.set(0,H/2+0.0028*K,Lm/2-0.004*K);grp.add(hk);}
    else{const lv=new THREE.Mesh(new THREE.BoxGeometry(0.004*K,H*0.9,Lm*0.8),h3mat(0x8a8f96,{metalness:.5}));lv.position.set(W/2+0.002*K,0,0);grp.add(lv);
      const js=new THREE.Mesh(new THREE.CylinderGeometry(0.003*K,0.003*K,0.004*K,6),h3mat(0xb8bcc4,{metalness:.9}));js.rotation.x=Math.PI/2;js.position.set(0,0,Lm/2+0.002*K);grp.add(js);}
    const zf=Lm/2+(dt?0.0013*K:0.0002*K);
    spec.cav.forEach(([x,y],ci)=>{const used=dt||spec.wire.includes(ci);
      const hl=new THREE.Mesh(new THREE.CylinderGeometry(0.0013*K,0.0013*K,0.0004*K,14),used?hole:h3mat(0x3a3d42,{roughness:.8}));hl.rotation.x=Math.PI/2;hl.position.set(x*K,y*K,zf);grp.add(hl);
      if(used){const rec=opt.recess!==undefined&&spec.wire[opt.recess]===ci;const rg=new THREE.Mesh(new THREE.TorusGeometry(0.0009*K,0.00022*K,6,14),rec?h3mat(0x6b5a1a,{metalness:.6,roughness:.6}):gold);rg.position.set(x*K,y*K,rec?zf-0.007*K:zf+0.0002*K);grp.add(rg);}});
  }
  // wires out the back (rear seal)
  grp.add(h3ext(h3rr(W*0.86,H*0.86,r*0.8),0.002*K,-Lm/2-0.002*K,h3mat(0x2a6b3a,{roughness:.8})));
  return{grp,body,Lm,sd,pinLen};
}
function h3AmpClamp(P,tg,jr,sc,vd){
  const g=new THREE.Group(),body=h3mat(0x2b2d31,{roughness:.6}),jawM=h3mat(0xd9641c,{roughness:.7}),grip=h3mat(0x3a3d42,{roughness:.95});
  g.position.copy(P);const out=vd.clone().sub(tg.clone().multiplyScalar(vd.dot(tg))).normalize(),side=new THREE.Vector3().crossVectors(tg,out).normalize();
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side,out,tg));
  const R=Math.max(jr*1.25,0.004*sc),T=Math.max(jr*0.35,0.0025*sc);
  const jaw=new THREE.Mesh(new THREE.TorusGeometry(R,T,10,32,Math.PI*1.82),jawM);jaw.rotation.z=-Math.PI/2+0.16;g.add(jaw);
  const neck=new THREE.Mesh(new THREE.BoxGeometry(0.02*sc,0.025*sc,0.016*sc),body);neck.position.set(0,R+0.012*sc,0);g.add(neck);
  const hd=h3ext(h3rr(0.03*sc,0.09*sc,0.008*sc),0.022*sc,-0.011*sc,body);hd.position.y=R+0.068*sc;g.add(hd);
  for(let i=0;i<6;i++){const r=new THREE.Mesh(new THREE.BoxGeometry(0.031*sc,0.003*sc,0.023*sc),grip);r.position.set(0,R+0.045*sc+i*0.008*sc,0);g.add(r);}
  const trig=new THREE.Mesh(new THREE.BoxGeometry(0.008*sc,0.03*sc,0.012*sc),jawM);trig.position.set(0.019*sc,R+0.03*sc,0);g.add(trig);
  const zb=new THREE.Mesh(new THREE.CylinderGeometry(0.004*sc,0.004*sc,0.003*sc,14),h3mat(0xd9641c));zb.rotation.x=Math.PI/2;zb.position.set(0,R+0.09*sc,0.0125*sc);g.add(zb);
  g.updateMatrixWorld(true);
  const a=g.localToWorld(new THREE.Vector3(0,R+0.115*sc,0)),b=g.localToWorld(new THREE.Vector3(0,R+0.2*sc,0)),c=b.clone().add(new THREE.Vector3(0,-0.4*sc,0)).add(vd.clone().multiplyScalar(0.1*sc));
  const cab=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a,b,c]),40,0.002*sc,8,false),body);
  const holder=new THREE.Group();holder.add(g);holder.add(cab);return holder;
}
function h3RouteDir(rt,j){const p=V3(rt.nodes[j].pos);if(j<rt.segs.length){const nx=V3(rt.segs[j].via[0]||rt.nodes[j+1].pos);return nx.sub(p).normalize();}const pv=V3(rt.segs[j-1].via.slice(-1)[0]||rt.nodes[j-1].pos);return p.clone().sub(pv).normalize();}
// the rest of the vehicle harness: every other circuit's loom, connectors and sensors (plugged in, not part of the job)
function h3BgHarness(lvl,act){
  const key=lvl+'|'+(act?act.cid+'|'+[...HX.unplug].sort().join(','):'-');if(H3.bg&&H3.bg.key===key)return H3.bg.g;
  // where the active circuit has a connector unplugged, every other harness piece at that connector follows the moved half
  const ovr={};if(act&&HX.unplug.size)act.nodes.forEach((nd,j)=>{if(HX.unplug.has(j))['u','d'].forEach(sd=>{const R=H3.rear&&H3.rear[j+sd];if(R)ovr[nd.pos.join()+'|'+sd]=R;});});
  if(H3.bg)H3.bg.g.traverse(o=>{if(o.geometry)o.geometry.dispose();});
  const g=new THREE.Group();g.userData.env=true;const eng=lvl===3,rad=eng?0.010:0.016,K=eng?2.0:3.2;
  const drawnC=new Set(),drawnS=new Set(),drawnM=new Set(),anchors={},trunkSegs=[];H3.trunkPts=new Map();
  const segKey=(rt,i)=>JSON.stringify([rt.nodes[i].pos,rt.nodes[i+1].pos,rt.segs[i].via]);
  if(act){act.nodes.forEach(nd=>drawnC.add(nd.pos.join()));act.segs.forEach((sg,i)=>drawnS.add(segKey(act,i)));drawnM.add((act.modPos||[]).join());}
  HROUTES[lvl].forEach(rt=>{
    if(act&&rt.cid===act.cid)return;
    const eng=lvl===3||!!rt.eng,rad=eng?0.010:0.016,K=eng?2.0:3.2;
    const t=hType(rt.cid),wires=HW[t],n=rt.nodes.length,rear={};
    if(rt.modPos&&!drawnM.has(rt.modPos.join())){drawnM.add(rt.modPos.join());{const mg=h3ModuleModel(rt.module,eng);mg.position.copy(V3(rt.modPos));mg.rotation.y=rt.module==='Instrument cluster'?-Math.PI/2:rt.modPos[2]<0?Math.PI:0;g.add(mg);}}
    rt.nodes.forEach((nd,j)=>{
      const p=V3(nd.pos),dir=h3RouteDir(rt,j),spec=hConnSpec(j,rt),vd=h3ViewDir('c'+j,p,!eng),out=j===0?vd.clone():vd.clone().sub(dir.clone().multiplyScalar(vd.dot(dir)));if(out.length()<0.2)out.set(0,1,0);out.normalize();
      const outish=out.clone().add(new THREE.Vector3(0,0.3,0)).normalize(),A=j===0?outish.clone():j===n-1&&!rt.under?outish.clone().negate():dir.clone();
      const showJ=!drawnC.has(nd.pos.join());drawnC.add(nd.pos.join());
      ['u','d'].forEach(side=>{
        const gd=hGenderR(rt,j,side),sgn=side==='u'?-1:1,C=h3Conn(spec,gd,K,false,wires),nf=A.clone().multiplyScalar(-sgn),back=gd==='male'?C.Lm/2-C.sd:C.Lm/2,c=p.clone().sub(nf.clone().multiplyScalar(back));
        C.grp.position.copy(c);C.grp.lookAt(c.clone().add(nf));C.grp.updateMatrixWorld(true);
        rear[j+side]={p:C.grp.localToWorld(new THREE.Vector3(0,0,-C.Lm/2-0.011*K)),d:C.grp.localToWorld(new THREE.Vector3(0,0,-C.Lm/2-1)).sub(C.grp.localToWorld(new THREE.Vector3(0,0,-C.Lm/2))).normalize(),...h3Seal(C.grp,spec,K,C.Lm)};
        const ov=ovr[nd.pos.join()+'|'+side];
        if(ov){const nw=wires.length,cav=ov.cav.length===nw?ov.cav:wires.map((w,k)=>ov.all[Math.floor((k+0.5)*ov.all.length/nw)]);rear[j+side]={p:ov.p.clone(),d:ov.d.clone(),cav,all:ov.all};}
        if(showJ)g.add(C.grp);
      });
      const ak=nd.pos.join()+'|'+j;if(!anchors[ak])anchors[ak]=rear[j+'d'];
    });
    rt.segs.forEach((sg,i)=>{const sk=segKey(rt,i);if(drawnS.has(sk))return;drawnS.add(sk);const RA=rear[i+'d'],RB=rear[(i+1)+'u'],ext=K*0.03,tk=hSegTrunk(lvl,rt,i);
      const cv=new THREE.CatmullRomCurve3([RA.p,RA.p.clone().add(RA.d.clone().multiplyScalar(i===0?K*0.06:ext)),...sg.via.map(V3),RB.p.clone().add(RB.d.clone().multiplyScalar(ext)),RB.p]);
      const TL=eng?0.028:0.045,tag=j=>(rt.nodes[j].id==='J1'?'J1':rt.cid.toUpperCase().replace(/^INJ/,'INJ')+' '+rt.nodes[j].id);
      const L=h3Loom(g,cv,rad,{lite:true,eng,wires,capA:RA.cav,backA:RA.d,capB:RB.cav,backB:RB.d,tailA:tk?0:TL,tailB:TL,tagA:tk?null:tag(i),tagB:tag(i+1),sleeve:sg.sleeve});if(!tk)h3HarnessHw(g,cv,rad,eng,L.a,L.b);else trunkSegs.push([cv,tk]);});
    if(!rt.cid.startsWith('inj'))h3cyl(g,eng?0.025:0.04,eng?0.06:0.1,rt.compPos,'y',h3mat(0xf5a623));
  });
  (HTRUNK[lvl]||[]).forEach(tk=>{const a=HROUTES[lvl].find(r=>r.cid===tk.cid),RA=anchors[a.nodes[tk.j].pos.join()+'|'+tk.j];if(!RA)return;const eng=lvl===3||!!a.eng,K=eng?2.0:3.2;
    const cv=new THREE.CatmullRomCurve3([RA.p,RA.p.clone().add(RA.d.clone().multiplyScalar(tk.j===0?K*0.06:K*0.03)),...tk.pts.map(V3)]);
    const pal=[];HROUTES[lvl].forEach(r2=>HW[hType(r2.cid)].forEach(w=>{if(pal.length<10&&!pal.some(x=>x[2]===w[2]&&pal.filter(y=>y[2]===w[2]).length>2))pal.push(w);}));
    const nT=Math.min(pal.length,RA.all.length),wT=pal.slice(0,nT),capT=wT.map((w,k)=>RA.all[Math.floor((k+0.5)*RA.all.length/nT)]);
    const L=h3Loom(g,cv,tk.r,{lite:true,eng,wires:wT,capA:capT,backA:RA.d,tailA:eng?0.03:0.045,tagA:tk.j===0?'J1':'X1'});L.tube.userData.trunk=true;h3HarnessHw(g,cv,tk.r,eng,L.a,1);
    const TP=[];for(let i=0;i<=120;i++)TP.push(cv.getPointAt(i/120));H3.trunkPts.set(tk,TP);});
  trunkSegs.forEach(([cv,tk])=>h3Breakout(g,cv,tk,tk.r<0.015?0.010:rad));
  H3.bg={key,g};return g;
}
function h3Vis(o){while(o){if(!o.visible)return false;o=o.parent;}return true;}
function h3RedX(p,size){
  const cv=document.createElement('canvas');cv.width=cv.height=128;const c=cv.getContext('2d');c.strokeStyle='#ff2a1f';c.lineWidth=18;c.lineCap='round';
  c.beginPath();c.moveTo(24,24);c.lineTo(104,104);c.moveTo(104,24);c.lineTo(24,104);c.stroke();
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),depthTest:false,transparent:true}));sp.raycast=()=>{};sp.position.copy(p);sp.scale.set(size,size,1);sp.renderOrder=10;return sp;
}
function h3ViewDir(sec,p,l4){
  if(!l4&&p&&(HX.job?HX.job.level:DMM.level)>=4)p=p.clone().sub(new THREE.Vector3(ENG_OFF[0],ENG_OFF[1],ENG_OFF[2]));
  if(sec==='ov')return l4?new THREE.Vector3(0.55,0.65,1):new THREE.Vector3(0.6,0.55,1);
  if(!l4&&p.x>0.5&&p.y>1.15&&p.z<0)return new THREE.Vector3(0.95,0.85,0.2).normalize();
  if(l4&&Math.abs(p.z)>0.6&&(Math.abs(p.x-2.2)<0.6||p.x<-3.5))return new THREE.Vector3(-1,0.32,p.z>0?-0.12:0.12).normalize();
  return new THREE.Vector3(l4?0.2:(p.x<-0.55?-0.9:0.3),l4?0.7:0.55,p.z<-0.05?-1:1).normalize();
}
function hSetLead(node){if(hNodeUnder(node)){$('hWarn').innerHTML='<span class="bad">That point is under the valve cover. Remove the cover first.</span>';return;}if(HX.tool==='clamp')hSetTool('dmm');HX[HX.next]=node;HX.next=HX.next==='red'?'black':'red';hAddTime(0.5);h3Build();hRenderAll();}
// ---------- 3D view ----------
let H3=null;
function h3Init(){
  h3LoadEngineModel();
  if(H3)return true;
  const box=$('h3d');
  if(typeof THREE==='undefined'||!THREE.OrbitControls){box.innerHTML='<p class="muted" style="padding:20px">3D view could not load. Use the section list.</p>';return false;}
  let renderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true});}catch(e){box.innerHTML='<p class="muted" style="padding:20px">WebGL is not available in this browser. Use the section list.</p>';return false;}
  renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));box.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x050507);scene.fog=new THREE.Fog(0x050507,8,40);
  const camera=new THREE.PerspectiveCamera(42,1,0.01,200);
  const controls=new THREE.OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=0.12;controls.screenSpacePanning=true;
  scene.add(new THREE.HemisphereLight(0xdde6ff,0x202026,0.85));const d3=new THREE.DirectionalLight(0xfff2e0,0.4);d3.position.set(5,1,-3);scene.add(d3);
  const d1=new THREE.DirectionalLight(0xffffff,0.85);d1.position.set(3,6,4);scene.add(d1);
  const d2=new THREE.DirectionalLight(0x88aaff,0.35);d2.position.set(-4,2,-3);scene.add(d2);
  const world=new THREE.Group();scene.add(world);
  const labels=document.createElement('div');labels.className='h3labels';box.appendChild(labels);
  H3={renderer,scene,camera,controls,world,labels,labs:[],pick:[],tween:null,secs:{},envs:{}};
  const resize=()=>{const w=box.clientWidth||600,h=box.clientHeight||440;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
  resize();if(window.ResizeObserver)new ResizeObserver(resize).observe(box);
  let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{if(!down)return;const dx=e.clientX-down[0],dy=e.clientY-down[1];down=null;if(dx*dx+dy*dy>25)return;
    const r=renderer.domElement.getBoundingClientRect(),m=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
    const rc=new THREE.Raycaster();rc.setFromCamera(m,camera);
    if(e.shiftKey){rc.params.Line.threshold=0.0001;const h=rc.intersectObjects(H3.world.children,true).find(x=>x.object.isMesh&&h3Vis(x.object)&&!(x.object.material.transparent&&x.object.material.opacity<0.5));
      if(h){const off=camera.position.clone().sub(controls.target);H3.tween={t0:performance.now(),ft:controls.target.clone(),tt:h.point.clone(),fp:camera.position.clone(),tp:h.point.clone().add(off)};}return;}
    const hit=rc.intersectObjects(H3.pick,false)[0];if(hit&&hit.object.userData.node)hSetLead(hit.object.userData.node);else if(hit&&hit.object.userData.sec)hGo(hit.object.userData.sec);});
  const loop=()=>{requestAnimationFrame(loop);if(!box.offsetParent)return;
    if(H3.tween){const p=Math.min(1,(performance.now()-H3.tween.t0)/700),k=p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;controls.target.lerpVectors(H3.tween.ft,H3.tween.tt,k);camera.position.lerpVectors(H3.tween.fp,H3.tween.tp,k);if(p>=1)H3.tween=null;}
    controls.update();renderer.render(scene,camera);
    const w=box.clientWidth,h=box.clientHeight;
    H3.frame=(H3.frame||0)+1;
    if(H3.frame%12===0){const rc=new THREE.Raycaster();rc.params.Line.threshold=0.0001;const cp=camera.position;
      H3.labs.forEach(L=>{const dv=L.pos.clone().sub(cp),dist=dv.length();rc.set(cp,dv.normalize());rc.far=dist;
        const hit=rc.intersectObjects(H3.world.children,true).find(x=>x.object.isMesh&&h3Vis(x.object)&&!(x.object.material.transparent&&x.object.material.opacity<0.5));
        L.el.style.opacity=hit&&hit.distance<dist*0.97?'0.28':'';});}
    H3.labs.forEach(L=>{const v=L.pos.clone().project(camera);if(v.z>1||v.z<-1){L.el.style.display='none';return;}L.el.style.display='';L.el.style.left=((v.x+1)/2*w)+'px';L.el.style.top=((1-v.y)/2*h)+'px';});};
  loop();
  return true;
}
const V3=a=>new THREE.Vector3(a[0],a[1],a[2]);
function h3mat(c,o){return new THREE.MeshStandardMaterial(Object.assign({color:c,metalness:0.35,roughness:0.62},o||{}));}
function h3box(g,s,p,m){const o=new THREE.Mesh(new THREE.BoxGeometry(s[0],s[1],s[2]),m);o.position.set(p[0],p[1],p[2]);g.add(o);return o;}
function h3cyl(g,r,len,p,axis,m,seg){const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,seg||28),m);o.position.set(p[0],p[1],p[2]);if(axis==='x')o.rotation.z=Math.PI/2;if(axis==='z')o.rotation.x=Math.PI/2;g.add(o);return o;}
function h3label(text,pos,cls,sec){const d=document.createElement('div');d.className='h3lab '+(cls||'');d.textContent=text;if(sec){d.dataset.sec=sec;d.addEventListener('click',()=>hGo(sec));}H3.labels.appendChild(d);H3.labs.push({el:d,pos:pos.clone()});return d;}
let ENVLABS=null;
function h3envlab(t,p){if(ENVLABS)ENVLABS.push([t,p]);}
function h3torus(g,R,t,p,axis,m){const o=new THREE.Mesh(new THREE.TorusGeometry(R,t,10,40),m);o.position.set(p[0],p[1],p[2]);if(axis==='x')o.rotation.y=Math.PI/2;if(axis==='y')o.rotation.x=Math.PI/2;g.add(o);return o;}
function h3tube(g,pts,r,m,closed,seg){const c=new THREE.CatmullRomCurve3(pts.map(V3),!!closed);const o=new THREE.Mesh(new THREE.TubeGeometry(c,seg||Math.max(16,pts.length*12),r,8,!!closed),m);g.add(o);return o;}
function h3cast(g,s,p,m,b){const sh=new THREE.Shape(),w=s[0]/2-b,h=s[1]/2-b;sh.moveTo(-w,-h);sh.lineTo(w,-h);sh.lineTo(w,h);sh.lineTo(-w,h);sh.lineTo(-w,-h);
  const geo=new THREE.ExtrudeGeometry(sh,{depth:Math.max(0.001,s[2]-2*b),bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:2,curveSegments:2});geo.center();const o=new THREE.Mesh(geo,m);o.position.set(p[0],p[1],p[2]);g.add(o);return o;}
function h3rbox(g,s,p,m,r){const sh=new THREE.Shape(),w=s[0]/2,d=s[2]/2;r=Math.min(r||0.03,w*0.9,d*0.9);
  sh.moveTo(-w+r,-d);sh.lineTo(w-r,-d);sh.quadraticCurveTo(w,-d,w,-d+r);sh.lineTo(w,d-r);sh.quadraticCurveTo(w,d,w-r,d);sh.lineTo(-w+r,d);sh.quadraticCurveTo(-w,d,-w,d-r);sh.lineTo(-w,-d+r);sh.quadraticCurveTo(-w,-d,-w+r,-d);
  const geo=new THREE.ExtrudeGeometry(sh,{depth:s[1],bevelEnabled:false,curveSegments:6});geo.rotateX(-Math.PI/2);geo.center();const o=new THREE.Mesh(geo,m);o.position.set(p[0],p[1],p[2]);g.add(o);return o;}
function h3prof(g,pts,width,zc,m,em){const sh=new THREE.Shape();sh.moveTo(pts[0][0],pts[0][1]);pts.slice(1).forEach(p=>sh.lineTo(p[0],p[1]));
  const geo=new THREE.ExtrudeGeometry(sh,{depth:width,bevelEnabled:false,curveSegments:16});geo.translate(0,0,zc-width/2);g.add(new THREE.Mesh(geo,m));if(em)g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo,25),em));}
function h3line(g,pts,em){g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(V3)),em));}
// ---- MX-13-style inline six. +x = front (fan), -x = flywheel end, +z = left (driver / intake) side ----
// ---------- Blender engine model (glTF). Falls back to the built-in geometry if it can't load ----------
const ENG3D={state:'idle',scene:null};
function h3LoadEngineModel(){
  if(ENG3D.state!=='idle')return;
  if(!THREE.GLTFLoader){ENG3D.state='fail';return;}
  ENG3D.state='loading';
  const fail=e=>{console.warn('Engine model failed to load; using built-in geometry.',e);ENG3D.state='fail';};
  // hosts that won't serve .glb get the same bytes as base64 text (see scripts/preview.sh)
  const getBin=u=>fetch(new URL(u,document.baseURI)).then(r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer();});
  getBin('models/mx13_engine.glb').catch(()=>fetch(new URL('models/mx13_engine.glb.b64.txt',document.baseURI)).then(r=>{if(!r.ok)throw new Error(r.status);return r.text();}).then(t=>Uint8Array.from(atob(t.trim()),c=>c.charCodeAt(0)).buffer)).then(buf=>{
    const gl=new THREE.GLTFLoader();
    gl.parse(buf,'',g=>{
      g.scene.traverse(o=>{if(o.name==='ValveCover')o.userData.cover=true;if(o.name==='Inside'){o.userData.inside=true;o.visible=false;}if(o.isMesh&&!o.material.userData.fixed){o.material.side=THREE.FrontSide;o.material.color.convertLinearToSRGB();o.material.userData.fixed=true;}});
      ENG3D.scene=g.scene;ENG3D.state='ready';H3MNT.clear();
      if(H3){delete H3.envs[3];delete H3.envs[4];H3.bg=null;h3Build();}
    },fail);}).catch(fail);
}
function h3EnvEngine(g,inTruck){
  if(ENG3D.state==='ready'){
    const m=ENG3D.scene.clone(true);g.add(m);
    if(!inTruck){const grid=new THREE.GridHelper(6,30,0x1a1a22,0x111116);grid.position.y=-0.24;g.add(grid);
      h3envlab('FRONT ▸',[1.0,0.55,0]);h3envlab('◂ FLYWHEEL END · REAR GEAR TRAIN',[-1.05,0.95,0]);
      h3envlab('VGT TURBO',[-0.18,1.25,-0.6]);h3envlab('EGR COOLER',[0.15,1.33,-0.4]);h3envlab('COMMON RAIL',[0.15,0.73,0.43]);}
    return;}
  h3EnvEngineBuiltIn(g,inTruck);
}
function h3EnvEngineBuiltIn(g,inTruck){
  const M={cgi:h3mat(0x3a3e45,{metalness:.45,roughness:.6}),alu:h3mat(0xa3a9b1,{metalness:.7,roughness:.35}),cast:h3mat(0x5f646c,{metalness:.5,roughness:.55}),blk:h3mat(0x1b1c1f,{metalness:.25,roughness:.7}),rub:h3mat(0x0f0f10,{metalness:0,roughness:.95}),stl:h3mat(0xc9ced6,{metalness:.9,roughness:.22}),hot:h3mat(0x6e5a48,{metalness:.75,roughness:.5}),cov:h3mat(0x2a2d32,{metalness:.4,roughness:.4}),ylw:h3mat(0xe0a800,{roughness:.5}),blu:h3mat(0x2a5d9e,{metalness:.3,roughness:.5})};
  // oil pan, block (with ribs and core plugs), head, valve cover
  h3cast(g,[1.2,.2,.46],[0,0,0],M.cast,.012);h3cast(g,[0.5,.14,.38],[0.28,-.15,0],M.cast,.012);
  h3cast(g,[1.25,.016,.5],[0,0.106,0],M.cast,.004);for(let i=0;i<12;i++)[1,-1].forEach(s=>h3cyl(g,.007,.012,[-0.56+i*0.102,0.118,s*0.236],'y',M.stl,6));
  h3cyl(g,.014,.02,[0.4,-0.2,0.2],'z',M.stl,6); // drain plug
  // block: cast body with bevels, siamesed bore bulges, ribs, main-bearing bolt bosses, mount pads, core plugs
  h3cast(g,[1.3,.68,.6],[-0.02,.44,0],M.cgi,.018);
  for(let i=0;i<6;i++){const x=0.47-i*0.188;[1,-1].forEach(s=>{const b=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.36,24,1,false,s>0?0:Math.PI,Math.PI),M.cgi);b.position.set(x,.6,s*.27);g.add(b);});}
  for(let i=0;i<7;i++){const x=0.565-i*0.188;[1,-1].forEach(s=>{h3cast(g,[.03,.44,.05],[x,.36,s*.31],M.cgi,.006);h3cyl(g,.022,.05,[x,.14,s*.315],'y',M.cgi,12);h3cyl(g,.011,.012,[x,.112,s*.315],'y',M.stl,6);});}
  h3cast(g,[1.28,.05,.06],[-0.02,.78,.31],M.cgi,.008);h3cast(g,[1.28,.05,.06],[-0.02,.78,-.31],M.cgi,.008);
  [-.32,.04,.4].forEach(x=>[1,-1].forEach(s=>{h3cyl(g,.026,.012,[x,.42,s*.336],'z',M.stl,18);}));
  [1,-1].forEach(s=>{h3cast(g,[.14,.1,.04],[0.5,.3,s*.33],M.cgi,.01);[-0.04,0.04].forEach(dx=>h3cyl(g,.01,.012,[0.5+dx,.3,s*.355],'z',M.stl,6));});
  h3cast(g,[.36,.16,.03],[-0.15,.5,-.335],M.cast,.01);for(let i=0;i<8;i++)h3cyl(g,.006,.01,[-0.3+(i%4)*0.1,i<4?.43:.57,-.352],'z',M.stl,6); // oil cooler cover
  // cylinder head: cast with port bosses and head-bolt bosses
  h3cast(g,[1.26,.22,.58],[-0.01,.89,0],M.cgi,.014);
  for(let i=0;i<7;i++){const x=0.565-i*0.188;[1,-1].forEach(s=>{h3cyl(g,.02,.2,[x,.89,s*.295],'y',M.cgi,12);});}
  for(let i=0;i<6;i++){const x=0.47-i*0.188;h3cast(g,[.09,.07,.03],[x,.86,-.3],M.cgi,.008);}
  const CV=new THREE.Group();CV.userData.cover=true;g.add(CV);
  h3rbox(CV,[1.2,.11,.5],[0,1.055,0],M.cov,.06);
  [.12,-.12].forEach(z=>h3box(CV,[1.08,.02,.03],[0,1.118,z],M.cov));
  for(let i=0;i<7;i++){const x=-0.55+i*0.183;[.22,-.22].forEach(z=>h3cyl(CV,.013,.02,[x,1.115,z],'y',M.stl,10));}
  h3cyl(CV,.045,.04,[-0.1,1.13,0],'y',M.ylw,20);
  h3cyl(CV,.07,.1,[0.42,1.16,0.12],'y',M.blk,20); // crankcase ventilation separator
  // under the valve cover (shown when the cover is removed)
  const IN=new THREE.Group();IN.userData.inside=true;IN.visible=false;g.add(IN);
  {const deck=h3mat(0x8d939b,{metalness:.6,roughness:.4}),cam=h3mat(0xb9bec6,{metalness:.9,roughness:.25}),rk=h3mat(0x4b5058,{metalness:.6,roughness:.45}),inj=h3mat(0xc9ced6,{metalness:.85,roughness:.25}),sol=h3mat(0x1b1c1f,{roughness:.5}),spr=h3mat(0x6e7681,{metalness:.7,roughness:.35});
   h3box(IN,[1.2,.012,.5],[0,1.006,0],deck);
   const gk=h3rr(1.2,0.5,0.06);gk.holes.push(h3rr(1.17,0.47,0.05));const gm=h3ext(gk,0.006,0,h3mat(0x1a1a1a,{roughness:.9}));gm.rotation.x=-Math.PI/2;gm.position.y=1.012;IN.add(gm);
   h3cyl(IN,.022,1.12,[0,1.05,-0.13],'x',cam,20);
   for(let i=0;i<7;i++)h3box(IN,[.04,.03,.08],[0.565-i*0.188,1.05,-0.13],deck);
   h3cyl(IN,.011,1.12,[0,1.078,-0.03],'x',cam,14);
   for(let i=1;i<=6;i++){const xi=0.47-(i-1)*0.188;
     for(let k=0;k<2;k++){const lo=h3box(IN,[.012,.03,.04],[xi-0.03+k*0.06,1.05,-0.13],cam);lo.rotation.x=0.6+i*0.9+k;}
     [-0.05,0.05].forEach(dx=>{h3box(IN,[.026,.02,.17],[xi+dx,1.078,-0.05],rk);h3box(IN,[.02,.01,.11],[xi+dx,1.058,0.03],rk);
       [-0.045,0.045].forEach(dz=>h3cyl(IN,.011,.04,[xi+dx,1.03,0.03+dz],'y',spr,12));});
     h3cyl(IN,.014,.08,[xi,1.03,0],'y',inj,18);h3cyl(IN,.017,.022,[xi,1.075,0],'y',sol,18);
     [-0.006,0.006].forEach(dx=>h3cyl(IN,.0025,.01,[xi+dx,1.091,0],'y',h3mat(0xd4a017,{metalness:.9}),8));
     h3box(IN,[.034,.01,.05],[xi,1.06,-0.028],rk);h3cyl(IN,.006,.014,[xi,1.068,-0.045],'y',inj,6);}}
  // rear gear housing + flywheel housing (rear gear train)
  h3cast(g,[.1,.85,.72],[-0.7,.6,0],M.cast,.02);
  h3cyl(g,.16,.02,[-0.755,.78,0.12],'x',M.cast,32);for(let i=0;i<8;i++){const a=i/8*Math.PI*2;h3cyl(g,.008,.012,[-0.768,.78+Math.sin(a)*.14,0.12+Math.cos(a)*.14],'x',M.stl,6);}
  for(let i=0;i<14;i++){const y=0.2+(i%7)*0.12,z=i<7?.34:-.34;h3cyl(g,.008,.012,[-0.755,y,z],'x',M.stl,6);}
  h3cyl(g,.44,.14,[-0.82,.38,0],'x',M.alu,48);h3torus(g,.44,.018,[-0.89,.38,0],'x',M.alu);
  for(let i=0;i<8;i++){const a=i/8*Math.PI*2+0.2,r=h3box(g,[.13,.03,.012],[-0.82,.38+Math.sin(a)*.44,Math.cos(a)*.44],M.alu);r.rotation.x=-a;}
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2;h3cyl(g,.009,.016,[-0.885,.38+Math.sin(a)*.415,Math.cos(a)*.415],'x',M.stl,6);}
  [1,-1].forEach(s=>h3box(g,[.12,.08,.16],[-0.8,.6,s*.5],M.blk));
  // front: cover, damper, pulleys, water pump, alternator, A/C, belt, fan
  h3box(g,[.05,.7,.58],[0.64,.48,0],M.cast);
  h3cyl(g,.17,.07,[0.70,.33,0],'x',M.blk,40);h3cyl(g,.12,.05,[0.76,.33,0],'x',M.stl,32);
  h3cyl(g,.09,.05,[0.76,.78,0],'x',M.stl,28);
  h3cyl(g,.08,.1,[0.69,.55,-.12],'x',M.alu,24);h3cyl(g,.055,.03,[0.76,.55,-.12],'x',M.stl,20);
  h3cyl(g,.1,.2,[0.6,.48,.34],'x',M.alu,28);h3cyl(g,.04,.03,[0.76,.48,.34],'x',M.stl,16);
  for(let i=0;i<10;i++){const a=i/10*Math.PI*2;h3box(g,[.18,.012,.012],[0.6,.48+Math.sin(a)*.1,.34+Math.cos(a)*.1],M.cast);}
  h3cyl(g,.085,.22,[0.6,.40,-.34],'x',M.alu,24);h3cyl(g,.06,.03,[0.76,.40,-.34],'x',M.stl,20);
  h3cyl(g,.04,.03,[0.76,.63,.18],'x',M.stl,16);
  h3tube(g,[[0,.205],[-.24,.27],[-.405,.40],[-.33,.47],[-.18,.55],[-.10,.66],[-.07,.85],[.07,.86],[.10,.70],[.18,.585],[.30,.555],[.39,.49],[.36,.40],[.24,.27]].map(([z,y])=>[0.765,y,z]),.012,M.rub,true,140);
  h3cyl(g,.06,.06,[0.82,.78,0],'x',M.blk,20);
  for(let i=0;i<9;i++){const a=i/9*Math.PI*2,b=h3box(g,[.012,.3,.09],[0.86,.78+Math.sin(a)*.2,Math.cos(a)*.2],M.blk);b.rotation.x=Math.PI/2-a;}
  h3cyl(g,.06,.12,[0.68,0.95,-0.12],'x',M.alu,20);h3tube(g,[[0.73,0.95,-.12],[0.82,0.96,-.14],[0.92,0.98,-.16]],.045,M.rub);
  [1,-1].forEach(s=>h3box(g,[.12,.1,.14],[0.55,.22,s*.36],M.blk));
  // left / intake side: intake manifold, charge air inlet, throttle, common rail, pump units, ECM, fuel filter, air compressor
  h3rbox(g,[1.05,.13,.12],[0,.89,.355],M.alu,.04);
  for(let i=0;i<6;i++)h3box(g,[.06,.06,.03],[-0.47+i*0.188,.84,.305],M.alu);
  h3tube(g,[[0.5,.9,.37],[0.64,.95,.37],[0.72,1.06,.28],[0.74,1.16,.15]],.055,M.alu);h3cyl(g,.06,.06,[0.74,1.19,.15],'y',M.rub,20);
  h3rbox(g,[.12,.1,.1],[0.47,.97,.37],M.blk,.02);
  h3cyl(g,.022,.92,[-0.01,.76,.355],'x',M.stl,16);
  for(let i=0;i<6;i++){const x=-0.45+i*0.18;h3tube(g,[[x,.76,.355],[x+0.01,.79,.35],[x+0.02,.81,.31]],.007,M.stl,false,12);}
  [-0.42,-0.30].forEach(x=>{h3rbox(g,[.09,.1,.09],[x,.56,.37],M.alu,.02);h3tube(g,[[x,.61,.37],[x-.02,.69,.37],[x-.04,.75,.36]],.008,M.stl,false,12);});
  h3cyl(g,.02,.05,[0.47,.76,.355],'x',M.stl,12);
  h3box(g,[.13,.05,.05],[0.2,.64,.37],M.blk);
  h3tube(g,[[0.2,.665,.37],[0.35,.66,.40],[0.5,.63,.41],[0.58,.6,.39]],.014,M.blk);
  h3tube(g,[[-0.08,.665,.37],[-0.2,.80,.40],[-0.15,.80,.30]],.012,M.blk);
  h3rbox(g,[.16,.1,.1],[-0.28,.45,.37],M.alu,.02);
  h3cyl(g,.065,.26,[-0.28,.27,.40],'y',M.blu,24);h3cyl(g,.07,.04,[-0.28,.41,.40],'y',M.blk,24);
  h3cyl(g,.02,.04,[-0.2,.5,.42],'y',M.blk,12);
  h3cyl(g,.09,.26,[-0.52,.28,.40],'x',M.cast,24);h3box(g,[.12,.1,.14],[-0.48,.38,.40],M.alu);
  // right / exhaust side: manifold, VGT turbo, EGR cooler + valve, oil module, filters, starter
  for(let i=0;i<3;i++)h3rbox(g,[.36,.1,.1],[-0.38+i*0.39,.87,-.36],M.hot,.03);
  for(let i=0;i<6;i++)h3box(g,[.07,.07,.06],[-0.47+i*0.188,.87,-.31],M.hot);
  h3box(g,[.14,.12,.12],[-0.30,.93,-.44],M.hot);
  h3cyl(g,.12,.12,[-0.30,1.02,-.52],'x',M.hot,32);h3torus(g,.11,.05,[-0.30,1.02,-.52],'x',M.hot);
  h3cyl(g,.06,.1,[-0.19,1.02,-.52],'x',M.cast,20);
  h3cyl(g,.13,.12,[-0.07,1.02,-.52],'x',M.alu,32);h3torus(g,.12,.045,[-0.07,1.02,-.52],'x',M.alu);
  h3cyl(g,.08,.1,[0.04,1.02,-.52],'x',M.rub,24);
  h3rbox(g,[.12,.09,.1],[-0.30,1.17,-.52],M.blk,.02);
  h3tube(g,[[-0.38,1.02,-.52],[-0.48,.98,-.6],[-0.52,.8,-.66],[-0.5,.5,-.66]],.06,M.stl);
  h3tube(g,[[-0.07,1.14,-.52],[0.1,1.32,-.5],[0.5,1.33,-.45],[0.8,1.22,-.36]],.05,M.alu);
  h3cyl(g,.075,.8,[0.12,1.19,-.37],'x',M.stl,24);[-0.28,0.52].forEach(x=>h3cyl(g,.085,.04,[x,1.19,-.37],'x',M.cast,24));
  h3rbox(g,[.12,.12,.12],[0.6,1.16,-.3],M.blk,.02);
  h3tube(g,[[0.62,1.19,-.24],[0.66,1.15,0.05],[0.6,1.02,.28],[0.52,.95,.36]],.04,M.stl);
  h3tube(g,[[-0.2,.92,-.38],[-0.36,1.07,-.37],[-0.32,1.19,-.37]],.04,M.hot);
  h3rbox(g,[.5,.2,.06],[0.18,.45,-.335],M.cast,.02);
  [0.3,0.45].forEach(x=>h3cyl(g,.06,.24,[x,.22,-.40],'y',M.blk,24));
  h3cyl(g,.05,.18,[0.08,.26,-.40],'y',M.blu,20);
  h3cyl(g,.08,.32,[-0.6,.22,-.36],'x',M.blk,24);h3cyl(g,.04,.16,[-0.55,.33,-.40],'x',M.stl,16);
  if(!inTruck){
    const grid=new THREE.GridHelper(6,30,0x1a1a22,0x111116);grid.position.y=-0.24;g.add(grid);
    h3envlab('FRONT ▸',[1.0,0.55,0]);h3envlab('◂ FLYWHEEL END · REAR GEAR TRAIN',[-1.05,0.95,0]);
    h3envlab('VGT TURBO',[-0.18,1.25,-0.6]);h3envlab('EGR COOLER',[0.15,1.33,-0.4]);h3envlab('COMMON RAIL',[0.15,0.73,0.43]);
  }
}
// ---- W990-style 6x4 long-hood tractor. +x = front, +z = left (driver) side ----
function h3EnvChassis(g){
  const M={frame:h3mat(0x26292e,{metalness:.55,roughness:.5}),stl:h3mat(0xcfd4db,{metalness:.9,roughness:.2}),alu:h3mat(0xb7bdc5,{metalness:.8,roughness:.3}),tire:h3mat(0x121212,{roughness:.95,metalness:0}),blk:h3mat(0x1c1d20,{metalness:.3,roughness:.65}),dark:h3mat(0x33363c,{metalness:.5,roughness:.5}),bag:h3mat(0x161616,{roughness:.9}),def:h3mat(0x2a5d9e,{metalness:.3,roughness:.5}),tank:h3mat(0x8e949c,{metalness:.6,roughness:.4})};
  const X0=3.05,X1=-6.0,L=X0-X1,XC=(X0+X1)/2;
  // C-channel rails, flanges open inward, crossmembers
  [1,-1].forEach(s=>{h3box(g,[L,.28,.012],[XC,.95,s*.445],M.frame);h3box(g,[L,.012,.08],[XC,1.084,s*.405],M.frame);h3box(g,[L,.012,.08],[XC,.816,s*.405],M.frame);});
  [2.95,2.0,0.95,-0.6,-1.6,-2.7,-3.35,-4.65,-5.95].forEach(x=>h3box(g,[.1,.2,.8],[x,.95,0],M.frame));
  // front end: bumper, set-forward axle, taper-leaf springs, steering gear, tie rod, radiator + CAC
  h3box(g,[.14,.32,2.45],[3.18,.86,0],M.stl);
  h3box(g,[.14,.13,1.85],[2.2,.5,0],M.dark);
  [1,-1].forEach(s=>{for(let k=0;k<4;k++)h3box(g,[1.3-k*0.22,.022,.08],[2.2,.6+k*.024,s*.445],M.dark);h3cyl(g,.04,.2,[2.2,.52,s*.9],'y',M.dark,12);h3cyl(g,.08,.06,[2.2,.52,s*.84],'z',M.blk,16);});
  h3rbox(g,[.2,.2,.18],[2.85,.95,.56],M.blk,.03);h3cyl(g,.02,1.6,[2.45,.5,0],'z',M.stl,10);
  h3box(g,[.06,1.0,1.0],[2.66,1.6,0],M.blk);h3box(g,[.05,.95,1.0],[2.74,1.6,0],M.dark);
  // wheels
  const wheel=(x,z)=>{h3cyl(g,.52,.28,[x,.52,z],'z',M.tire,44);[-0.08,0,0.08].forEach(o=>h3torus(g,.52,.008,[x,.52,z+o],'z',M.blk));
    h3cyl(g,.3,.29,[x,.52,z],'z',M.alu,32);h3cyl(g,.1,.31,[x,.52,z],'z',M.stl,20);};
  [1,-1].forEach(s=>wheel(2.2,s*1.02));
  [-4.0,-5.3].forEach(x=>{
    h3cyl(g,.08,2.0,[x,.52,0],'z',M.dark,16);const d=new THREE.Mesh(new THREE.SphereGeometry(.24,24,16),M.dark);d.position.set(x,.52,0);g.add(d);h3cyl(g,.14,.3,[x+.2,.52,0],'x',M.dark,20);
    [1,-1].forEach(s=>{wheel(x,s*.98);wheel(x,s*1.3);h3cyl(g,.09,.1,[x+.25,.64,s*.65],'x',M.blk,16);
      h3cyl(g,.13,.2,[x-.38,.72,s*.45],'y',M.bag,24);h3box(g,[1.05,.08,.1],[x+.1,.62,s*.45],M.dark);h3box(g,[.12,.3,.1],[x+.6,.74,s*.45],M.dark);});
  });
  // driveline
  h3rbox(g,[.75,.42,.42],[0.40,1.18,0],M.alu,.08);
  h3tube(g,[[0.0,1.12,0],[-1.8,0.88,0],[-3.75,0.62,0]],.05,M.stl);h3tube(g,[[-4.2,.6,0],[-5.1,.6,0]],.045,M.stl);
  [-1.15,-1.4].forEach(x=>h3cyl(g,.14,.78,[x,.88,0],'z',M.dark,24));
  // LH: battery box with step, fuel tank. RH: DPF/SCR, tailpipe, DEF tank, fuel tank
  h3box(g,[.7,.48,.6],[0.4,.6,.82],M.stl);h3box(g,[.72,.02,.62],[0.4,.855,.82],M.alu);
  h3cyl(g,.31,1.7,[-1.0,.66,.87],'x',M.tank,40);[-0.45,-1.55].forEach(x=>h3torus(g,.315,.02,[x,.66,.87],'x',M.stl));h3cyl(g,.05,.04,[-0.4,.98,.87],'y',M.stl,16);
  h3cyl(g,.31,1.5,[-1.7,.66,-.87],'x',M.tank,40);[-1.15,-2.25].forEach(x=>h3torus(g,.315,.02,[x,.66,-.87],'x',M.stl));h3cyl(g,.05,.04,[-1.1,.98,-.87],'y',M.stl,16);
  [[-0.45,1],[-1.55,1],[-1.15,-1],[-2.25,-1]].forEach(([x,s])=>h3box(g,[.1,.36,.2],[x,.82,s*.52],M.dark));
  h3rbox(g,[1.1,.6,.62],[0.35,.72,-.86],M.stl,.25);[-0.05,0.75].forEach(x=>h3torus(g,.33,.02,[x,.72,-.86],'x',M.dark));
  h3tube(g,[[1.15,1.25,-0.66],[1.05,1.05,-.75],[0.95,.85,-.82],[0.9,.75,-.86]],.06,M.stl);
  h3tube(g,[[-0.2,.75,-.86],[-0.28,.85,-1.0],[-0.32,1.05,-1.05]],.06,M.stl);
  h3cyl(g,.065,3.0,[-0.32,2.55,-1.05],'y',M.stl,20);h3cyl(g,.085,1.0,[-0.32,1.75,-1.05],'y',M.alu,20);
  h3rbox(g,[.42,.44,.5],[-0.67,.70,-.83],M.dark,.06);h3cyl(g,.05,.04,[-0.55,.94,-.98],'y',M.def,16);
  h3tube(g,[[-0.5,.85,-.62],[-0.1,.95,-.6],[0.3,1.0,-.6]],.006,M.def);
  // air tanks (primary upper, secondary lower) on the left rail behind the fuel tank
  [[0.86,'P'],[0.56,'S']].forEach(([y])=>{h3cyl(g,.14,.85,[-2.55,y,.72],'x',M.tank,32);[-2.2,-2.9].forEach(x=>h3torus(g,.142,.012,[x,y,.72],'x',M.dark));h3cyl(g,.015,.05,[-2.55,y-.15,.72],'y',M.stl,8);});
  [-2.25,-2.85].forEach(x=>h3box(g,[.06,.50,.14],[x,.65,.52],M.dark));
  // 5th wheel, mud flaps
  h3box(g,[.95,.07,.95],[-4.55,1.27,0],M.blk);[1,-1].forEach(s=>{h3box(g,[.6,.12,.1],[-4.55,1.16,s*.42],M.dark);h3box(g,[.01,.55,.6],[-5.78,.5,s*1.13],M.blk);});
  // air lines and other harness looms inside the rails
  [1,-1].forEach(s=>{h3tube(g,[[2.6,.98,s*.425],[-5.7,.98,s*.425]],.008,s>0?h3mat(0x2f6fd0):h3mat(0xc23030),false,8);
    h3tube(g,[[2.6,.9,s*.425],[-5.7,.9,s*.425]],.018,M.blk,false,8);
    for(let x=2.4;x>-5.6;x-=0.6)h3box(g,[.03,.06,.015],[x,.9,s*.432],M.dark);});
  // translucent body: long hood, fenders, cab, mid-roof sleeper
  const sm=new THREE.MeshStandardMaterial({color:0x3b8fd9,transparent:true,opacity:0.06,depthWrite:false,side:THREE.DoubleSide}),em=new THREE.LineBasicMaterial({color:0x3b8fd9,transparent:true,opacity:0.42});
  h3prof(g,[[0.95,1.3],[0.95,2.18],[2.3,2.14],[2.95,2.06],[3.12,1.96],[3.12,1.35],[2.9,1.28]],1.3,0,sm,em);
  [1,-1].forEach(s=>{const pts=[];for(let i=0;i<=16;i++){const a=Math.PI*(0.97-0.94*i/16);pts.push([2.2+Math.cos(a)*.68,.52+Math.sin(a)*.68]);}
    for(let i=16;i>=0;i--){const a=Math.PI*(0.97-0.94*i/16);pts.push([2.2+Math.cos(a)*.6,.52+Math.sin(a)*.6]);}h3prof(g,pts,.36,s*1.0,sm,em);
    h3cyl(g,.07,.06,[2.82,1.22,s*.95],'x',M.alu,16);});
  h3prof(g,[[0.95,1.28],[0.95,2.18],[0.62,2.95],[-0.5,2.98],[-0.5,1.28]],2.0,0,sm,em);
  h3prof(g,[[-0.5,1.25],[-0.5,3.22],[-2.35,3.22],[-2.45,3.12],[-2.45,1.25]],2.0,0,sm,em);
  [1,-1].forEach(s=>h3line(g,[[0.85,1.35,s*1.002],[0.85,2.3,s*1.002],[0.6,2.8,s*1.002],[-0.4,2.8,s*1.002],[-0.4,1.35,s*1.002],[0.85,1.35,s*1.002]],em));
  for(let i=0;i<9;i++)h3line(g,[[3.125,1.42+i*.06,-.45],[3.125,1.42+i*.06,.45]],em);
  // engine (same MX-13-style model) between the rails
  const eg=new THREE.Group();h3EnvEngine(eg,true);eg.position.set(1.65,0.80,0);g.add(eg);
  const grid=new THREE.GridHelper(20,40,0x1a1a22,0x111116);g.add(grid);
  h3envlab('FRONT ▸',[3.5,1.0,0]);h3envlab('TANDEM DRIVE AXLES',[-4.65,0.25,1.6]);h3envlab('LH FUEL TANK',[-1.0,0.25,1.2]);
  h3envlab('BATTERY BOX / STEP',[0.4,0.25,1.15]);h3envlab('DPF / SCR',[0.35,0.3,-1.25]);h3envlab('DEF TANK',[-0.67,0.35,-1.15]);h3envlab('5TH WHEEL',[-4.55,1.45,0]);h3envlab('AIR TANKS',[-2.55,0.25,1.0]);h3envlab('TRANSMISSION',[0.40,1.5,0.0]);
}
function h3Build(){
  if(!h3Init())return;
  const W=H3.world;
  while(W.children.length){const c=W.children[0];W.remove(c);if(!c.userData.env)c.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material&&o.material.dispose)o.material.dispose();});}
  H3.labels.innerHTML='';H3.labs=[];H3.pick=[];H3.secs={};H3.pts={};
  const job=HX.job,lvl=job?job.level:DMM.level;
  if(!H3.envs[lvl]){const eg=new THREE.Group();eg.userData.env=true;ENVLABS=[];(lvl===3?h3EnvEngine:h3EnvChassis)(eg);H3.envs[lvl]={g:eg,labs:ENVLABS};ENVLABS=null;}
  W.add(H3.envs[lvl].g);if(lvl===3)H3.envs[lvl].g.traverse(o=>{if(o.userData.cover)o.visible=!(job&&HX.cover);if(o.userData.inside)o.visible=!!(job&&HX.cover);});H3.envs[lvl].labs.forEach(([t,p])=>h3label(t,V3(p),'env'));
  {const eg=H3.envs[lvl].g;eg.updateMatrixWorld(true);if(H3.mountLvl!==lvl||H3.mountSrc!==eg){H3.mountEnv=[];eg.traverse(o=>{if(o.isMesh&&o.visible!==false&&!(o.material&&o.material.transparent&&o.material.opacity<0.3)&&!(o.parent&&(o.parent.userData.inside)))H3.mountEnv.push(o);});H3.mountLvl=lvl;H3.mountSrc=eg;}}
  if(!job)W.add(h3BgHarness(lvl,null));
  if(!job){H3.secs.ov=lvl===3?{p:new THREE.Vector3(0,0.6,0),d:2.8}:{p:new THREE.Vector3(-1.5,0.9,0),d:10};return;}
  const rt=job.route,t=hType(rt.cid),n=rt.nodes.length,eng=lvl===3||!!rt.eng,rad=eng?0.010:0.016,cs=eng?0.05:0.09;
  // module & component
  const modPos=rt.modPos||[0.15,0.35,0.36];
  const remM=HX.removed&&HX.removed.has('mod'),remC=HX.removed&&HX.removed.has('comp');
  const MV=h3RemoveDelta(V3(modPos),'c0',eng?0.32:0.6,remM);H3.remDelta={mod:MV,comp:null};
  {const mg=h3ModuleModel(rt.module,eng);mg.position.copy(V3(modPos).add(MV));mg.rotation.y=rt.module==='Instrument cluster'?-Math.PI/2:modPos[2]<0?Math.PI:0;if(remM)mg.rotation.y+=0.35;W.add(mg);mg.traverse(o=>{if(o.isMesh){o.userData.sec='mod';H3.pick.push(o);}});
   if(remM)h3MountMarks(W,V3(modPos),eng,'module');}
  h3label(rt.module.toUpperCase(),V3(modPos).add(MV).add(new THREE.Vector3(0,eng?-0.2:-0.18,0)),'mod','mod');
  const cp0=V3(rt.compPos),compSel=HX.sec==='comp',CVd=h3RemoveDelta(cp0,'c'+(rt.nodes.length-1),eng?0.16:0.45,remC);H3.remDelta.comp=CVd;const cp=cp0.clone().add(CVd);
  if(!rt.cid.startsWith('inj')){const sg=h3SensorModel(rt.cid,eng,job.fault.kind==='comp'&&remC);const ax=V3(rt.nodes[rt.nodes.length-1].pos).sub(cp0).normalize();sg.position.copy(cp);sg.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),['thr','egr','vgt'].includes(rt.cid)?new THREE.Vector3(0,1,0):ax);if(remC)sg.rotateX(0.5);W.add(sg);
    sg.traverse(o=>{if(o.isMesh){o.userData.sec='comp';H3.pick.push(o);}});if(remC)h3MountMarks(W,cp0,eng,rt.cid);}
  const isInj=true;const comp=h3cyl(W,eng?(isInj?0.02:0.025):0.04,eng?(isInj?0.09:0.06):0.1,rt.compPos,'y',isInj?new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}):h3mat(0xf5a623,{emissive:compSel?0x553300:0x000000}));comp.userData.sec='comp';H3.pick.push(comp);
  h3label(rt.comp.toUpperCase(),cp.clone().add(new THREE.Vector3(0,eng?-0.08:-0.15,0)),'comp','comp');
  // connectors: Deutsch DT (inline / sensor) and large multi-cavity module connectors
  const K=eng?2.0:3.2,f=job.fault;H3.rear={};
  rt.nodes.forEach((nd,j)=>{
    const p=V3(nd.pos),sel=HX.sec==='c'+j||(j===0&&HX.sec==='mod')||(j===n-1&&HX.sec==='comp'),un=HX.unplug.has(j),spec=hConnSpec(j);
    let dir;if(j<rt.segs.length){const nx=V3(rt.segs[j].via[0]||rt.nodes[j+1].pos);dir=nx.sub(p).normalize();}else{const pv=V3(rt.segs[j-1].via.slice(-1)[0]||rt.nodes[j-1].pos);dir=p.clone().sub(pv).normalize();}
    const vd=h3ViewDir('c'+j,p,!eng),out=j===0?vd.clone():vd.clone().sub(dir.clone().multiplyScalar(vd.dot(dir)));if(out.length()<0.2)out.set(0,1,0);out.normalize();
    const L=spec.L*K,centers=[],ends=j===0||j===n-1;
    const outish=out.clone().add(new THREE.Vector3(0,0.3,0)).normalize();
    const A=j===0?outish.clone():j===n-1&&!rt.under?outish.clone().negate():dir.clone();
    const lat=dir.clone().sub(outish.clone().multiplyScalar(dir.dot(outish)));if(lat.length()<0.2)lat.set(1,0,0);lat.normalize();
    const span=Math.max(L,Math.max(spec.W,spec.H)*K);
    ['u','d'].forEach(side=>{
      const gd=hGender(j,side),sgn=side==='u'?-1:1,fixedSide=(j===0&&side==='u')||(j===n-1&&side==='d'),moves=un&&!fixedSide;
      const C=h3Conn(spec,gd,K,sel,HW[t],(f.kind==='pushed'&&f.conn===j&&gd==='female')?{recess:HW[t].findIndex(w=>w[0]===f.wire)}:{});const grp=C.grp;
      let nf,c;
      if(moves&&ends){const mo=j===0?outish.clone().add(new THREE.Vector3(0,-0.25,0)).normalize():outish;nf=mo.clone();c=p.clone().add(mo.clone().multiplyScalar(j===0?span*1.7+(eng?0.06:0.1):span*0.9)).add(lat.clone().multiplyScalar(sgn*span*(j===0?0.9:1.3)));} // unplugged at a module/sensor: pulled out away from the engine/frame, the way you'd hold it
      else if(moves){nf=out.clone().add(new THREE.Vector3(0,0.35,0)).add(dir.clone().multiplyScalar(sgn*0.25)).normalize();c=p.clone().add(dir.clone().multiplyScalar(sgn*span*1.1)).add(out.clone().multiplyScalar(span*0.8));}
      else{nf=A.clone().multiplyScalar(-sgn);const back=gd==='male'?C.Lm/2-C.sd:C.Lm/2;c=p.clone().sub(nf.clone().multiplyScalar(back));if(fixedSide&&j===0&&H3.remDelta.mod)c.add(H3.remDelta.mod);if(fixedSide&&j===n-1&&H3.remDelta.comp)c.add(H3.remDelta.comp);}
      grp.position.copy(c);grp.lookAt(c.clone().add(nf));W.add(grp);grp.updateMatrixWorld(true);centers.push(c);
      {const rp=grp.localToWorld(new THREE.Vector3(0,0,-C.Lm/2-0.011*K)),rd=grp.localToWorld(new THREE.Vector3(0,0,-C.Lm/2-1)).sub(grp.localToWorld(new THREE.Vector3(0,0,-C.Lm/2))).normalize();H3.rear[j+side]={p:rp,d:rd,...h3Seal(grp,spec,K,C.Lm)};}
      HW[t].forEach((w,wi)=>{
        const nn=`c${j}${side}_${w[0]}`,[x,y]=spec.cav[spec.wire[wi]].map(v=>v*K);
        const lp=un?new THREE.Vector3(x,y,gd==='male'?C.Lm/2-C.sd+C.pinLen:C.Lm/2+0.0012*K):new THREE.Vector3(x+0.0022*K,y,-C.Lm/2-0.002*K);
        const P=grp.localToWorld(lp.clone());
        const lat=grp.localToWorld(new THREE.Vector3(x,y,0)).sub(grp.localToWorld(new THREE.Vector3(0,0,0)));
        const nrm=grp.localToWorld(new THREE.Vector3(0,0,1)).sub(grp.localToWorld(new THREE.Vector3(0,0,0))).normalize();
        const a=un?nrm.clone().add(lat.normalize().multiplyScalar(lat.length()>1e-6?0.25:0)).add(new THREE.Vector3(0,0.15,0)).normalize():nrm.clone().negate().add(new THREE.Vector3(0,0.6,0)).add(out.clone().multiplyScalar(0.5)).normalize();
        H3.pts[nn]={p:P,a};
        const pk=new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.0028*K,spec.pitch*0.42*K),10,8),new THREE.MeshBasicMaterial({color:0x6fd3ff,transparent:true,opacity:0,depthWrite:false}));
        pk.position.copy(P);pk.userData.node=nn;W.add(pk);H3.pick.push(pk);
      });
      C.body.userData.sec='c'+j;H3.pick.push(C.body);
    });
    if(HX.insp.has('c'+j)&&f.conn===j&&(f.kind==='res'||f.kind==='water')){const base=centers[0].clone().add(centers[1]).multiplyScalar(0.5);
      for(let q=0;q<7;q++){const cc=new THREE.Mesh(new THREE.SphereGeometry(0.0012*K*(0.6+Math.random()),8,6),h3mat(0x3ccf6a,{roughness:1,emissive:0x0a3018}));cc.position.copy(base).add(new THREE.Vector3((Math.random()-.5)*spec.W*K,(Math.random()-.5)*spec.H*K*0.6+spec.H*K*0.5,(Math.random()-.5)*0.01*K));W.add(cc);}
      if(f.kind==='water')for(let q=0;q<5;q++){const d=new THREE.Mesh(new THREE.SphereGeometry(0.0016*K*(0.6+Math.random()),12,8),new THREE.MeshStandardMaterial({color:0x9fd8ff,transparent:true,opacity:0.55,roughness:0.05,metalness:0.1}));d.position.copy(base).add(new THREE.Vector3((Math.random()-.5)*spec.W*K,(Math.random()-.5)*spec.H*K*0.5,(Math.random()-.5)*0.012*K));W.add(d);}}
    const fp=centers[0].clone().add(centers[1]).multiplyScalar(0.5);
    H3.secs['c'+j]={p:fp,vp:p.clone(),d:un?(eng?0.3:0.55):(eng?0.24:0.45)};
    h3label(nd.id+(un?' (unplugged)':''),fp.clone().add(new THREE.Vector3(0,spec.H*K*1.6+0.01*K,0)),'conn'+(sel?' on':''),'c'+j);
  });
  // segments
  const loomM=sel=>h3mat(0x161618,{roughness:0.85,metalness:0.1,emissive:sel?0x0c3550:0x000000});
  W.add(h3BgHarness(lvl,rt)); // after the connectors: shared bundles/circuits attach to where the halves actually are
  rt.segs.forEach((sg,i)=>{
    const j=i+1,RA=H3.rear[i+'d'],RB=H3.rear[j+'u'],ext=K*0.03,pts=[RA.p,RA.p.clone().add(RA.d.clone().multiplyScalar(i===0?K*0.06:ext)),...sg.via.map(V3),RB.p.clone().add(RB.d.clone().multiplyScalar(ext)),RB.p],curve=new THREE.CatmullRomCurve3(pts),sel=HX.sec==='s'+j,open=HX.loom.has(j);
    const m=loomM(sel);if(open){m.transparent=true;m.opacity=0.18;}const tk=hSegTrunk(lvl,rt,i),rr=tk?tk.r*1.1:rad;
    const TL=eng?0.028:0.045,tg=jj=>(rt.nodes[jj].id==='J1'?'J1':rt.cid.toUpperCase()+' '+rt.nodes[jj].id);
    const LM=h3Loom(W,curve,rr,{lite:false,eng,mat:m,slit:!open,wires:HW[t],capA:RA.cav,backA:RA.d,capB:RB.cav,backB:RB.d,tailA:tk||open?0:TL,tailB:open?0:TL,tagA:tk?null:tg(i),tagB:tg(j),sleeve:open?null:sg.sleeve});const tube=LM.tube;tube.userData.sec='s'+j;H3.pick.push(tube);if(!open)h3InnerWires(W,LM.sub,rr,HW[t]);h3HarnessHw(W,curve,rr,eng,LM.a,LM.b);if(tk)h3Breakout(W,curve,tk,rad);
    {const fr=curve.computeFrenetFrames(64,false),nw=HW[t].length;[['a',0.3],['b',0.8]].forEach(([e,tt])=>{const k=Math.round(tt*64);HW[t].forEach((w,wi)=>{const P=curve.getPointAt(tt).add(fr.normals[k].clone().multiplyScalar((wi-(nw-1)/2)*rad*0.75));if(open)P.add(h3LiftAt(curve,fr,k,w[0],j,rad,!eng,null,HW[t]));if(sel){const nn=`s${j}${e}_${w[0]}`,on=HX.red===nn||HX.black===nn,mk=new THREE.Mesh(new THREE.SphereGeometry(rad*0.34,14,10),new THREE.MeshBasicMaterial({color:new THREE.Color(w[2]),depthTest:false}));mk.renderOrder=20;mk.position.copy(P);mk.userData.node=nn;W.add(mk);H3.pick.push(mk);
      const rg=new THREE.Mesh(new THREE.TorusGeometry(rad*0.52,rad*0.11,8,24),new THREE.MeshBasicMaterial({color:on?0xffffff:0xffa21a,depthTest:false}));rg.renderOrder=21;rg.position.copy(P);rg.lookAt(P.clone().add(h3ViewDir('s'+j,P,!eng)));W.add(rg);
      const hit=new THREE.Mesh(new THREE.SphereGeometry(rad*0.75,10,8),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));hit.position.copy(P);hit.userData.node=nn;W.add(hit);H3.pick.push(hit);}H3.pts[`s${j}${e}_${w[0]}`]={p:P,a:new THREE.Vector3(0,1,0).add(fr.binormals[k].clone().multiplyScalar(0.35)).add(new THREE.Vector3(0,0,Math.sign(P.z)*0.5)).normalize()};});});}
    if(open)h3OpenWires(W,curve,rad,HW[t],f.seg===j&&['open','gnd','short','bat','strands'].includes(f.kind)?f:null,j,!eng,RA.cav,RB.cav);
    const mid=curve.getPointAt(0.5);H3.secs['s'+j]={p:mid,d:eng?Math.min(1.0,Math.max(0.45,curve.getLength()*1.1)):Math.min(3.2,Math.max(1.4,curve.getLength()*0.65))};
    h3label('S'+j,mid.clone().add(new THREE.Vector3(0,rad*4,0)),'seg'+(sel?' on':''),'s'+j);
  });
  {const cn=H3.secs['c'+(n-1)];H3.secs.comp={p:cp.clone().add(cn.p).multiplyScalar(0.5),vp:cn.vp,d:eng?0.32:0.65};const c0=H3.secs.c0;H3.secs.mod={p:V3(modPos).add(c0.p).multiplyScalar(0.5),vp:c0.vp,d:eng?0.45:0.8};if(remM)H3.secs.mod={p:V3(modPos).add(MV),vp:c0.vp,d:eng?0.8:1.3};if(remC)H3.secs.comp={p:cp.clone(),vp:cn.vp,d:eng?0.32:0.75};}
  // overview
  const bb=new THREE.Box3();rt.nodes.forEach(nd=>bb.expandByPoint(V3(nd.pos)));bb.expandByPoint(cp);bb.expandByPoint(V3(modPos));
  const c=new THREE.Vector3();bb.getCenter(c);const sz=bb.getSize(new THREE.Vector3()).length();
  H3.secs.ov={p:c,d:eng?Math.max(1.6,sz*2.2):Math.max(5,sz*1.4)};
  if(HX.tool==='clamp'&&HX.clamp&&rt.segs[HX.clamp.seg-1]){const j=HX.clamp.seg,sg=rt.segs[j-1],RA=H3.rear[(j-1)+'d'],RB=H3.rear[j+'u'],ext=K*0.03;
    const cv=new THREE.CatmullRomCurve3([RA.p,RA.p.clone().add(RA.d.clone().multiplyScalar(j-1===0?K*0.06:ext)),...sg.via.map(V3),RB.p.clone().add(RB.d.clone().multiplyScalar(ext)),RB.p]);
    const u=0.42,N=64,k=Math.round(u*N),fr=cv.computeFrenetFrames(N,false),nw=HW[t].length;let P=cv.getPointAt(u),jr=rad*1.5;
    if(HX.clamp.wire!=='all'){const wi=HW[t].findIndex(x=>x[0]===HX.clamp.wire);P=P.add(fr.normals[k].clone().multiplyScalar((wi-(nw-1)/2)*rad*0.75));jr=rad*0.55;}
    W.add(h3AmpClamp(P,cv.getTangentAt(u),jr,eng?1:2.2,h3ViewDir(HX.sec,P,!eng)));}
  // ground studs
  const studs=eng?[[0.32,0.2,0.33],[-0.62,0.12,0.31],[0.5,0.15,-0.34],[-0.6,0.95,-0.38]].map(q=>lvl>=4?engOff(q):q):[2.5,1.0,-0.5,-2.0,-3.4,-5.0].flatMap(x=>[[x,0.9,0.457],[x,0.9,-0.457]]);
  studs.forEach(st=>{const sg=Math.sign(st[2]);{const pk=new THREE.Mesh(new THREE.SphereGeometry(cs*0.35,10,8),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));pk.position.set(st[0],st[1],st[2]+sg*cs*0.12);pk.userData.node='gnd';W.add(pk);H3.pick.push(pk);}h3cyl(W,cs*0.12,cs*0.1,[st[0],st[1],st[2]+sg*cs*0.05],'z',h3mat(0xb8bcc4,{metalness:.9,roughness:.3}),6);h3torus(W,cs*0.16,cs*0.03,[st[0],st[1],st[2]+sg*cs*0.02],'z',h3mat(0xc08a3a,{metalness:.9}));h3cyl(W,cs*0.05,cs*0.25,[st[0],st[1],st[2]+sg*cs*0.12],'z',h3mat(0xb8bcc4,{metalness:.9}),10);});
  // meter + test leads
  H3.lcd=null;
  const ends=[];
  ['red','black'].forEach(k=>{const nn=HX[k];if(!nn||HX.tool==='clamp')return;let P=null;
    if(nn==='gnd'){const other=HX[k==='red'?'black':'red'];const ref=(other&&other!=='gnd'&&H3.pts[other])?H3.pts[other].p:(H3.secs[HX.sec]||H3.secs.ov).p;
      let best=studs[0],bd=1e9;studs.forEach(st=>{const d=V3(st).distanceTo(ref);if(d<bd){bd=d;best=st;}});const sg=Math.sign(best[2]);
      P={p:V3(best).add(new THREE.Vector3(0,0,sg*cs*0.2)),a:new THREE.Vector3(0,0.7,sg).normalize(),clip:true};}
    else P=H3.pts[nn];
    if(P)ends.push([k,P]);});
  if(ends.length){
    const sc=eng?1:2.2,cen=new THREE.Vector3();ends.forEach(e=>cen.add(e[1].p));cen.divideScalar(ends.length);
    const fs=H3.secs[HX.sec]||H3.secs.ov,vd=h3ViewDir(HX.sec,fs.vp||fs.p,!eng),rgt=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),vd).normalize();
    const mp=cen.clone().add(rgt.clone().multiplyScalar(-0.2*sc)).add(new THREE.Vector3(0,-0.1*sc,0)).add(vd.clone().multiplyScalar(0.04*sc));mp.y=Math.max(mp.y,eng?-0.12:0.25);
    ends.forEach(([k,P])=>{
      const col=k==='red'?0xc8231b:0x1a1a1c,a=P.a.clone().normalize();
      const pr=P.clip?h3Clip(col,sc):h3Probe(col,sc);pr.grp.position.copy(P.p);pr.grp.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),a);W.add(pr.grp);
      const h1=P.p.clone().add(a.clone().multiplyScalar(pr.len)),p2=h1.clone().add(a.clone().multiplyScalar(0.05*sc));
      // lead runs off toward the (unseen) meter: down and toward the viewer
      const off=mp.clone().add(new THREE.Vector3(0,-0.45*sc,0)).add(vd.clone().multiplyScalar(0.12*sc)).add(new THREE.Vector3(0,0,0).add(rgt.clone().multiplyScalar(k==='red'?0.02*sc:-0.02*sc)));
      const mid=h1.clone().add(off).multiplyScalar(0.5);mid.y=Math.max(Math.min(mid.y,h1.y-0.06*sc),eng?-0.2:0.06);
      W.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([h1,p2,mid,off]),90,0.0019*sc,10,false),h3mat(col,{roughness:.45,metalness:0})));
    });
  }
}
// ---------- detailed meter, probes, clip ----------
function h3Meter(sc){
  const g=new THREE.Group(),W=0.09*sc,H=0.18*sc,D=0.034*sc,f=D/2;
  const body=h3mat(0x2b2d31,{roughness:.55,metalness:.05}),rub=h3mat(0x3a3d42,{roughness:.95,metalness:0}),bump=h3mat(0xd9641c,{roughness:.85,metalness:0});
  g.add(h3ext(h3rr(W,H,0.012*sc),D,-D/2,body));
  // holster with corner bumpers and tilt stand
  const hs=h3rr(W+0.012*sc,H+0.012*sc,0.016*sc);hs.holes.push(h3rr(W-0.004*sc,H-0.004*sc,0.01*sc));g.add(h3ext(hs,D+0.008*sc,-D/2-0.006*sc,rub));
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sy])=>{const b=new THREE.Mesh(new THREE.SphereGeometry(0.011*sc,14,10),bump);b.scale.set(1,1,1.6);b.position.set(sx*(W/2+0.002*sc),sy*(H/2+0.002*sc),0);g.add(b);});
  const st=new THREE.Mesh(new THREE.BoxGeometry(W*0.7,H*0.55,0.003*sc),rub);st.position.set(0,-H*0.12,-D/2-0.009*sc);st.rotation.x=-0.25;g.add(st);
  // printed faceplate
  const cv=document.createElement('canvas');cv.width=512;cv.height=1024;h3Faceplate(cv.getContext('2d'),W,H,sc);
  const fp=new THREE.Mesh(new THREE.PlaneGeometry(W,H),new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(cv),roughness:.6,transparent:true}));fp.position.z=f+0.0003*sc;g.add(fp);
  // display window (bezel + LCD canvas)
  const bz=h3rr(0.078*sc,0.044*sc,0.004*sc);bz.holes.push(h3rr(0.07*sc,0.036*sc,0.002*sc));g.add(h3ext(bz,0.002*sc,f,h3mat(0x111214,{roughness:.4})));
  const lc=document.createElement('canvas');lc.width=512;lc.height=264;const tex=new THREE.CanvasTexture(lc);H3.lcd={cv:lc,tex};
  const lcd=new THREE.Mesh(new THREE.PlaneGeometry(0.07*sc,0.036*sc),new THREE.MeshBasicMaterial({map:tex}));lcd.position.set(0,0.052*sc,f+0.0006*sc);g.add(lcd);
  g.children[g.children.length-2].position.y=0.052*sc;
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(0.072*sc,0.038*sc),new THREE.MeshStandardMaterial({color:0xffffff,transparent:true,opacity:0.06,roughness:0.05,metalness:0.9}));glass.position.set(0,0.052*sc,f+0.0018*sc);g.add(glass);
  // buttons
  ['HOLD','RANGE','MIN MAX','REL'].forEach((t,i)=>{const b=h3ext(h3rr(0.016*sc,0.008*sc,0.003*sc),0.003*sc,f,h3mat(i===0?0xd9641c:0x4a4d53,{roughness:.7}));b.position.set((-0.03+i*0.02)*sc,0.022*sc,0);g.add(b);});
  // rotary selector
  const kn=new THREE.Group();kn.position.set(0,-0.022*sc,f);
  const base=new THREE.Mesh(new THREE.CylinderGeometry(0.019*sc,0.019*sc,0.004*sc,40),h3mat(0x1b1c1f,{roughness:.5}));base.rotation.x=Math.PI/2;base.position.z=0.002*sc;kn.add(base);
  const grip=new THREE.Mesh(new THREE.BoxGeometry(0.03*sc,0.008*sc,0.008*sc),h3mat(0x2a2c30,{roughness:.6}));grip.position.z=0.007*sc;kn.add(grip);
  const ptr=new THREE.Mesh(new THREE.BoxGeometry(0.0022*sc,0.012*sc,0.0012*sc),h3mat(0xffffff,{roughness:.4}));ptr.position.set(0,0.008*sc,0.0112*sc);
  const pg=new THREE.Group();pg.add(grip);pg.add(ptr);pg.rotation.z=-{dcv:-40,acv:-80,ohm:40}[DMM.mode]*Math.PI/180;kn.add(pg);g.add(kn);
  // input jacks: A, mA µA, COM, V Ω
  const jack={};[['A',-0.03],['mA',-0.01],['black',0.01],['red',0.03]].forEach(([k,x])=>{
    const ring=new THREE.Mesh(new THREE.CylinderGeometry(0.0065*sc,0.0065*sc,0.003*sc,24),h3mat(k==='red'?0xb3261e:0x202124,{roughness:.6}));ring.rotation.x=Math.PI/2;ring.position.set(x*sc,-0.066*sc,f+0.0015*sc);g.add(ring);
    const hole=new THREE.Mesh(new THREE.CylinderGeometry(0.0033*sc,0.0033*sc,0.0035*sc,16),h3mat(0x050505,{roughness:1}));hole.rotation.x=Math.PI/2;hole.position.set(x*sc,-0.066*sc,f+0.0017*sc);g.add(hole);
    jack[k]=new THREE.Vector3(x*sc,-0.066*sc,f+0.003*sc);});
  return{grp:g,jack};
}
function h3Faceplate(c,W,H,sc){
  const X=x=>(x*sc/W+0.5)*512,Y=y=>(0.5-y*sc/H)*1024;
  c.clearRect(0,0,512,1024);
  c.fillStyle='rgba(0,0,0,0)';
  c.fillStyle='#c9cdd3';c.textAlign='center';c.textBaseline='middle';
  c.font='600 20px "IBM Plex Mono",monospace';
  ['HOLD','RANGE','MIN MAX','REL'].forEach((t,i)=>c.fillText(t,X(-0.03+i*0.02),Y(0.0325)));
  // dial ring + positions
  const cx=X(0),cy=Y(-0.022),R=(0.031*sc/W)*512;
  c.strokeStyle='#5a5e66';c.lineWidth=3;c.beginPath();c.arc(cx,cy,R*0.74,0,Math.PI*2);c.stroke();
  [['OFF',-120],['V~',-80],['V⎓',-40],['mV',0],['Ω',40],['→|',80],['A',120]].forEach(([t,a])=>{const r=a*Math.PI/180,x=cx+Math.sin(r)*R,y=cy-Math.cos(r)*R;
    c.fillStyle=t==='OFF'?'#d9641c':'#e6e6e9';c.font=`700 ${t.length>2?22:28}px "IBM Plex Mono",monospace`;c.fillText(t,x,y);
    c.strokeStyle='#8a8f96';c.lineWidth=3;c.beginPath();c.moveTo(cx+Math.sin(r)*R*0.66,cy-Math.cos(r)*R*0.66);c.lineTo(cx+Math.sin(r)*R*0.8,cy-Math.cos(r)*R*0.8);c.stroke();});
  // jack legends
  c.font='700 20px "IBM Plex Mono",monospace';
  [['A',-0.03,'#e6e6e9'],['mA µA',-0.01,'#e6e6e9'],['COM',0.01,'#e6e6e9'],['V Ω →|',0.03,'#ff6b5e']].forEach(([t,x,cl])=>{c.fillStyle=cl;c.fillText(t,X(x),Y(-0.0505));});
  c.fillStyle='#8a8f96';c.font='600 14px "IBM Plex Mono",monospace';
  c.fillText('10A MAX FUSED',X(-0.02),Y(-0.08));c.fillText('CAT III 1000V',X(0.02),Y(-0.08));
  c.strokeStyle='#5a5e66';c.lineWidth=2;c.beginPath();c.moveTo(X(-0.04),Y(-0.0415));c.lineTo(X(0.04),Y(-0.0415));c.stroke();
}
function h3Probe(col,sc){
  const g=new THREE.Group(),hm=h3mat(col,{roughness:.5}),met=h3mat(0xd7dbe1,{metalness:.95,roughness:.18});
  const add=(geo,m,y)=>{const o=new THREE.Mesh(geo,m);o.position.y=y;g.add(o);return o;};
  let y=0;const tipL=0.012*sc;
  add(new THREE.ConeGeometry(0.0006*sc,0.002*sc,10),met,0.001*sc).rotation.x=Math.PI;
  add(new THREE.CylinderGeometry(0.0006*sc,0.0006*sc,tipL,10),met,0.002*sc+tipL/2);y=0.002*sc+tipL;
  add(new THREE.CylinderGeometry(0.0016*sc,0.0011*sc,0.004*sc,12),hm,y+0.002*sc);y+=0.004*sc;
  add(new THREE.CylinderGeometry(0.0062*sc,0.0062*sc,0.0022*sc,24),hm,y+0.0011*sc);y+=0.0022*sc;
  add(new THREE.CylinderGeometry(0.0042*sc,0.0046*sc,0.07*sc,20),hm,y+0.035*sc);
  for(let i=0;i<7;i++){const t=new THREE.Mesh(new THREE.TorusGeometry(0.0046*sc,0.0007*sc,6,20),hm);t.rotation.x=Math.PI/2;t.position.y=y+0.008*sc+i*0.0055*sc;g.add(t);}
  y+=0.07*sc;add(new THREE.CylinderGeometry(0.002*sc,0.0042*sc,0.016*sc,16),h3mat(col,{roughness:.8}),y+0.008*sc);y+=0.016*sc;
  return{grp:g,len:y};
}
function h3Clip(col,sc){
  const g=new THREE.Group(),hm=h3mat(col,{roughness:.6}),met=h3mat(0xc8ccd2,{metalness:.9,roughness:.25});
  [1,-1].forEach(s=>{const jaw=new THREE.Mesh(new THREE.BoxGeometry(0.004*sc,0.03*sc,0.0016*sc),met);jaw.position.set(0,0.015*sc,s*0.0024*sc);jaw.rotation.x=s*0.12;g.add(jaw);
    for(let i=0;i<5;i++){const tth=new THREE.Mesh(new THREE.BoxGeometry(0.004*sc,0.0012*sc,0.0012*sc),met);tth.position.set(0,0.002*sc+i*0.003*sc,s*0.0012*sc);g.add(tth);}});
  const piv=new THREE.Mesh(new THREE.CylinderGeometry(0.0016*sc,0.0016*sc,0.008*sc,10),met);piv.rotation.z=Math.PI/2;piv.position.y=0.03*sc;g.add(piv);
  const boot=new THREE.Mesh(new THREE.CylinderGeometry(0.0035*sc,0.0065*sc,0.03*sc,16),hm);boot.position.y=0.047*sc;g.add(boot);
  const tail=new THREE.Mesh(new THREE.CylinderGeometry(0.002*sc,0.0035*sc,0.01*sc,12),hm);tail.position.y=0.067*sc;g.add(tail);
  return{grp:g,len:0.072*sc};
}
function h3Banana(col,sc){
  const g=new THREE.Group(),hm=h3mat(col,{roughness:.5});
  const sh=new THREE.Mesh(new THREE.CylinderGeometry(0.0055*sc,0.0055*sc,0.012*sc,20),hm);sh.rotation.x=Math.PI/2;sh.position.z=0.009*sc;g.add(sh);
  const bt=new THREE.Mesh(new THREE.CylinderGeometry(0.0022*sc,0.0055*sc,0.014*sc,16),hm);bt.rotation.x=Math.PI/2;bt.position.z=0.022*sc;g.add(bt);
  for(let i=0;i<3;i++){const r=new THREE.Mesh(new THREE.TorusGeometry(0.0056*sc,0.0005*sc,6,18),hm);r.position.z=0.006*sc+i*0.003*sc;g.add(r);}
  return g;
}
function h3DrawLcd(txt){
  if(!H3||!H3.lcd)return;const c=H3.lcd.cv.getContext('2d'),w=512,h=264;
  c.fillStyle='#a9b9a2';c.fillRect(0,0,w,h);
  const grd=c.createLinearGradient(0,0,0,h);grd.addColorStop(0,'rgba(255,255,255,.18)');grd.addColorStop(1,'rgba(0,0,0,.08)');c.fillStyle=grd;c.fillRect(0,0,w,h);
  const on='#13210f',off='rgba(19,33,15,.05)';
  c.font='700 26px "IBM Plex Mono",monospace';c.textBaseline='middle';c.textAlign='left';
  const mode=DMM.mode,ann=[['AUTO',18,true],['DC',110,mode==='dcv'],['AC',160,mode==='acv'],['HOLD',220,false],['REL',300,false]];
  ann.forEach(([t,x,a])=>{c.fillStyle=a?on:off;c.fillText(t,x,30);});
  c.fillStyle=on;c.fillRect(440,18,44,22);c.fillStyle='#a9b9a2';c.fillRect(444,22,8,14);c.fillStyle=on;c.fillRect(484,24,5,10);
  // seven-segment style reading: ghost "8.8.8.8" behind the value
  const m=/^(-?[\d.]+|OL|-\s-\s-\s-|Err)\s*(.*)$/.exec(txt)||[txt,txt,''];
  c.textAlign='right';c.font='700 118px "IBM Plex Mono",monospace';c.fillStyle=off;c.fillText('8888',398,138);
  c.fillStyle=on;c.fillText(m[1].replace(/\s/g,''),398,138);
  c.font='700 44px "IBM Plex Mono",monospace';c.textAlign='left';c.fillText(m[2]||'',410,150);
  // bar graph
  let frac=0;const num=parseFloat(m[1]);if(!isNaN(num))frac=Math.min(1,Math.abs(num)/(m[2].startsWith('k')||m[2].startsWith('M')?10:m[2]==='Ω'?1000:(m[2].includes('V')?10:1)));if(m[1]==='OL')frac=1;
  for(let i=0;i<40;i++){c.fillStyle=i/40<frac?on:off;c.fillRect(20+i*11.8,218,7,i%5===0?28:18);}
  H3.lcd.tex.needsUpdate=true;
}
// with the loom opened, a wire that has a lead on it is eased out of the bundle (toward the viewer) so it is clear which one is being probed
function h3ProbeSet(j){const S=new Map();[['r',HX.red],['b',HX.black]].forEach(([ld,nn])=>{const m=/^s(\d+)([ab])_(\w+)$/.exec(nn||'');if(m&&+m[1]===j)S.set(m[2]+'|'+m[3],ld);});return S;}
function h3LiftAt(curve,fr,s,wire,j,rad,l4,S,wires){S=S||h3ProbeSet(j);const out=new THREE.Vector3();const P=curve.getPointAt(s/64),vd=h3ViewDir('s'+j,P,l4);let bn=fr.binormals[s].clone();if(bn.dot(vd)<0)bn.negate();
  [['a',19],['b',51]].forEach(([e,sc])=>{const ld=S.get(e+'|'+wire);if(!ld)return;const amt=Math.exp(-Math.pow((s-sc)/6.5,2));if(amt<0.002)return;
    const mates=[...S.keys()].filter(k=>k[0]===e&&k!==e+'|'+wire);let side=0; // two probed wires at the same spot: ease them apart, each to its own side (no crossing)
    if(mates.length&&wires){const nw=wires.length,off=x=>wires.findIndex(w=>w[0]===x)-(nw-1)/2,me=off(wire),ot=off(mates[0].split('|')[1]);side=Math.sign(me-ot)||1;}
    out.add(bn.clone().multiplyScalar(rad*1.2*amt)).add(fr.normals[s].clone().multiplyScalar(side*rad*0.9*amt));});
  return out;}
function h3OpenWires(W,curve,rad,wires,f,j,l4,capA,capB){
  const N=64,fr=curve.computeFrenetFrames(N,false),nw=wires.length,cu=h3mat(0xe08a3c,{metalness:.9,roughness:.25,emissive:0x5a2800}),wr=rad*0.26,PS=h3ProbeSet(j);
  const pos=(wi,s)=>(s===0&&capA&&capA[wi])?capA[wi].clone():(s===N&&capB&&capB[wi])?capB[wi].clone():curve.getPointAt(s/N).add(fr.normals[s].clone().multiplyScalar((wi-(nw-1)/2)*rad*0.75)).add(j?h3LiftAt(curve,fr,s,wires[wi][0],j,rad,l4,PS,wires):new THREE.Vector3());
  const tube=(pts,r,m)=>W.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),pts.length*2,r,8,false),m));
  const cuDull=h3mat(0xa8683a,{metalness:.8,roughness:.45});const strands=(P,dir)=>{for(let k=0;k<5;k++){const d=dir.clone().add(new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).multiplyScalar(0.5)).normalize(),L=wr*(0.6+Math.random()*0.8);
    const c=new THREE.Mesh(new THREE.CylinderGeometry(wr*0.09,wr*0.07,L,4),cuDull);c.position.copy(P).add(d.clone().multiplyScalar(L/2));c.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d);W.add(c);}};
  const B0=f&&f.kind==='open'?34:f&&f.kind==='strands'?34:29,B1=f&&f.kind==='open'?36:f&&f.kind==='strands'?36:41;
  wires.forEach((w,wi)=>{const ins=h3mat(new THREE.Color(w[2]).getHex(),{roughness:0.5}),hit=f&&(f.wire===w[0]||f.wire2===w[0]);
    if(!hit){const pts=[];for(let s=0;s<=N;s++)pts.push(pos(wi,s));tube(pts,wr,ins);return;}
    const A=[],Bp=[],Cp=[];for(let s=0;s<=B0;s++)A.push(pos(wi,s));for(let s=B1;s<=N;s++)Cp.push(pos(wi,s));
    if(f.kind==='open'){const bn=fr.binormals[35].clone().multiplyScalar(rad*0.08);[1,2,3].forEach(q=>{A[A.length-q].add(bn.clone().multiplyScalar((4-q)/3));Cp[q-1].sub(bn.clone().multiplyScalar((4-q)/3));});}
    tube(A,wr,ins);tube(Cp,wr,ins);
    const pA=A[A.length-1].clone(),pC=Cp[0].clone(),tg=curve.getTangentAt(B0/N);
    if(f.kind==='strands'){ // most strands cut: thin copper bridge + a few loose strands
      tube([pA,pos(wi,35),pC],wr*0.22,cu);strands(pA,tg.clone());strands(pC,tg.clone().negate());
    }else if(f.kind==='open'){ // broken: ends pulled apart, frayed copper at both ends
      strands(pA,tg.clone());strands(pC,tg.clone().negate());
      [pA,pC].forEach(P=>{const r=new THREE.Mesh(new THREE.TorusGeometry(wr*1.02,wr*0.18,6,12),ins);r.position.copy(P);r.lookAt(P.clone().add(tg));W.add(r);});
    }else{ // rubbed through: insulation worn away, bare copper showing; a short pulls the two bare spots together
      for(let s=B0;s<=B1;s++)Bp.push(pos(wi,s));Bp[0]=pA.clone();Bp[Bp.length-1]=pC.clone();
      if(f.kind==='short'){const other=wires.findIndex(x=>x[0]===(f.wire===w[0]?f.wire2:f.wire));[4,5,6,7,8].forEach(q=>{Bp[q]=pos(wi,B0+q).lerp(pos(other,B0+q),0.42);});}
      tube(Bp,wr*0.7,cu);
      [pA,pC].forEach(P=>{const r=new THREE.Mesh(new THREE.TorusGeometry(wr*0.85,wr*0.25,6,12),ins);r.position.copy(P);r.lookAt(P.clone().add(tg));r.scale.set(1,1,0.6);W.add(r);});
      if(f.kind==='bat'){const bn=fr.binormals[35].clone().normalize(),feed=[];for(let s2=18;s2<=52;s2+=2){const pull=Math.exp(-Math.pow((s2-35)/6,2));feed.push(pos(wi,s2).add(bn.clone().multiplyScalar(rad*(1.25-0.95*pull))));}
        tube(feed.slice(0,8),wr*1.25,h3mat(0xc0201a,{roughness:.45}));tube(feed.slice(10),wr*1.25,h3mat(0xc0201a,{roughness:.45}));tube(feed.slice(7,11),wr*0.85,cu);}
      if(f.kind==='gnd'){const d=new THREE.Vector3(0,-1,0).sub(tg.clone().multiplyScalar(-tg.y)).normalize(),P=pos(wi,35);
        const br=new THREE.Mesh(new THREE.BoxGeometry(rad*4.5,rad*0.3,rad*3.5),h3mat(0x6b7078,{metalness:.8,roughness:.35}));br.position.copy(P).add(d.clone().multiplyScalar(wr*1.05+rad*0.12));br.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().negate());W.add(br);
        const sh=new THREE.Mesh(new THREE.CylinderGeometry(rad*0.5,rad*0.5,rad*0.02,16),h3mat(0xe8eef5,{metalness:1,roughness:.08}));sh.position.copy(P).add(d.clone().multiplyScalar(wr*1.0));sh.quaternion.copy(br.quaternion);W.add(sh);}
    }
  });
}
// ---------- harness detail: corrugated split loom, inner wires, tape, P-clamps, zip ties ----------
function h3CorrTube(curve,r,pitch,m,slit){
  const len=curve.getLength(),N=Math.max(24,Math.round(len/pitch*4)),R=16,fr=curve.computeFrenetFrames(N,false);
  const pos=new Float32Array((N+1)*(R+1)*3),idx=[];
  for(let i=0;i<=N;i++){const u=i/N,P=curve.getPointAt(u),rr=r*(1+0.1*Math.cos(2*Math.PI*u*len/pitch)),nx=fr.normals[i],bx=fr.binormals[i];
    for(let k=0;k<=R;k++){const v=k/R*Math.PI*2,c=Math.cos(v),s=Math.sin(v),o=(i*(R+1)+k)*3;
      pos[o]=P.x+rr*(c*nx.x+s*bx.x);pos[o+1]=P.y+rr*(c*nx.y+s*bx.y);pos[o+2]=P.z+rr*(c*nx.z+s*bx.z);}}
  for(let i=0;i<N;i++)for(let k=0;k<R;k++){if(slit&&k===R-1)continue;const a=i*(R+1)+k,b=(i+1)*(R+1)+k;idx.push(a,b,a+1,b,b+1,a+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
  m.side=THREE.DoubleSide;return new THREE.Mesh(g,m);
}
let H3RIB=null;
function h3CorrTubeLite(curve,r,pitch){
  if(!H3RIB){const cv=document.createElement('canvas');cv.width=64;cv.height=4;const c=cv.getContext('2d');const gr=c.createLinearGradient(0,0,64,0);gr.addColorStop(0,'#000');gr.addColorStop(0.5,'#fff');gr.addColorStop(1,'#000');c.fillStyle=gr;c.fillRect(0,0,64,4);H3RIB=cv;}
  const len=curve.getLength(),tex=new THREE.CanvasTexture(H3RIB);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(len/pitch,1);
  const m=new THREE.MeshStandardMaterial({color:0x161618,roughness:.85,metalness:.1,bumpMap:tex,bumpScale:r*0.35});
  return new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(16,Math.round(len/(r*1.2))),r*1.04,10,false),m);}
function h3InnerWires(W,curve,r,wires){
  const N=48,fr=curve.computeFrenetFrames(N,false),nw=wires.length;
  wires.forEach((w,wi)=>{const ang=wi/nw*Math.PI*2+0.4,pts=[];for(let i=0;i<=N;i++){const tw=ang+i*0.35;pts.push(curve.getPointAt(i/N).add(fr.normals[i].clone().multiplyScalar(Math.cos(tw)*r*0.42)).add(fr.binormals[i].clone().multiplyScalar(Math.sin(tw)*r*0.42)));}
    W.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),N*2,r*0.3,6,false),h3mat(new THREE.Color(w[2]).getHex(),{roughness:.45})));});
}
// ---------- harness detail: wire tails at connectors, ID labels, sleeves, breakout tape, brackets to the nearest surface ----------
function h3Sub(curve,a,b){const c=new THREE.Curve();c.getPoint=(t,o)=>(o||new THREE.Vector3()).copy(curve.getPointAt(a+(b-a)*t));return c;}
function h3Perp(t){const up=Math.abs(t.y)>0.9?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);const n=new THREE.Vector3().crossVectors(t,up).normalize();return[n,new THREE.Vector3().crossVectors(t,n).normalize()];}
const H3TAG=new Map();
function h3TagMat(text){if(H3TAG.has(text))return H3TAG.get(text);const cv=document.createElement('canvas');cv.width=256;cv.height=64;const c=cv.getContext('2d');
  c.fillStyle='#e9e7df';c.fillRect(0,0,256,64);c.fillStyle='#16161a';c.font='700 30px "IBM Plex Mono",monospace';c.textBaseline='middle';c.textAlign='center';c.fillText(text,64,33);c.fillText(text,192,33);
  const m=new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(cv),roughness:.55,metalness:0});H3TAG.set(text,m);return m;}
function h3Seal(grp,spec,K,Lm){const at=([x,y])=>grp.localToWorld(new THREE.Vector3(x*K,y*K,-Lm/2-0.0022*K));return{cav:spec.wire.map(ci=>at(spec.cav[ci])),all:spec.cav.map(at)};}
function h3WireTail(W,curve,uC,uL,r,wires,cap,back){
  // individual wires: out of each cavity in the connector's rear seal, straight back a little, then into the loom end (taped)
  const pc=curve.getPointAt(uC),pl=curve.getPointAt(uL),t=curve.getTangentAt(uL),[n,bn]=h3Perp(t),nw=wires.length,bk=back?back.clone().normalize():curve.getTangentAt(uC).multiplyScalar(uC<0.5?1:-1);
  wires.forEach((w,k)=>{const ang=k/nw*Math.PI*2+0.5,off=n.clone().multiplyScalar(Math.cos(ang)).add(bn.clone().multiplyScalar(Math.sin(ang)));
    const a=cap&&cap[k]?cap[k].clone():pc.clone().add(off.clone().multiplyScalar(r*0.28)),a2=a.clone().add(bk.clone().multiplyScalar(r*0.9)),b=pl.clone().add(off.clone().multiplyScalar(r*0.42));
    const mid=a2.clone().lerp(b,0.5).add(off.clone().multiplyScalar(r*0.25));
    W.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a,a2,mid,b]),14,r*0.2,6,false),h3mat(new THREE.Color(w[2]).getHex(),{roughness:.4,metalness:0})));});
}

function h3Loom(W,curve,r,o){
  const len=curve.getLength(),a=o.tailA?Math.min(0.3,o.tailA/len):0,b=o.tailB?1-Math.min(0.3,o.tailB/len):1,sub=(a>0||b<1)?h3Sub(curve,a,b):curve;
  const pitch=o.eng?0.0045:0.007,tube=o.lite?h3CorrTubeLite(sub,r,pitch):h3CorrTube(sub,r,pitch,o.mat,o.slit);W.add(tube);
  if(a>0)h3WireTail(W,curve,0,a,r,o.wires,o.capA,o.backA);if(b<1)h3WireTail(W,curve,1,b,r,o.wires,o.capB,o.backB);
  [[o.tagA,a+r*5.5/len],[o.tagB,b-r*5.5/len]].forEach(([txt,u])=>{if(!txt||u<=0.02||u>=0.98)return;const p=curve.getPointAt(u),t=curve.getTangentAt(u);
    const tg=new THREE.Mesh(new THREE.CylinderGeometry(r*1.16,r*1.16,r*2.4,20,1,true),h3TagMat(txt));tg.position.copy(p);tg.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),t);W.add(tg);});
  if(o.sleeve){const s0=a+(b-a)*0.1,s1=b-(b-a)*0.1,sc=h3Sub(curve,s0,s1),sl=sc.getLength();
    if(o.sleeve==='heat'){const m=new THREE.MeshStandardMaterial({color:0xd9dde2,metalness:.85,roughness:.32});W.add(new THREE.Mesh(new THREE.TubeGeometry(sc,Math.max(12,Math.round(sl/(r*1.5))),r*1.32,14,false),m));
      [s0,s1].forEach(u=>{const p=curve.getPointAt(u),t=curve.getTangentAt(u),c=new THREE.Mesh(new THREE.CylinderGeometry(r*1.38,r*1.38,r*2,16),h3mat(0x0b0b0c,{roughness:.3}));c.position.copy(p);c.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),t);W.add(c);});}
    else if(o.sleeve==='wear'){const m=new THREE.MeshStandardMaterial({color:0x3c3f44,roughness:.9,metalness:.05});W.add(new THREE.Mesh(new THREE.TubeGeometry(sc,Math.max(12,Math.round(sl/(r*1.5))),r*1.22,14,false),m));}
    else if(o.sleeve==='guard'){const N=Math.round(sl/(r*0.9)),fr=sc.computeFrenetFrames(N,false),pts=[];for(let i=0;i<=N*6;i++){const k=Math.floor(i/6),q=i/6,P=sc.getPointAt(q/N),ang=i/6*Math.PI*2;pts.push(P.add(fr.normals[k].clone().multiplyScalar(Math.cos(ang)*r*1.18)).add(fr.binormals[k].clone().multiplyScalar(Math.sin(ang)*r*1.18)));}
      W.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),pts.length*2,r*0.13,6,false),h3mat(0x9aa0a8,{metalness:.85,roughness:.3})));}}
  return{tube,a,b,sub};
}
function h3Breakout(W,cv,tk,rad){
  // tape where a circuit leaves a shared bundle
  const T=H3&&H3.trunkPts&&H3.trunkPts.get(tk);if(!T)return;const N=80;let inside=false;
  for(let i=1;i<=N;i++){const p=cv.getPointAt(i/N);let m=1e9,mi=0;T.forEach((q,k)=>{const d=q.distanceTo(p);if(d<m){m=d;mi=k;}});
    if(m<tk.r*0.6){inside=true;continue;}
    if(inside&&m>tk.r*0.85){const q=T[Math.max(0,mi)],tq=T[Math.min(T.length-1,mi+1)].clone().sub(T[Math.max(0,mi-1)]).normalize();
      const boot=new THREE.Mesh(new THREE.CylinderGeometry(tk.r*1.12,tk.r*1.12,tk.r*3.6,18),h3mat(0x0b0b0c,{roughness:.28,metalness:.1}));boot.position.copy(q);boot.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),tq);W.add(boot);
      const pb=cv.getPointAt(Math.min(1,(i+2)/N)),tb=cv.getTangentAt(Math.min(1,(i+2)/N)),br=new THREE.Mesh(new THREE.CylinderGeometry(rad*1.14,rad*1.14,rad*3.4,14),h3mat(0x0b0b0c,{roughness:.28,metalness:.1}));br.position.copy(pb);br.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),tb);W.add(br);return;}}
}
const H3MNT=new Map();
function h3Mount(p,eng){
  // nearest engine/frame surface for a clamp bracket (memoised: raycasts are not cheap)
  if(!H3||!H3.mountEnv)return null;const key=H3.mountLvl+'|'+p.toArray().map(v=>v.toFixed(3)).join();if(H3MNT.has(key))return H3MNT.get(key);
  const sz=Math.sign(p.z)||1,dirs=[new THREE.Vector3(0,0,-sz),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,-0.7,-sz*0.7).normalize()];
  const rc=new THREE.Raycaster();rc.far=eng?0.1:0.14;let best=null;
  dirs.forEach(d=>{rc.set(p,d);const h=rc.intersectObjects(H3.mountEnv,false)[0];if(h&&(!best||h.distance<best.distance))best={distance:h.distance,point:h.point.clone(),d:d.clone()};});
  H3MNT.set(key,best);return best;
}
function h3HarnessHw(W,curve,r,eng,ua,ub){
  const tape=h3mat(0x0b0b0c,{roughness:.25,metalness:.1}),steel=h3mat(0xaeb3ba,{metalness:.85,roughness:.3}),nylon=h3mat(0x111111,{roughness:.7}),cush=h3mat(0x1f1f22,{roughness:.95});
  const at=u=>({p:curve.getPointAt(u),t:curve.getTangentAt(u)});
  const orient=(o,t,d)=>{const z=new THREE.Vector3().crossVectors(t,d).normalize(),m=new THREE.Matrix4().makeBasis(d,t,z);o.quaternion.setFromRotationMatrix(m);};
  const down=t=>{const d=new THREE.Vector3(0,-1,0);d.sub(t.clone().multiplyScalar(d.dot(t)));if(d.length()<0.2)d.set(0,0,1).sub(t.clone().multiplyScalar(t.z));return d.normalize();};
  [ua||0.025,ub===undefined||ub>=1?0.975:ub].forEach(u=>{const{p,t}=at(u);const c=new THREE.Mesh(new THREE.CylinderGeometry(r*1.13,r*1.13,r*4.5,18),tape);c.position.copy(p);c.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),t);W.add(c);
    for(let i=0;i<4;i++){const e=new THREE.Mesh(new THREE.TorusGeometry(r*1.14,r*0.04,4,18),tape);e.position.copy(p).add(t.clone().multiplyScalar((i-1.5)*r*1.1));e.lookAt(e.position.clone().add(t));W.add(e);}});
  [1/3,2/3].forEach(u=>{const{p,t}=at(u),d=down(t);
    const band=new THREE.Mesh(new THREE.TorusGeometry(r*1.22,r*0.14,8,24),steel);band.position.copy(p);band.lookAt(p.clone().add(t));band.scale.set(1,1,2.2);W.add(band);
    const cu=new THREE.Mesh(new THREE.TorusGeometry(r*1.12,r*0.12,6,24),cush);cu.position.copy(p);cu.lookAt(p.clone().add(t));cu.scale.set(1,1,2.6);W.add(cu);
    const mt=h3Mount(p,eng);
    if(mt&&mt.distance>r*1.4){ // bent steel bracket from the clamp tab to the surface, bolted down
      const md=mt.d,a=p.clone().add(md.clone().multiplyScalar(r*1.25)),L=mt.distance-r*1.25,side=new THREE.Vector3().crossVectors(t,md).normalize();
      const st=new THREE.Mesh(new THREE.BoxGeometry(r*1.5,L,r*0.24),steel);st.position.copy(a).add(md.clone().multiplyScalar(L/2));st.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t.clone().normalize(),md,side));W.add(st);
      const foot=new THREE.Mesh(new THREE.BoxGeometry(r*1.5,r*0.24,r*2.6),steel);foot.position.copy(mt.point).add(md.clone().multiplyScalar(-r*0.13));foot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t.clone().normalize(),md,side));W.add(foot);
      const bh=new THREE.Mesh(new THREE.CylinderGeometry(r*0.5,r*0.5,r*0.4,6),steel);bh.position.copy(mt.point).add(md.clone().multiplyScalar(-r*0.45)).add(side.clone().multiplyScalar(r*0.7));bh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),md.clone().negate());W.add(bh);
      const ws=new THREE.Mesh(new THREE.CylinderGeometry(r*0.7,r*0.7,r*0.08,14),steel);ws.position.copy(mt.point).add(md.clone().multiplyScalar(-r*0.27)).add(side.clone().multiplyScalar(r*0.7));ws.quaternion.copy(bh.quaternion);W.add(ws);
    }else{
    const tab=new THREE.Mesh(new THREE.BoxGeometry(r*2.4,r*0.95,r*0.22),steel);tab.position.copy(p).add(d.clone().multiplyScalar(r*2.3));orient(tab,t,d);W.add(tab);
    const bolt=new THREE.Mesh(new THREE.CylinderGeometry(r*0.42,r*0.42,r*0.35,6),steel);const nrm=new THREE.Vector3().crossVectors(t,d).normalize();
    bolt.position.copy(p).add(d.clone().multiplyScalar(r*2.9)).add(nrm.clone().multiplyScalar(r*0.28));bolt.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),nrm);W.add(bolt);}});
  [1/6,1/2,5/6].forEach(u=>{const{p,t}=at(u),d=down(t);
    const zt=new THREE.Mesh(new THREE.TorusGeometry(r*1.08,r*0.07,4,22),nylon);zt.position.copy(p);zt.lookAt(p.clone().add(t));zt.scale.set(1,1,2.5);W.add(zt);
    const hd=new THREE.Mesh(new THREE.BoxGeometry(r*0.55,r*0.4,r*0.4),nylon);hd.position.copy(p).add(d.clone().multiplyScalar(-r*1.25));orient(hd,t,d);W.add(hd);
    const tl=new THREE.Mesh(new THREE.BoxGeometry(r*0.14,r*0.9,r*0.3),nylon);tl.position.copy(p).add(d.clone().multiplyScalar(-r*1.8));orient(tl,t,d);W.add(tl);});
}
function h3Focus(sec){
  if(!h3Init())return;
  if(!H3.secs.ov)h3Build();
  const s=H3.secs[sec]||H3.secs.ov;if(!s)return;
  const cam=H3.camera,ctl=H3.controls;
  const l4=HX.job?HX.job.level>=4:DMM.level>=4,dir=h3ViewDir(sec,s.vp||s.p,l4);
  H3.tween={t0:performance.now(),ft:ctl.target.clone(),tt:s.p.clone(),fp:cam.position.clone(),tp:s.p.clone().add(dir.multiplyScalar(s.d))};
}
// ---------- level switching ----------
document.querySelectorAll('#canNav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#canNav button').forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('#canCard .canPg').forEach(pg=>pg.classList.toggle('on',pg.dataset.pg===b.dataset.pg));});
function togglePanel(h,e){const sec=h.closest('.panel');sec.classList.toggle('collapsed');const row=sec.closest('.top2');if(row){const ps=row.querySelectorAll(':scope>.panel');row.classList.toggle('c1',ps[0].classList.contains('collapsed'));row.classList.toggle('c2',ps[1].classList.contains('collapsed'));}if(typeof H3!=='undefined'&&H3&&H3.renderer)window.dispatchEvent(new Event('resize'));}
function setLevel(l){
  DMM.level=l;
  document.querySelectorAll('#lvlBar button').forEach(b=>b.classList.toggle('on',+b.dataset.lvl===l));
  $('lvlDesc').innerHTML={1:'<b>Bench:</b> schematic view. Faults set in the Faults tab are drawn on the circuit, and known-good values are available.',2:'<b>Blind schematic:</b> start a mystery fault. Nothing is drawn on the circuit, there are no known-good values, and the module verdict is hidden.',3:'<b>Engine harness (3D):</b> an inline six laid out like a PACCAR MX-13: rear gear train, common rail and ECM on the left (driver) side, VGT turbo and EGR cooler on the right. Circuits include the sensors and the six injectors; injector wiring runs under the valve cover, so remove the cover to reach it. Use the multimeter or the amp clamp. Move section by section, probe at connectors, and find the fault.',4:'<b>Chassis harness (3D):</b> a 6x4 long-hood tractor laid out like a Kenworth W990: sleeper cab, set-forward front axle, tandem drive axles, LH battery box and fuel tank, RH DPF/SCR, DEF tank and fuel tank. The hardest level: the fault can be on <b>any</b> circuit on the truck: ABS wheel sensors, the transmission (input and output speed, oil temperature), the air system (primary and secondary tank pressure), ambient temperature, fuel and DEF level, DEF tank temperature, the accelerator pedal, or the engine circuits from Level 3. The job doesn\'t tell you which circuit: read the codes first. Faults lean toward the hard ones (intermittent opens, corroded or pushed-out terminals, water in connectors, broken strands), more of them are mechanical, and labor counts: you lose a point for every 3 minutes past the 75-minute flat rate.',5:'<b>Compound faults (3D, whole truck):</b> every work order has <b>more than one</b> code. Sometimes the faults are separate. Often they are linked: one 5 V reference shorted to ground takes down every sensor on that supply, one wet or corroded connector sets codes on every circuit through it, losing both crank and cam leaves a no-start, or a real mechanical problem hides behind a separate wiring fault. Pick each circuit to test from the list, record a finding for it (including <i>no fault here</i> when its code comes from somewhere else), say how the faults are related, then submit the work order. False findings cost 15 points each, and the flat rate is 120 minutes.'}[l];
  $('schemWrap').style.display=l<=2?'':'none';$('dmmRef').parentElement.style.display=l===2?'none':'';$('hWrap').style.display=l>=3?'':'none';
  if(l>=3){if(HX.job&&HX.job.level!==l)hEndJob(true);h3Init();h3Build();h3Focus(HX.sec||'ov');hRenderAll();}
  else{if(HX.job)hEndJob();renderDmmBar();renderDmm();}
}
setInterval(()=>{if(DMM.level>=3&&HX.job&&$('hWrap').offsetParent&&(HX.wiggle&&performance.now()<HX.wiggle.until+400||S.ctrl.key==='run'))hRenderReading();},250);
$('lvlBar').addEventListener('click',e=>{const b=e.target.closest('button[data-lvl]');if(b)setLevel(+b.dataset.lvl);});

buildDiagram();renderTabs();updateMonitor(0);renderDmmBar();refreshAll();renderCodes();renderDmmLog();updateCtrlUI();setLevel(1);showTab(location.hash.slice(1)||'faults');
const first=[...MON.values()].find(r=>r.id===0x0CF00400);if(first){S.selMon=monKey(first);renderDecoder(first,true);}
requestAnimationFrame(tick);


// Inline onclick handlers in the markup call these by name.
Object.assign(window,{$,ENG3D,F,applyMeterPlug,buildDiagram,checkQuiz,circuitType,clearCodes,compName,dmExplainBytes,drawFaultMark,drawScope,dtcLegacy,dtcSignature,dtcView,ecmSees,el,explainFromScan,faultObj,ffView,giveUpQuiz,h3AmpClamp,h3Banana,h3BgHarness,h3Breakout,h3Build,h3Clip,h3Conn,h3CorrTube,h3CorrTubeLite,h3DrawLcd,h3EnvChassis,h3EnvEngine,h3EnvEngineBuiltIn,h3Faceplate,h3Focus,h3HarnessHw,h3Init,h3InnerWires,h3Label,h3LiftAt,h3LoadEngineModel,h3Loom,h3Meter,h3ModuleModel,h3Mount,h3MountMarks,h3OpenWires,h3Perp,h3Probe,h3ProbeSet,h3RedX,h3RemoveDelta,h3RouteDir,h3Seal,h3SensorModel,h3Sub,h3TagMat,h3ViewDir,h3Vis,h3WireTail,h3box,h3cast,h3cyl,h3envlab,h3ext,h3label,h3line,h3mat,h3prof,h3rbox,h3rr,h3torus,h3tube,hAddTime,hCauseOpts,hCheckResult,hClampAmps,hClampLabel,hClampRow,hClampText,hClampZeroBtn,hConnSpec,hDetectable,hElecFault,hEndJob,hGender,hGenderR,hGo,hInspectConn,hInstallRoutes,hL5Answer,hL5Grade,hL5Point,hL5Record,hL5ResetView,hL5Scenario,hL5Start,hL5Submit,hL5Switch,hL5Top,hMakeFault,hMeasure,hMechHTML,hMechKey,hNodeUnder,hOpenLoom,hPinRow,hPlugAll,hPointLabel,hRandom,hRemovedNote,hRenderAll,hRenderAnswer,hRenderLog,hRenderMeterBar,hRenderReading,hRenderSecs,hRenderSection,hRenderTop,hRoute,hRunCheck,hSections,hSegTrunk,hSetClamp,hSetLead,hSetTool,hStartJob,hSubmit,hTimeNote,hTimePen,hToggleCover,hTogglePlug,hToggleRemove,hType,hUnder,hWiggle,isErr,j1587,lampTxt,layoutFor,layoutPills,measureNow,meterReq,monKey,ownerName,ownerOf,pgnOf,pointLabel,pp,probeFromScan,qHas,quizHides,quizLabel,rb1,rb2,readDM2,reading,refreshAll,refreshPanelLive,renderCluster,renderCodes,renderDecoder,renderDiagram,renderDmm,renderDmmBar,renderDmmLog,renderDmmReading,renderExplain,renderFaultPanel,renderMonitor,renderQuizBox,renderScan,renderTabs,renderToolCodes,runCutout,runRegen,scanCodeInfo,scanDetail,scanFaults,scanLiveShell,scanNet,scanSignature,scanTests,setFault,setKey,setLevel,setMeterCircuit,setNet,showTab,spawnPacket,spnName,startQuiz,statusBadge,termRes,tick,togglePanel,toggleTerm,toolLog,tx,updateCtrlUI,updateLive,updateMonitor,values,HX,DMM,S});
setTimeout(()=>{try{h3LoadEngineModel();}catch(e){}},0);
