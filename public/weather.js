const profile=({label,sky,windowTint,windowGain,glassTint,glassAlpha,glassGlow,precipitation=null,disc=null})=>Object.freeze({
  label,sky:Object.freeze(sky),windowTint:Object.freeze(windowTint),windowGain,
  glassTint:Object.freeze(glassTint),glassAlpha,glassGlow,precipitation,
  disc:disc&&Object.freeze({...disc,position:Object.freeze(disc.position)})
});

export const WEATHER_PROFILES=Object.freeze({
  sun:profile({label:'Soleado',sky:[.24,.48,.76],windowTint:[1.07,1.02,.88],windowGain:1.15,
    glassTint:[1,.99,.94],glassAlpha:.78,glassGlow:.88,
    disc:{position:[-5.7,8.5,-18.45],radius:.52,color:0xffe9ac}}),
  sunset:profile({label:'Atardecer',sky:[.73,.24,.095],windowTint:[1.36,.79,.47],windowGain:.95,
    glassTint:[1,.78,.61],glassAlpha:.73,glassGlow:.76,
    disc:{position:[5.7,7.45,-18.45],radius:.61,color:0xffb15e}}),
  night:profile({label:'Noche',sky:[.013,.027,.072],windowTint:[.57,.73,1.16],windowGain:.45,
    glassTint:[.62,.78,1],glassAlpha:.7,glassGlow:.68}),
  rain:profile({label:'Lluvia',sky:[.13,.2,.27],windowTint:[.76,.89,1.05],windowGain:.69,
    glassTint:[.76,.88,.98],glassAlpha:.63,glassGlow:.65,precipitation:'rain'}),
  snow:profile({label:'Nieve',sky:[.33,.42,.51],windowTint:[.91,.99,1.09],windowGain:.89,
    glassTint:[.9,.97,1],glassAlpha:.59,glassGlow:.77,precipitation:'snow'}),
  'full-moon':profile({label:'Luna llena',sky:[.026,.055,.135],windowTint:[.62,.83,1.26],windowGain:.63,
    glassTint:[.7,.83,1],glassAlpha:.65,glassGlow:.73,
    disc:{position:[-5.65,8.25,-18.45],radius:.63,color:0xd6e7ff}}),
  storm:profile({label:'Tormenta',sky:[.039,.057,.105],windowTint:[.65,.75,1.07],windowGain:.46,
    glassTint:[.64,.75,.95],glassAlpha:.57,glassGlow:.61,precipitation:'rain'})
});
export const WEATHER_TYPES=Object.freeze(Object.keys(WEATHER_PROFILES));

const campaign={normal:WEATHER_TYPES,advanced:['night','snow','sun','sunset','full-moon','rain','storm']};
export function campaignWeather(stage,tier='normal'){
  const circuit=tier==='advanced'?campaign.advanced:campaign.normal;
  const index=Number.isInteger(stage)?Math.max(0,Math.min(circuit.length-1,stage)):0;
  return circuit[index];
}

const STORM_CYCLE=32;
const STRIKES=[
  {at:2.8,delay:.85,x:-5.6,strength:.84},
  {at:8.9,delay:1.2,x:5.35,strength:1},
  {at:16.3,delay:.72,x:-4.55,strength:.9},
  {at:25.2,delay:1.08,x:5.9,strength:.78}
];
function lightningPulse(age,strength){
  if(age<0||age>.58)return 0;
  const peak=Math.exp(-age*17);
  const returnStroke=age>=.15?.42*Math.exp(-(age-.15)*25):0;
  return strength*Math.max(peak,returnStroke);
}

/** All times are encounter-relative. Replaying or seeking samples the same
 * weather. The latest scheduled thunder time is a stable playback identity. */
export function sampleWeather(kind,elapsed=0){
  kind=typeof kind==='string'&&Object.hasOwn(WEATHER_PROFILES,kind)?kind:'sun';
  elapsed=Number.isFinite(elapsed)?Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,elapsed)):0;
  let flash=0,lightningX=0,thunderAt=null,thunderX=0,thunderStrength=0;
  if(kind==='storm'){
    const cycleStart=Math.floor(elapsed/STORM_CYCLE)*STORM_CYCLE;
    if(cycleStart>0){
      const previous=STRIKES.at(-1);
      thunderAt=cycleStart-STORM_CYCLE+previous.at+previous.delay;
      thunderX=previous.x;thunderStrength=previous.strength;
    }
    for(const strike of STRIKES){
      const at=cycleStart+strike.at,pulse=lightningPulse(elapsed-at,strike.strength);
      if(pulse>flash){flash=pulse;lightningX=strike.x;}
      const audibleAt=at+strike.delay;
      if(audibleAt<=elapsed){thunderAt=audibleAt;thunderX=strike.x;thunderStrength=strike.strength;}
    }
  }
  return {kind,profile:WEATHER_PROFILES[kind],elapsed,flash,lightningX,thunderAt,thunderX,thunderStrength};
}
