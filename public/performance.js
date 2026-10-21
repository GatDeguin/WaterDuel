// Local diagnostics only. No telemetry, requests, identifiers or persisted data.
export class FrameMetrics{
  constructor(windowSize=300){this.windowSize=Math.max(1,Math.floor(windowSize));this.slots=Array.from({length:this.windowSize},()=>({}));this.count=0;this.cursor=0;this.heapPeakBytes=null;this.events={clash:0,detach:0};this.peaks={steady:0,clash:0,detach:0,burst:0};}
  get frames(){return Array.from({length:this.count},(_,i)=>this.slots[(this.cursor-this.count+i+this.windowSize)%this.windowSize]);}
  markEvent(name,now){if(!Number.isFinite(now))return;if(name==='clang')this.events.clash=now+250;if(name==='joint-break')this.events.detach=now+600;}
  record(frame){
    if(!Number.isFinite(frame.frameMs)||frame.frameMs<=0)return;
    const out=this.slots[this.cursor];out.frameMs=frame.frameMs;out.simulationMs=frame.simulationMs;out.renderMs=frame.renderMs;out.phase=frame.phase;out.now=frame.now;out.eligible=frame.eligible;out.heapBytes=frame.heapBytes;
    out.case=frame.phase==='burst'?'burst':Number.isFinite(frame.now)&&frame.now<this.events.detach?'detach':Number.isFinite(frame.now)&&frame.now<this.events.clash?'clash':'steady';
    this.cursor=(this.cursor+1)%this.windowSize;this.count=Math.min(this.windowSize,this.count+1);
    if(frame.eligible!==false)this.peaks[out.case]=Math.max(this.peaks[out.case],frame.frameMs);
    if(Number.isFinite(frame.heapBytes))this.heapPeakBytes=Math.max(this.heapPeakBytes||0,frame.heapBytes);
  }
  snapshot(phase=null,{eligibleOnly=false}={}){
    const frames=this.frames.filter(frame=>(!phase||frame.phase===phase||frame.case===phase)&&(!eligibleOnly||frame.eligible!==false));
    if(!frames.length)return null;
    const times=frames.map(frame=>frame.frameMs).sort((a,b)=>a-b);
    const mean=key=>frames.reduce((sum,frame)=>sum+(frame[key]||0),0)/frames.length;
    return {samples:frames.length,fpsMean:1000/mean('frameMs'),fpsMin:1000/times.at(-1),
      frameP95Ms:times[Math.ceil(times.length*.95)-1],frameMaxMs:times.at(-1),
      simulationMeanMs:mean('simulationMs'),renderCpuMeanMs:mean('renderMs'),heapPeakBytes:this.heapPeakBytes};
  }
  report(){return Object.fromEntries(['steady','clash','detach','burst'].map(kind=>{const value=this.snapshot(kind,{eligibleOnly:true});return [kind,value?{...value,sessionMaxMs:this.peaks[kind]}:null];}));}
}
