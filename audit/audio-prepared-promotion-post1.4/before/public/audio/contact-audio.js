const clamp=(value,min,max,fallback=0)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
const empty=()=>({key:'',cooldown:0,cues:[]});
const cue=(name,x,intensity,extra={})=>({name,x:clamp(x,-4,4),intensity:clamp(intensity,0,1),priority:2,...extra});
const metal=value=>['metal','steel','brass'].includes(value);
const material=value=>({wood_metal_mixed:'composite',metal_mixed:'metal'}[value]??value);

// Reduced simulation units. Impulse is preferred; force is an impulse/dt
// derivative and only a fallback. This is sound calibration, not a SI claim.
function strength(data,{legacy=false}={}){
  const fields=['impulse','closingSpeed','peakClosingSpeed','force','slideSpeed'];
  if(fields.some(field=>data[field]!==undefined&&!Number.isFinite(data[field])))return null;
  const measured=fields.some(field=>data[field]!==undefined);
  if(!measured)return legacy?.55:null;
  const load=data.impulse??(data.force===undefined?0:data.force/120);
  const speed=data.peakClosingSpeed??data.closingSpeed??0,slide=Math.max(0,data.slideSpeed??0);
  if(load<=1e-5||speed<0||speed<=.025&&slide<=.08)return null;
  const motion=Math.max(speed,slide);
  return clamp(Math.sqrt(clamp(motion/4,0,1)*.65+clamp(load/.25,0,1)*.35),.08,1);
}

/** Pure translation of accepted engine contacts to material layers. No timers,
 * physics, score changes or fabricated floor impacts. The mixer owns rate gates.
 */
export function contactAudio(name,input={},game=null){
  const data=input&&typeof input==='object'?input:{};
  const fighter=Array.isArray(game?.fighters)?game.fighters.find(f=>f?.slot===(data.defender??data.loser??data.slot)):null;
  const x=clamp(data.at?.x??fighter?.pose?.head?.x,-4,4);
  if(name==='burst'){
    const impacts=data.draw&&Array.isArray(data.impacts)?data.impacts.slice(0,2):[{
      x,relativeSpeed:data.relativeSpeed,slot:data.loser,
    }];
    const cues=[];
    for(const impact of impacts){
      const at=clamp(impact?.x,-4,4,x),hit=clamp((impact?.relativeSpeed??2)/4,.28,1,.5);
      cues.push(cue('puncture',at,hit,{priority:3}),cue('tear',at,hit*.85,{priority:3,delay:.018}),
        cue('water-burst',at,.35+hit*.55,{priority:3,delay:.04,rate:1.04-hit*.1}));
    }
    return {key:'burst:'+impacts.map(impact=>clamp(impact?.slot,0,2)).join('/'),cooldown:.25,cues};
  }
  if(name==='material-contact'){
    const surface=material(data.material);
    if(!['wood','latex','composite','unknown','leather'].includes(surface))return empty();
    const hit=strength(data);if(hit===null)return empty();
    const bodies=[data.bodyA,data.bodyB].map(value=>typeof value==='string'?value.slice(0,35):'body').sort();
    return {key:'material:'+surface+':'+bodies.join('/'),cooldown:.095,
      cues:[cue(surface==='wood'?'wood-contact':surface==='latex'?'latex-rub':'joint',x,surface==='leather'?.08+hit*.22:.12+hit*.72,{rate:1.08-hit*.18})]};
  }
  if(name!=='clang')return empty();
  const hit=strength(data,{legacy:!data.weaponBind});if(hit===null)return empty();
  const explicit=material(data.material??data.defenseMaterial),defense=fighter?.equipment?.defense;
  const mixedWeapon=data.weaponBind&&Array.isArray(game?.fighters)&&game.fighters.some(f=>['spear','axe','maul'].includes(f?.equipment?.weapon));
  const surface=explicit??(mixedWeapon?'composite':defense==='long'?'wood':'steel');
  if(!['wood','latex','composite','unknown','leather'].includes(surface)&&!metal(surface))return empty();
  if(surface==='leather')return {key:'clang:leather',cooldown:.1,cues:[cue('joint',x,.08+hit*.22)]};
  if(['composite','unknown'].includes(surface))return {key:'clang:'+surface,cooldown:.1,cues:[cue('joint',x,.15+hit*.35)]};
  if(surface==='latex')return {key:'clang:latex',cooldown:.1,cues:[cue('latex-rub',x,.2+hit*.5)]};
  const shield=!!data.defender&&defense!=='knife';
  const cues=[];
  if((data.peakClosingSpeed??data.closingSpeed??1)>.025){
    const main=surface==='wood'?(shield?'shield-wood':'wood-contact'):shield?'shield-metal':'blade-beat';
    cues.push(cue(main,x,.22+hit*.65,{rate:1.06-hit*.14}));
    if(metal(surface))cues.push(cue('ring',x,.08+hit*.25,{delay:.012,rate:1.1-hit*.2}));
  }
  // Friction requires actual tangential speed, never a guessed bind timer.
  if(metal(surface)&&(data.slideSpeed??0)>.08)
    cues.push(cue('blade-slide',x,clamp(.12+data.slideSpeed*.12,.12,.6),{rate:clamp(.9+data.slideSpeed*.05,.9,1.2)}));
  if(!cues.length)return empty();
  return {key:data.weaponBind?'steel-bind':'defense:'+clamp(data.defender,0,2)+':'+surface,cooldown:.09,cues};
}
