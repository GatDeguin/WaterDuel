// Three prepared stems keep one musical clock. Only gain targets change here;
// no note, oscillator, sample buffer or contact event is fabricated.
const clamp=value=>Math.max(0,Math.min(1,value));
export function musicStemLevels(game,base){
  if(!Array.isArray(base)||base.length!==3)return [0,0,0];
  const levels=base.map(value=>Number.isFinite(value)?clamp(value):0);
  if(game?.phase!=='fight')return levels;
  const a=game.fighters?.[0]?.pose?.head,b=game.fighters?.[1]?.pose?.head;
  let pressure=0;
  if([a?.x,a?.y,a?.z??0,b?.x,b?.y,b?.z??0].every(Number.isFinite))pressure=clamp((4-Math.hypot(a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0)))/2.5);
  if(game.suddenDeath===true)pressure=clamp(pressure+.15);
  return [levels[0]*(.88+.16*pressure),levels[1]*(.8+.25*pressure),levels[2]*(.94+.1*pressure)].map(clamp);
}
