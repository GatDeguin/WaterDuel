const clamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
const ramp=(param,value,now)=>{param.cancelScheduledValues?.(now);if(param.setTargetAtTime)param.setTargetAtTime(value,now,.025);else param.value=value;};
const DELAYS=[.0297,.0371,.0411,.0437];

/** A bounded native effect bus: subtle saturation, then a short shared room.
 * Decay adjusts feedback coefficients; there are no PCM impulses to rebuild. */
export class EffectsRack{
  constructor(context,input,output,settings){
    this.context=context;this.input=input;this.output=output;this.shaper=context.createWaveShaper();this.dry=context.createGain();this.wet=context.createGain();this.roomInput=context.createGain();
    this.lines=[];this.roomNodes=[];this.disposed=false;this.dirty=false;this.distortion=null;this.reverb=null;this.decay=null;
    input.disconnect(output);input.connect(this.shaper);this.shaper.connect(this.dry).connect(output);this.shaper.connect(this.roomInput);this.wet.connect(output);
    this.buildRoom();this.configure(settings);
  }
  buildRoom(){
    const ctx=this.context;if(typeof ctx.createDelay!=='function'||typeof ctx.createBiquadFilter!=='function')return;
    try{
      for(const [index,seconds]of DELAYS.entries()){
        const delay=ctx.createDelay(.1),filter=ctx.createBiquadFilter(),feedback=ctx.createGain(),tap=ctx.createGain(),pan=typeof ctx.createStereoPanner==='function'?ctx.createStereoPanner():ctx.createGain();
        this.roomNodes.push(delay,filter,feedback,tap,pan);delay.delayTime.value=seconds;feedback.gain.value=0;filter.type='lowpass';filter.frequency.value=4700+index*310;filter.Q.value=.35;tap.gain.value=.23;if(pan.pan)pan.pan.value=index%2?.38:-.38;
        this.roomInput.connect(delay).connect(filter);filter.connect(feedback).connect(delay);filter.connect(tap).connect(pan).connect(this.wet);this.lines.push({delay,filter,feedback,seconds});
      }
    }catch{this.clearLines();}
  }
  configure({distortion=.03,reverb=.08,reverbDecay=1.1}={}){
    distortion=clamp(distortion,0,1,.03);reverb=clamp(reverb,0,1,.08);reverbDecay=clamp(reverbDecay,.2,2.4,1.1);const now=this.context.currentTime;
    if(this.distortion!==distortion){
      const curve=new Float32Array(2049),normal=Math.tanh(2.5);
      for(let i=0;i<curve.length;i++){const x=i/1024-1;curve[i]=(1-distortion)*x+distortion*Math.tanh(2.5*x)/normal;}
      this.shaper.curve=curve;this.distortion=distortion;
    }
    if(this.reverb!==reverb){ramp(this.dry.gain,1-reverb*.25,now);ramp(this.wet.gain,this.lines.length?reverb:0,now);this.reverb=reverb;}
    if(this.decay!==reverbDecay){for(const line of this.lines)ramp(line.feedback.gain,Math.min(.94,Math.pow(10,-3*line.seconds/reverbDecay)),now);this.decay=reverbDecay;}
  }
  markActive(){this.dirty=true;}
  clearLines(){
    try{this.roomInput.disconnect();}catch{}for(const node of this.roomNodes)try{node.disconnect();}catch{}this.roomNodes=[];this.lines=[];
  }
  reset(){
    if(!this.dirty||this.disposed)return;this.dirty=false;this.clearLines();this.buildRoom();const settings={distortion:this.distortion,reverb:this.reverb,reverbDecay:this.decay};this.reverb=null;this.decay=null;this.configure(settings);
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.clearLines();try{this.input.disconnect(this.shaper);}catch{}for(const node of [this.shaper,this.dry,this.wet,this.roomInput])try{node.disconnect();}catch{}}
}
