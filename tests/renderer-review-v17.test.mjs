import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DuelEngine,STEP,neutral} from '../public/engine.js';
import {Renderer3D} from '../public/render3d.js';
import {HostSession} from '../public/host-session.js';
import {RemoteInputBuffer,isFreshRemoteInput} from '../public/remote-input.js';
import {FrameMetrics} from '../public/performance.js';
import {AdaptiveQuality} from '../public/adaptive-quality.js';
import {captureReplayState} from '../public/replay.js';
import {AssetGPU} from '../public/rendering/asset-gpu.js';
import {bendEquipmentPoint} from '../public/rendering/equipment-flex.js';
import {equipmentTransform,deformEquipmentPoint} from '../public/rendering/asset-rig.js';

function context(){
  let serial=0;const trace={buffers:new Set(),vaos:new Set(),programs:new Set(),shaders:new Set(),uniforms:{},uniformOwners:new Map(),program:null,sources:[],draws:0,mask:[true,true,true,true]};
  const check=key=>{if(trace.uniformOwners.has(key))assert.equal(trace.program,trace.uniformOwners.get(key),'uniform belongs to the active WebGL program');};
  const resource=key=>{const x={id:++serial};trace[key].add(x);return x;};
  const gl=new Proxy({
    createBuffer:()=>resource('buffers'),deleteBuffer:x=>trace.buffers.delete(x),
    createVertexArray:()=>resource('vaos'),deleteVertexArray:x=>trace.vaos.delete(x),
    createShader:()=>resource('shaders'),deleteShader:x=>trace.shaders.delete(x),
    createProgram:()=>resource('programs'),deleteProgram:x=>trace.programs.delete(x),
    shaderSource:(_s,source)=>trace.sources.push(source),getShaderParameter:()=>true,getProgramParameter:()=>true,
    getUniformLocation:(p,key)=>{trace.uniformOwners.set(key,p);return key;},getExtension:()=>null,useProgram:p=>trace.program=p,
    getParameter:key=>key==='VERSION'?'WebGL 2.0 test':key==='COLOR_WRITEMASK'?trace.mask.slice():undefined,
    colorMask:(...mask)=>trace.mask=mask,
    uniform3fv:(key,v)=>{check(key);trace.uniforms[key]=Array.from(v);},uniform4fv:(key,v)=>{check(key);trace.uniforms[key]=Array.from(v);},
    uniform1i:(key,v)=>{check(key);trace.uniforms[key]=v;},
    drawElements:()=>trace.draws++,drawArrays:()=>trace.draws++,drawElementsInstanced:()=>trace.draws++,
  },{get:(o,k)=>k in o?o[k]:typeof k==='string'&&/^[A-Z0-9_]+$/.test(k)?k:()=>{}});
  return {gl,trace};
}

test('Preparar el renderer presenta el estado real sin pasos físicos ni cambios al replay y libera sus buffers',async()=>{
  const {gl,trace}=context(),previousWindow=globalThis.window;
  globalThis.window={devicePixelRatio:1};
  const canvas={clientWidth:640,clientHeight:360,width:640,height:360,getContext:()=>gl};
  const r=new Renderer3D(canvas),events=[],g=new DuelEngine((...event)=>events.push(event));
  const render=r.render.bind(r);
  // Exercise the real postprocess end state even in this no-FBO fallback mock.
  r.render=(...args)=>{render(...args);r.presentScene(null,r.width,r.height);};
  try{
    const before=captureReplayState(g),joints=g.fighters.map(f=>({q:Array.from(f.rig.q),velocity:Array.from(f.rig.velocity),target:Array.from(f.rig.target)}));
    const eventCount=events.length;
    await r.prepareGame(g);
    assert.equal(r.prepared,true);assert.ok(trace.draws>0,'La preparación envía geometría real además de reservar memoria.');
    assert.equal(r.opticalPathDepth.width,640);assert.equal(r.opticalPathDepth.height,360,'el target óptico se prepara incluso antes de la primera ruptura');
    assert.deepEqual(captureReplayState(g),before);
    assert.deepEqual(g.fighters.map(f=>({q:Array.from(f.rig.q),velocity:Array.from(f.rig.velocity),target:Array.from(f.rig.target)})),joints);
    assert.equal(events.length,eventCount);assert.ok(r.floatStream.stats.capacityBytes>0);
    const draws=trace.draws,allocations=r.floatStream.stats.allocations;
    await r.prepareGame(g);assert.equal(trace.draws,draws);assert.equal(r.floatStream.stats.allocations,allocations);
    r.dispose();assert.equal(r.floatStream.buffers.size,0);
    for(const key of ['buffers','vaos','programs','shaders'])assert.equal(trace[key].size,0,key);
  }finally{r.dispose();globalThis.window=previousWindow;}
});

