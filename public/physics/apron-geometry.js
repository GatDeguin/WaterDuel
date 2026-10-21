// Measured from the delivered v2 GLBs. Units are canonical metres, +Y up,
// +Z front, origin at the authored hip; the boss's authored 1.15 scale is removed.
// Keep the solver independent from rendering, asset fetches and GPU resources.
const corners=bounds=>Array.from({length:8},(_,i)=>Object.freeze([0,1,2].map(a=>bounds[(i>>a)&1?'max':'min'][a])));
function geometry(value){
  const bounds=Object.freeze({min:Object.freeze(value.bounds.min),max:Object.freeze(value.bounds.max)});
  return Object.freeze({...value,space:'source-world-relative-hip-normalized',
    pivot:Object.freeze(value.pivot),sourceHip:Object.freeze(value.sourceHip),sourceTorsoFrame:Object.freeze(value.sourceTorsoFrame),bounds,corners:Object.freeze(corners(bounds))});
}

export const APRON_GEOMETRY=Object.freeze({
  normal:geometry({
    sourceAsset:'characters/water-mannequin/v2/water-mannequin.glb',
    sourceSha256:'3b30bc03c5ed802c525b53913ad85c7fc949f8ab6ed6c30d689e8f79af60317f',
    sourceHip:[0,.9800000786781311,0],
    sourceTorsoFrame:[.54222072660923,-.0921773910522461,-8.146023966482119e-9,0,.050278566777706146,.7057566046714783,-3.152512639825744e-9,0,1.5593953870962656e-8,3.3559317378242254e-9,1,0,0,0,0,1],
    pivot:[0,.1304795742034912,.15799114108085632],
    bounds:{min:[-.09513328224420547,-.20000016689300537,.13899999856948853],max:[.10000000149011612,.1304795742034912,.17698228359222412]}
  }),
  boss:geometry({
    sourceAsset:'characters/water-mannequin/v2/water-mannequin-boss.glb',
    sourceSha256:'494cc22f9ea56d6e6cb4c87b311bb9b9fb1f1a70a3e6d409ccf56921cb62c955',
    sourceHip:[0,.9800000786781311,0],
    sourceTorsoFrame:[.5422208087514626,-.09217749446874426,-2.1733841721948315e-9,0,.050278539109995496,.7057564654553465,-8.614944483779602e-11,0,3.980840706281353e-9,-1.6153080543170174e-10,1,0,0,0,0,1],
    pivot:[0,.14299993891883814,.169],
    bounds:{min:[-.14149777229872612,-.49855688212039295,.15953323073371117],max:[.14149777229872612,.14323690625335833,.2093359433733689]}
  })
});
