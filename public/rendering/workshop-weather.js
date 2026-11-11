const GLASS='Workshop v4 PBR | old undulating window glass';
const SKY='WD_V4_EXT_overcast_sky';
const FILAMENT='Workshop v2 PBR | lamp-warm-tungsten-filament';
const MAIN_CIRCUIT=/^(?:Key \| warm workshop softbox|(?:Practical warm bulb|Shade downlight)(?:\.\d+)?)$/;
const FLASH_COLOR=[.78,.87,1];
const BOSS_SECONDARY=new Map([
  ['Right table glancing reflection',{gain:1.24,tint:[1,.91,.76]}],
  ['Soft front return',{gain:.72,tint:[.87,.96,1.09]}],
  ['Back banner wash',{gain:.52,tint:[1,1,1]}]
]);
// Extend the exterior volume along the neutral sightlines so the whole glass
// opening sees precipitation at every depth. The opaque reveal masks spill.
const GLASS_Z=-4.94,NEUTRAL_EYE_Y=1.64,NEUTRAL_EYE_Z=10.4;
const PANE_MIN_X=1.62,PANE_WIDTH=2.75,OUTSIDE_Z=-5.42;
const PANE_MIN_Y=1.28,PANE_HEIGHT=4.78;
const wrap=(value,size)=>((value%size)+size)%size;
const flashValue=(sample,reducedMotion)=>sample.flash*(reducedMotion?.18:1);

function quadMesh(count){
  const p=new Float32Array(count*18),n=new Float32Array(count*18);
  for(let i=2;i<n.length;i+=3)n[i]=1;
  return {p,n};
}
function writeQuad(p,i,z,ax,ay,bx,by,cx,cy,dx,dy){
  p[i]=ax;p[i+1]=ay;p[i+2]=z;
  p[i+3]=cx;p[i+4]=cy;p[i+5]=z;
  p[i+6]=bx;p[i+7]=by;p[i+8]=z;
  p[i+9]=ax;p[i+10]=ay;p[i+11]=z;
  p[i+12]=dx;p[i+13]=dy;p[i+14]=z;
  p[i+15]=cx;p[i+16]=cy;p[i+17]=z;
}
function precipitation(kind){
  const snow=kind==='snow',storm=kind==='storm';
  const count=storm?176:snow?132:116;
  let state=0x3c8e2d09;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const drops=Array.from({length:count},(_,i)=>{
    const x=random()*PANE_WIDTH,y=random()*PANE_HEIGHT,z=OUTSIDE_Z-random()*1.52;
    const spread=1+(GLASS_Z-z)/(NEUTRAL_EYE_Z-GLASS_Z);
    return {side:i%2?1:-1,x,y,z,spread,
      speed:snow?.38+random()*.44:4.1+random()*2.5,
      size:snow?.017+random()*.017:.012+random()*.009,
      length:snow?0:.15+random()*.19,phase:random()*Math.PI*2};
  });
  const mesh=quadMesh(count);
  return {mesh,color:snow?0xe2f1ff:storm?0xbccded:0xc1d8ed,opacity:snow?.79:storm?.62:.51,drops};
}
function animatePrecipitation(layer,kind,time){
  if(layer.elapsed===time)return;
  layer.elapsed=time;
  const snow=kind==='snow',storm=kind==='storm',wind=storm?.84:.33;
  const {p}=layer.mesh;
  for(let i=0;i<layer.drops.length;i++){
    const drop=layer.drops[i],{side,z,size,length,spread}=drop;
    const drift=snow?time*.16+.15*Math.sin(time*1.35+drop.phase):time*wind;
    const x=side*(PANE_MIN_X+wrap(drop.x+side*drift,PANE_WIDTH))*spread;
    const y=NEUTRAL_EYE_Y+(PANE_MIN_Y+wrap(drop.y-time*drop.speed,PANE_HEIGHT)-NEUTRAL_EYE_Y)*spread;
    if(snow)writeQuad(p,i*18,z,x,y+size,x+size,y,x,y-size,x-size,y);
    else{
      const tail=x+length*(storm?.26:.15),tailWidth=size*.42;
      writeQuad(p,i*18,z,x-size,y,x+size,y,tail+tailWidth,y-length,tail-tailWidth,y-length);
    }
  }
}

const BOLT_COLOR=Object.freeze([1.6,1.72,1.92]);
// Put the fork in the strip of sky visible above the roofs from the arena.
const boltPoints=[[0,9.68],[.27,8.63],[-.36,8.08],[.16,7.68],[-.31,7.18],[.1,6.74],
  [.58,8.02],[.96,7.79],[.78,7.32]];
const boltSegments=[[0,1],[1,2],[2,3],[3,4],[4,5],[1,6],[6,7],[7,8]];
function animateBolt(mesh,x,flash){
  const mirror=x<0?-1:1;
  for(let i=0;i<boltSegments.length;i++){
    const [a,b]=boltSegments[i],start=boltPoints[a],end=boltPoints[b];
    const from=x+mirror*start[0],to=x+mirror*end[0],size=(i<5?.092:.044)*(.66+flash*.34);
    writeQuad(mesh.p,i*18,-17.72,from-size,start[1],from+size,start[1],to+size,end[1],to-size,end[1]);
  }
}

/** Per-renderer presentation. Reuse GLB bindings and dynamic stream buffers.
 * Call draw only on the visible pass, after the opaque room and before glass. */
