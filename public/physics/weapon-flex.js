/** One bounded bending mode for a slender wet steel blade. Arc length stays
 * fixed. Only measured dissipated contact work can charge the mode; its free
 * implicit spring step is passive, including clipping at the elastic stop. */
export class WeaponFlex{
  constructor(weapon='sword'){
    this.weapon=weapon;this.mass=weapon==='sword'?.018:.026;this.stiffness=weapon==='sword'?82:160;
    this.damping=2*Math.sqrt(this.mass*this.stiffness)*.32;
    this.maximum=weapon==='sword'?.035:weapon==='spear'?.022:0;
    this.offset=0;this.previousOffset=0;this.velocity=0;
  }
  energy(){return .5*(this.mass*this.velocity*this.velocity+this.stiffness*this.offset*this.offset);}
  excite(direction,budget){
    if(!this.maximum||!Number.isFinite(direction)||!Number.isFinite(budget)||budget<=0||direction===0)return 0;
    const before=this.energy(),kinetic=.5*this.mass*this.velocity*this.velocity;
    const signed=Math.sign(direction),desired=signed*Math.sqrt(2*(kinetic+Math.min(budget,.04))/this.mass);
    // A reversing load first unloads the velocity already present. It cannot
    // turn a small impact into a larger stored mode by resetting its sign.
    this.velocity=this.velocity*signed<0?signed*Math.min(Math.abs(desired),Math.sqrt(2*budget/this.mass)):desired;
    return Math.max(0,this.energy()-before);
  }
  advance(dt,{preservePrevious=false}={}){
    if(!Number.isFinite(dt)||dt<=0||dt>.04)return;
    if(!preservePrevious)this.previousOffset=this.offset;
    if(!this.maximum){this.offset=this.velocity=0;return;}
    this.velocity=(this.velocity-dt*this.stiffness/this.mass*this.offset)/(1+dt*this.damping/this.mass+dt*dt*this.stiffness/this.mass);
    this.offset+=dt*this.velocity;
    if(Math.abs(this.offset)>this.maximum){this.offset=Math.sign(this.offset)*this.maximum;if(this.offset*this.velocity>0)this.velocity=0;}
    if(this.energy()<1e-12)this.offset=this.velocity=0;
  }
}
/** Constant-curvature beam, local X forward/Y transverse; s is arc fraction. */
export function bladeLocalAt(length,bend,s){
  s=Math.max(0,Math.min(1,s));
  if(bend===0||s===0)return {x:length*s,y:0};
  const angle=2*bend/length,theta=angle*s;
  if(Math.abs(theta)<1e-5)return {x:length*s*(1-theta*theta/6),y:length*s*(theta/2-theta**3/24)};
  return {x:length*Math.sin(theta)/angle,y:length*(1-Math.cos(theta))/angle};
}
