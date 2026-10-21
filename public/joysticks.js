/** Independent radial joysticks. No network, game rules or global DOM state. */
const DEAD_ZONE=.08;
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const arrows=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
const centered=()=>({x:0,y:0});

/** The left gesture is a level, not a repeated action timer. The simulation
 * interprets up as one feint on entry and down as a sustained crouch.
 */
export function movementGesture({x,y}){
  x=finite(x);y=finite(y);const length=Math.hypot(x,y);
  if(length>1){x/=length;y/=length;}
  return {lean:x,bodyY:y};
}

/** One right-thumb gesture controls the arm, wrist and sustained attack intent.
 * Wrist gain leaves room for the arm's own elevation; no angle branch cut or
 * independent button can leave an attack behind when this gesture is released.
 */
export function weaponGesture({x,y}){
  x=finite(x);y=finite(y);const length=Math.hypot(x,y);
  if(length>1){x/=length;y/=length;}
  return {mainX:x,mainY:y,wrist:.65*y,attackHeld:Math.hypot(x,y)>.25};
}

export function joystickGeometry(rect,knobRect,inset=8,axis='radial'){
  const width=Math.max(0,finite(rect.width)),height=Math.max(0,finite(rect.height));
  const knob=Math.max(0,finite(knobRect.width),finite(knobRect.height));
  return {centerX:finite(rect.left)+width/2,centerY:finite(rect.top)+height/2,
    radius:Math.max(0,(axis==='horizontal'?width:Math.min(width,height))/2-knob/2-Math.max(0,finite(inset,8)))};
}

export function radialAxes(event,geometry){
  if(!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY)||!(geometry.radius>0))return centered();
  const x=(event.clientX-geometry.centerX)/geometry.radius,y=(geometry.centerY-event.clientY)/geometry.radius;
  const length=Math.hypot(x,y);
  if(length<=DEAD_ZONE)return centered();
  const magnitude=(Math.min(1,length)-DEAD_ZONE)/(1-DEAD_ZONE);
  return {x:x/length*magnitude,y:y/length*magnitude};
}

export class RadialJoystick{
  constructor({element,knob,onChange,enabled=()=>true,axis='radial'}){
    this.element=element;this.knob=knob;this.onChange=onChange;this.enabled=enabled;
    this.axis=axis;this.pointer=null;this.keys=new Set();this.current=centered();
    element.addEventListener('pointerdown',event=>{
      if(!this.enabled()||this.pointer!==null||(Number.isFinite(event.button)&&event.button!==0))return;
      this.pointer=event.pointerId;this.keys.clear();
      try{element.setPointerCapture(event.pointerId);}catch{this.reset();return;}
      this.move(event);event.preventDefault();
    });
    element.addEventListener('pointermove',event=>{
      if(event.pointerId!==this.pointer)return;
      if(!this.enabled()){this.reset();return;}
      this.move(event);event.preventDefault();
    });
    const end=event=>{if(event.pointerId===this.pointer)this.reset();};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(type,end);
    for(const type of ['keydown','keyup'])element.addEventListener(type,event=>{
      if(!this.enabled()||(!arrows.has(event.key)&&event.key!=='Home'&&event.key!=='Escape'))return;
      event.preventDefault();
      if(event.key==='Home'||event.key==='Escape'){if(type==='keydown')this.reset();return;}
      if(this.axis==='horizontal'&&['ArrowUp','ArrowDown'].includes(event.key))return;
      if(this.pointer!==null)return;
      if(type==='keydown')this.keys.add(event.key);else this.keys.delete(event.key);
      let x=Number(this.keys.has('ArrowRight'))-Number(this.keys.has('ArrowLeft'));
      let y=Number(this.keys.has('ArrowUp'))-Number(this.keys.has('ArrowDown'));
      const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}
      this.apply({x,y});
    });
    element.addEventListener('blur',()=>this.reset());
    this.render();
  }
  get value(){return {...this.current};}
  geometry(){return joystickGeometry(this.element.getBoundingClientRect(),this.knob.getBoundingClientRect(),8,this.axis);}
  move(event){const geometry=this.geometry();this.apply(radialAxes(this.axis==='horizontal'?{clientX:event.clientX,clientY:geometry.centerY}:event,geometry));}
  apply(value){this.current=value;this.render();this.onChange(this.value);}
  render(){
    const rect=this.element.getBoundingClientRect(),geometry=this.geometry();
    this.knob.style.left=this.current.x?`${50+100*this.current.x*geometry.radius/Math.max(1,rect.width)}%`:'50%';
    this.knob.style.top=this.current.y?`${50-100*this.current.y*geometry.radius/Math.max(1,rect.height)}%`:'50%';
    this.element.style.setProperty?.('--joystick-travel',`${geometry.radius}px`);
    this.element.classList.toggle('is-active',this.pointer!==null||this.keys.size>0);
  }
  reset({notify=true}={}){
    const pointer=this.pointer;this.pointer=null;this.keys.clear();this.current=centered();
    // Clear ownership before release: lostpointercapture can fire synchronously.
    if(pointer!==null&&this.element.hasPointerCapture?.(pointer))try{this.element.releasePointerCapture(pointer);}catch{}
    this.render();if(notify)this.onChange(this.value);
  }
}