test('game.js mantiene el inicio y RAF bloqueados después de cargar assets hasta completar prepareGame',async()=>{
  const source=await readFile(new URL('../public/game.js',import.meta.url),'utf8');
  const raf=[],state={now:0,host:null,prepareStarted:false,renderer:null},handlers=()=>({addEventListener(){}});
  let finish;const preparation=new Promise(resolve=>finish=resolve);
  class Host extends HostSession{constructor(o){super(o);state.host=this;this.updates=0;}update(dt){this.updates++;super.update(dt);}}
  class Render{
    constructor(){state.renderer=this;this.waterSurfaces=new Map();this.stats={};this.prepared=false;this.assetStatus={loading:false,ready:11,total:11};}
    loadAssets(onStatus){onStatus({...this.assetStatus,loading:true});onStatus(this.assetStatus);return Promise.resolve();}
    async prepareGame(){state.prepareStarted=true;await preparation;this.prepared=true;}
    render(){}dispose(){}
  }
  class Audio{configure(){}setPaused(){}update(){}unlock(){}handleEvent(){}}
  const mobileSession={paused:false,bindHost(){},neutralize(){},sample:neutral,publish(){},event(){}};
  vm.runInNewContext(source.replace(/^import[^\n]+;\s*$/gm,''),{
    STEP,neutral,Renderer3D:Render,HostSession:Host,RemoteInputBuffer,isFreshRemoteInput,FrameMetrics,AdaptiveQuality,GameAudio:Audio,
    HostQRCodes:class{setSession(){}hide(){}},mobileSession,
    document:{...handlers(),hidden:false,documentElement:{dataset:{mobileGame:'true'}},getElementById:()=>handlers()},
    window:{...handlers(),localStorage:null},performance:{now:()=>state.now},console,
    requestAnimationFrame:callback=>raf.push(callback),setTimeout:()=>0,clearTimeout(){},
  },{filename:'public/game.js'});
  await new Promise(setImmediate);
  const h=state.host;assert.equal(state.prepareStarted,true);assert.equal(h.presentationBlocked,true);
  const start={type:'command',requestId:1,sentAt:Date.now(),command:'start'};
  assert.equal(h.handleCommand(start).ok,false);
  const frozen=captureReplayState(h.game);
  for(let i=0;i<6;i++){state.now+=1000/60;raf.shift()(state.now);}
  assert.equal(h.updates,0);assert.deepEqual(captureReplayState(h.game),frozen);
  finish();await new Promise(setImmediate);
  assert.equal(h.presentationBlocked,false);assert.equal(h.handleCommand(start).ok,true);
  state.now+=1000/60;raf.shift()(state.now);assert.ok(h.updates>0);assert.equal(h.game.phase,'countdown');
});

test('AssetGPU transmite la misma flexión física del deformador CPU y reinicia flexión/humedad por pieza',async()=>{
  const {gl,trace}=context(),gpu=new AssetGPU(gl),U=new Proxy({},{get:(_o,k)=>k});
  const asset={materials:[{}],primitives:[{positions:Float32Array.from([0,0,0,0,.75,0,.01,.4,0]),normals:Float32Array.from([0,0,1,0,0,1,0,0,1]),indices:Uint32Array.from([0,1,2])}]};
  const model=await gpu.upload(asset);
  try{
    for(const dir of [-1,1])for(const offset of [-.035,1e-7,.035]){
      const fighter={dir,equipment:{weapon:'sword'},pose:{mainHand:{x:.2,y:2,z:.17},tip:{x:.8,y:2.1,z:.17},weaponRootDirection:{x:dir,y:0,z:0},weaponFlex:{offset,length:.9}}};
      const params=equipmentTransform(fighter,'sword');
      gpu.draw(model,model.parts[0],params.matrix,U,{...params,wetTop:.7,wetBottom:.3,wetMinY:-.2,wetMaxY:.3});
      const [bend,length,direction]=trace.uniforms.uAssetFlex;
      assert.ok(Math.abs(bend-offset)<1e-8);assert.ok(Math.abs(length-.9)<1e-7);assert.equal(direction,dir);
      // Float32 uniform precision and the shader's small-angle approximation
      // must agree with CPU picking, including grip points below the guard.
      for(const p of [[.01,.2,0],[0,.75,0],[.01,-.1,0]]){
        const cpu=deformEquipmentPoint(p,params),extended=p.slice();
        extended[1]+=Math.max(0,Math.min(1,(extended[1]-params.deformStart)/(params.deformEnd-params.deformStart)))*params.extension;
        const shader=gpuBend(extended,bend,length,direction);
        for(let i=0;i<3;i++)assert.ok(Math.abs(shader[i]-cpu[i])<2e-7,`${dir}/${offset}/${p}: axis ${i}`);
        assert.deepEqual(cpu,bendEquipmentPoint(extended,params));
      }
    }
    gpu.draw(model,model.parts[0],model.parts[0].worldMatrix,U);
    assert.deepEqual(trace.uniforms.uAssetFlex,[0,1,1]);assert.deepEqual(trace.uniforms.uAssetWet,[0,0,0,1]);
  }finally{gpu.dispose();}
  assert.equal(trace.buffers.size,0);assert.equal(trace.vaos.size,0);
});

// The shader formula is evaluated with the actual Float32 uniforms delivered
// above; this supplements browser GPU compilation/render verification.
function gpuBend([x,y,z],offset,length,dir){
  if(Math.abs(offset)<=1e-8||y<=0)return [x,y,z];
  const len=Math.max(.001,length),theta=2*offset/len,a=theta*y/len,c=Math.cos(a),s=Math.sin(a);
  const ax=Math.abs(a)<.001?-dir*y*a*.5:-dir*len*(1-c)/theta;
  const ay=Math.abs(a)<.001?y*(1-a*a/6):len*s/theta;
  return [ax+x*c,ay+dir*x*s,z];
}