export function createWorkshopWeather(){
  const lightCache=new WeakMap(),materialCache=new WeakMap(),layers=new Map();
  let bolt=null;

  function lighting(base,sample,reducedMotion=false){
    if(!base||!sample)return base;
    let state=lightCache.get(base);
    if(!state){
      const windows=base.names.flatMap((name,index)=>/window/i.test(name)?[{offset:index*4,side:Math.sign(base.positions[index*4])}]:[]);
      const circuit=base.names.flatMap((name,index)=>MAIN_CIRCUIT.test(name)?[index*4]:[]);
      const secondary=base.names.flatMap((name,index)=>BOSS_SECONDARY.has(name)?[{offset:index*4,...BOSS_SECONDARY.get(name)}]:[]);
      if(!windows.length&&!circuit.length&&!secondary.length)return base;
      state={windows,circuit,secondary,view:{...base,positions:base.positions.slice(),colors:base.colors.slice()},
        profile:null,flash:0,power:1,blackout:0,strikeSide:0};
      lightCache.set(base,state);
    }
    const {profile}=sample,flash=flashValue(sample,reducedMotion);
    const power=sample.mainPower??1;
    if(state.power!==power){
      state.power=power;
      for(const index of state.circuit)state.view.positions[index+3]=base.positions[index+3]*power;
    }
    const blackout=sample.bossStorm?1-power:0,strikeSide=sample.bossStorm&&flash>0?Math.sign(sample.lightningX):0;
    if(state.blackout!==blackout){
      for(const {offset,gain,tint} of state.secondary){
        state.view.positions[offset+3]=base.positions[offset+3]*(1+(gain-1)*blackout);
        for(let axis=0;axis<3;axis++)state.view.colors[offset+axis]=base.colors[offset+axis]*(1+(tint[axis]-1)*blackout);
      }
    }
    if(state.profile===profile&&state.flash===flash&&state.blackout===blackout&&state.strikeSide===strikeSide)return state.view;
    state.profile=profile;state.flash=flash;state.blackout=blackout;state.strikeSide=strikeSide;
    for(const {offset,side} of state.windows){
      // The near pane throws the main stroke, the opposite pane catches its return.
      const strikeGain=strikeSide===0?3.65:side===strikeSide?4.8:.75;
      state.view.positions[offset+3]=base.positions[offset+3]*(profile.windowGain*(1-.35*blackout)+flash*strikeGain);
      const blend=flash*(strikeSide===0?.7:side===strikeSide?.82:.28);
      for(let axis=0;axis<3;axis++){
        const tint=base.colors[offset+axis]*profile.windowTint[axis];
        state.view.colors[offset+axis]=tint+(FLASH_COLOR[axis]-tint)*blend;
      }
    }
    return state.view;
  }

  function environment(model,sample,reducedMotion=false){
    if(!model||!sample)return model;
    let state=materialCache.get(model);
    if(!state){
      const materials=model.materials.slice(),targets=[];
      for(const [index,material] of materials.entries()){
        if(material.name!==GLASS&&material.name!==SKY&&material.name!==FILAMENT)continue;
        const color=material.baseColorFactor.slice(),emission=material.emissiveFactor.slice();
        const override={...material,baseColorFactor:color,emissiveFactor:emission};
        materials[index]=override;
        targets.push({index,source:material,override,color,emission});
      }
      if(!targets.length)return model;
      state={targets,view:{...model,materials},profile:null,flash:0,power:1};materialCache.set(model,state);
    }
    const {profile}=sample,flash=flashValue(sample,reducedMotion)*(sample.bossStorm?.74:1);
    const power=sample.mainPower??1,changed=state.profile!==profile||state.flash!==flash||state.power!==power;
    state.profile=profile;state.flash=flash;state.power=power;
    for(const target of state.targets){
      const source=model.materials[target.index];
      if(!changed&&target.source===source)continue;
      if(target.source!==source){
        target.source=source;
        Object.assign(target.override,source,{baseColorFactor:target.color,emissiveFactor:target.emission});
      }
      if(source.name===FILAMENT){
        target.override.baseColorFactor=source.baseColorFactor;
        target.override.emissiveFactor=source.emissiveFactor;
        target.override.mainCircuitPower=power;
        continue;
      }
      for(let axis=0;axis<3;axis++){
        if(source.name===GLASS){
          target.color[axis]=source.baseColorFactor[axis]*profile.glassTint[axis];
          target.emission[axis]=source.emissiveFactor[axis]*profile.glassGlow+FLASH_COLOR[axis]*flash*.27;
        }else{
          target.color[axis]=profile.sky[axis];
          target.emission[axis]=profile.sky[axis]*.82+FLASH_COLOR[axis]*flash*1.26;
        }
      }
      target.color[3]=source.baseColorFactor[3]*(source.name===GLASS?profile.glassAlpha:1);
    }
    return state.view;
  }

  function draw(renderer,sample,reducedMotion=false){
    if(!sample)return;
    const {kind,profile,elapsed,lightningX}=sample,disc=profile.disc;
    if(disc)renderer.sphere(...disc.position,disc.radius,disc.radius,.035,disc.color,6);
    const flash=reducedMotion?0:sample.flash;
    if(!profile.precipitation&&flash<.035)return;
    renderer.gl.depthMask(false);
    try{
      if(profile.precipitation){
        let layer=layers.get(kind);
        if(!layer){layer=precipitation(kind);layers.set(kind,layer);}
        animatePrecipitation(layer,kind,reducedMotion?0:elapsed);
        renderer.flushDynamic({mesh:layer.mesh,color:layer.color,opacity:layer.opacity,material:6});
      }
      if(flash>=.035){
        bolt??=quadMesh(boltSegments.length);animateBolt(bolt,lightningX,flash);
        renderer.flushDynamic({mesh:bolt,color:BOLT_COLOR,opacity:Math.min(1,flash*2.6),material:6});
      }
    }finally{renderer.gl.depthMask(true);}
  }

  return {lighting,environment,draw};
}
