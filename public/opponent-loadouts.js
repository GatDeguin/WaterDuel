/** Bounded opponent choices. Sampling happens when an encounter is prepared,
 * never while rendering, stepping physics or inspecting a replay. */
import {normalizeLoadout} from './equipment.js';

const PALETTES=Object.freeze({
  mint:{balloon:0x21b79b,liquid:0x60dacc,dark:0x106a62,mist:0xb3ffff,drop:0x91eae2,ring:0x6acfd0},
  amber:{balloon:0xed8a37,liquid:0xf5c084,dark:0x9f4f23,mist:0xffdcb2,drop:0xf7c692,ring:0xe5b17c},
  cobalt:{balloon:0x397bd9,liquid:0x91baf0,dark:0x23477b,mist:0xd5e6ff,drop:0xb0cff4,ring:0x779bcf},
  violet:{balloon:0x9265cb,liquid:0xc5abe7,dark:0x553575,mist:0xeadfff,drop:0xd0bcf0,ring:0xa488c6},
  crimson:{balloon:0xc94d50,liquid:0xe99d9f,dark:0x792b32,mist:0xffdadd,drop:0xf1b7bb,ring:0xca858d},
  gold:{balloon:0xd3b13b,liquid:0xe7d48e,dark:0x80701e,mist:0xfff3c7,drop:0xf2dfab,ring:0xd1bb79},
  rose:{balloon:0xd16f9c,liquid:0xe7b0c9,dark:0x803f62,mist:0xffe1f1,drop:0xf2c6de,ring:0xca96b0},
  coral:{balloon:0xdd7959,liquid:0xecb59b,dark:0x88452f,mist:0xffe5d2,drop:0xf5c9ae,ring:0xd5a185}
});
for(const palette of Object.values(PALETTES))Object.freeze(palette);
export const BALLOON_COLORS=Object.freeze(Object.keys(PALETTES));
const OPPONENT_COLORS=Object.freeze(BALLOON_COLORS.filter(color=>color!=='mint'));
const RANDOM_WEAPONS=Object.freeze(['sword','spear','axe','maul']);
const RANDOM_DEFENSES=Object.freeze(['short','long','none','knife']);

export function normalizeBalloonColor(value,slot=2){return Object.hasOwn(PALETTES,value)?value:slot===1?'mint':'amber';}
export function balloonPalette(fighter){return PALETTES[normalizeBalloonColor(fighter?.balloonColor,fighter?.slot)];}

/** A seed makes the selection sequence repeatable without touching engine RNG. */
export function seededOpponentRandom(seed){
  if(!Number.isSafeInteger(seed))throw new TypeError('La semilla del rival debe ser un entero seguro.');
  let state=seed>>>0;
  return ()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
export function newOpponentSeed(){
  if(globalThis.crypto?.getRandomValues)return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return Date.now()>>>0;
}
function pick(values,random){
  const value=random();
  if(!Number.isFinite(value)||value<0||value>=1)throw new RangeError('El sorteo del rival debe producir valores entre 0 y 1.');
  return values[Math.floor(value*values.length)];
}
export function randomOpponent(random){
  const weapon=pick(RANDOM_WEAPONS,random),defense=pick(RANDOM_DEFENSES,random),opponentColor=pick(OPPONENT_COLORS,random);
  return {opponentLoadout:normalizeLoadout({weapon,defense}),opponentColor,opponentName:'Rival del taller'};
}
