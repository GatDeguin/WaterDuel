// Local diagnostics only. No telemetry, requests, identifiers or persisted data.
export class FrameMetrics{
  constructor(windowSize=300){this.windowSize=windowSize;this.frames=[];this.heapPeakBytes=null;}
  record(frame){
    if(!Number.isFinite(frame.frameMs)||frame.frameMs<=0)return;
    this.frames.push({...frame});
    if(this.frames.length>this.windowSize)this.frames.shift();
    if(Number.isFinite(frame.heapBytes))this.heapPeakBytes=Math.max(this.heapPeakBytes||0,frame.heapBytes);
  }
  snapshot(phase=null){
    const frames=phase?this.frames.filter(frame=>frame.phase===phase):this.frames;
    if(!frames.length)return null;
    const times=frames.map(frame=>frame.frameMs).sort((a,b)=>a-b);
    const mean=key=>frames.reduce((sum,frame)=>sum+(frame[key]||0),0)/frames.length;
    return {samples:frames.length,fpsMean:1000/mean('frameMs'),fpsMin:1000/times.at(-1),
      frameP95Ms:times[Math.ceil(times.length*.95)-1],frameMaxMs:times.at(-1),
      simulationMeanMs:mean('simulationMs'),renderCpuMeanMs:mean('renderMs'),heapPeakBytes:this.heapPeakBytes};
  }
}
