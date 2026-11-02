/** Bounded motor intentions from real control/load. No rendered offsets,
 * contact results, attack pulses or changes to equipment technique. */
import {getWeapon,getDefense} from '../equipment.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=(x,fallback=0)=>Number.isFinite(x)?x:fallback;
const axes=['mainX','mainY','offX','offY','lean','wrist','headX','headZ','bodyY'];
const manual=control=>control?.thrust||control?.guard||control?.attackHeld||axes.some(k=>Math.abs(finite(control?.[k]))>1e-4);
const attached=(f,body)=>f.rig?.isBodyAttached?f.rig.isBodyAttached(body):!(f.pose?.detached??[]).some(fragment=>fragment.bodies.includes(body));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};

export function characterIntent(f,context={},previous=null){
  const c=context.controller??f.controller??{},dt=clamp(finite(context.dt),0,.05),weapon=getWeapon(f),defense=getDefense(f);
  const sample={mainX:clamp(finite(c.mainX),-1,1),mainY:clamp(finite(c.mainY),-1,1),baseVX:clamp(finite(f.baseVX),-3,3)};
  const load=weapon.mass*weapon.length*weapon.length,recovery=.16+load*.8+(f.boss?.10:0);
  const result={lean:0,freeHandX:0,freeHandY:0,feint:0,balance:0,load,recovery,sample,attack:false};
  if(context.phase!=='fight'||!f.globIntact||f.rig?.passive||context.reducedMotion)return result;
  const prior=previous?.sample??sample;
  const rate=dt>0?clamp((sample.baseVX-finite(prior.baseVX))/dt,-8,8):0;
  const balance=clamp(finite(previous?.balance)*Math.exp(-dt*9)+rate*dt*.11,-.08,.08);
  const reversing=dt>0&&sample.mainX*finite(prior.mainX)<0&&Math.abs(sample.mainX-finite(prior.mainX))>.12;
  // A withdrawal/reversal can read as a feint; it never adds a forward motor
  // target or changes the stick's direction, blade path or attack state.
  const feint=Math.max(finite(previous?.feint)*Math.exp(-dt/(recovery*.5)),reversing?Math.min(1,Math.abs(sample.mainX-finite(prior.mainX))*.6):0);
  const effort=sample.mainX*.65+sample.mainY*.35;
  const crouch=clamp(finite(f.evasion?.crouch),0,1),dodge=clamp(finite(f.evasion?.feint),0,1);
  const weight=1+Math.min(.65,load*1.7)+(f.boss?.18:0);
  const automaticAuthority=1-Math.abs(clamp(finite(c.lean),-1,1));
  result.lean=clamp(.022*effort*weight-.014*feint*Math.sign(sample.mainX||1)-.012*crouch-.013*dodge,-.065,.065)*automaticAuthority||0;
  result.feint=feint;result.balance=balance;
  const free=!weapon.twoHanded&&defense.kind==='none'&&attached(f,'offForearm')&&attached(f,'offUpper')&&
    Math.abs(finite(c.offX))<=1e-4&&Math.abs(finite(c.offY))<=1e-4&&!c.guard;
  if(free){result.freeHandX=clamp(-balance-finite(f.lean)*.035,-.07,.07)||0;result.freeHandY=clamp(Math.abs(balance)*.45+dodge*.025,0,.055);}
  return result;
}

/** Post-result gesture, read-only with respect to phase/winner/score.
 * A new round or any human intention cancels it rather than completing a clip. */
export function resultIntent(f,{phase,phaseClock=0,clock=0,winner=0,reducedMotion=false}={}){
  if(!['burst','matchover'].includes(phase)||winner!==f.slot||!f.globIntact||f.rig?.passive||reducedMotion||manual(f.controller))return null;
  const age=finite(phaseClock),rise=smooth((age-.35)/.65);
  if(rise===0)return null;
  const weapon=getWeapon(f),defense=getDefense(f),free=!weapon.twoHanded&&defense.kind==='none'&&attached(f,'offForearm');
  const release=phase==='burst'?1-smooth((age-1.65)/.7):1;
  const amount=rise*release;
  // A held match-over salute settles to a static respectful pose; no unbounded
  // sine loop or wall clock creates perpetual motor work after the result.
  return {mainX:0,mainY:0,offX:free?.10*amount:0,offY:free?.32*amount:0,
    lean:free?-.025*amount:-.13*amount,wrist:0,headX:0,headZ:0,bodyY:0,
    thrust:false,attackHeld:false,guard:false};
}
