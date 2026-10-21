/** Render-only budget policy. It never changes simulation, input or replay data. */
const qualityNames=new Set(['eco','high','ultra']);
const scales=[1,.94,.86,.78,.7];
export function renderQualityView(scene,profile){
  if(!profile||profile.mode==='fixed'||profile.quality===scene.quality)return scene;
  return Object.assign(Object.create(Object.getPrototypeOf(scene)),scene,{quality:profile.quality});
}
export class AdaptiveQuality{
  constructor(){this.mode='fixed';this.quality='high';this.reset();}
  reset(){this.level=0;this.pressure=0;this.lowSince=null;this.lastChange=-Infinity;this.lastNow=null;this.phase=null;}
  configure(mode,quality){
    const nextMode=mode==='adaptive'?'adaptive':'fixed',nextQuality=qualityNames.has(quality)?quality:'high';
    if(this.mode!==nextMode||this.quality!==nextQuality){this.mode=nextMode;this.quality=nextQuality;this.reset();}
  }
  profile(phase,replay=false,now=this.lastNow??0){
    if(this.mode==='fixed'||replay)return {mode:'fixed',level:0,quality:this.quality,renderScale:1};
    // The measured high-quality rupture exceeds a frame's budget before the
    // first feedback sample. Start there at the existing ECO surface/shadows;
    // every simulated parcel, material, optical pass and effect stays present.
    if(phase==='burst'&&this.level<2){this.level=2;this.pressure=0;this.lowSince=null;this.lastChange=Number.isFinite(now)?now:0;}
    const quality=this.level>=2?'eco':this.level===1&&this.quality==='ultra'?'high':this.quality;
    return {mode:this.mode,level:this.level,quality,renderScale:scales[this.level]};
  }
  observe({now,workMs,phase,eligible=true}){
    if(!Number.isFinite(now)||!Number.isFinite(workMs)||workMs<0)return;
    if(this.lastNow!==null&&now<this.lastNow){this.reset();return;}
    this.lastNow=now;
    if(!eligible||this.mode==='fixed'){this.pressure=0;this.lowSince=null;this.phase=null;return;}
    if(phase!==this.phase){this.phase=phase;this.pressure=0;this.lowSince=null;}
    this.pressure=workMs>15.5?this.pressure+1:0;
    if(this.pressure>=4&&this.level<4&&now-this.lastChange>=450){
      this.level++;this.lastChange=now;this.pressure=0;this.lowSince=null;return;
    }
    const floor=phase==='burst'?2:0;
    if(workMs<10.5){
      this.lowSince??=now;
      if(this.level>floor&&now-this.lowSince>=2200&&now-this.lastChange>=450){
        this.level--;this.lastChange=now;this.lowSince=now;this.pressure=0;
      }
    }else this.lowSince=null;
  }
}
