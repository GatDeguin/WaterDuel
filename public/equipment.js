/** Workshop equipment shared by the simulation, renderer and preparation screen. */
const catalogue=items=>Object.freeze(Object.fromEntries(items.map(item=>{
  if(item.strikePoints)item.strikePoints=Object.freeze(item.strikePoints.map(point=>Object.freeze(point)));
  if(item.profile){
    const freezeProfile=points=>Object.freeze(points.map(point=>Object.freeze(point)));
    item.profile=freezeProfile(item.profile);
    item.planks=Object.freeze((item.planks??[]).map(plank=>Object.freeze(plank)));
    // Keep slats as a union: their convex hull would fill invisible corners.
    item.contactProfiles=Object.freeze([item.profile,...item.planks.map(({x,width,height})=>freezeProfile([
      [x-width/2,-height/2],[x+width/2,-height/2],[x+width/2,height/2],[x-width/2,height/2]
    ]))]);
  }
  return [item.id,Object.freeze(item)];
})));

export const WEAPONS=catalogue([
  {id:'sword',label:'Espada',title:'Estoque del taller',description:'Alcance y recuperación equilibrados.',
    lore:'Hoja fina de acero, cazoleta de latón y cuero: la herramienta clásica de los duelos del taller.',
    length:1.02,reach:1.44,lungeReach:.32,extension:.10,cooldown:.50,lungeDecay:7.8,swing:0,mass:.16,twoHanded:false,gripOffset:0},
  {id:'spear',label:'Lanza',title:'Aguja de presión',description:'Más alcance; necesita tiempo para recuperar la punta.',
    lore:'Una aguja de acero sobre un asta de madera, ajustada con abrazaderas de latón para buscar el globo a distancia.',
    length:1.35,reach:1.69,lungeReach:.26,extension:.08,cooldown:.72,lungeDecay:7.2,swing:0,mass:.22,twoHanded:false,gripOffset:0},
  {id:'axe',label:'Hacha',title:'Hacha del carpintero',description:'Más corta y pesada, con recuperación pausada.',
    lore:'La herramienta de bancada se vuelve arma ceremonial: madera, filo de acero y remaches del propio taller.',
    length:.92,reach:1.32,lungeReach:.30,extension:.10,cooldown:.66,lungeDecay:6.8,swing:.22,mass:.28,twoHanded:false,gripOffset:0,
    shaftWidth:.07,headLength:.36,headWidth:.4536,headAcross:.0756,
    strikePoints:[{along:0,across:0},{along:-.0072,across:.1512},{along:-.0792,across:.3024},{along:-.2124,across:.2862},{along:-.3456,across:.27}]},
  {id:'maul',label:'Mazo a dos manos',title:'Mazo de bancada',description:'Gran masa; ocupa ambas manos y recupera lentamente.',
    lore:'Un bloque de madera ceñido en latón, inspirado en la maquinaria del Maestro Hidráulico. Exige las dos manos.',
    length:1.08,reach:1.48,lungeReach:.30,extension:.10,cooldown:.95,lungeDecay:5.8,swing:.28,mass:.48,twoHanded:true,gripOffset:.22,
    shaftWidth:.10,headLength:.355,headWidth:.565,headAcross:0,
    strikePoints:[{along:0,across:-.2625},{along:0,across:-.13125},{along:0,across:0},{along:0,across:.13125},{along:0,across:.2625}]}
]);

export const DEFENSES=catalogue([
  {id:'short',label:'Escudo corto',title:'Broquel de latón',description:'Guardia compacta, de consumo moderado.',
    lore:'Un disco de acero y latón que gira con el brazo articulado, como en los primeros duelos del taller.',
    kind:'shield',radiusX:.23,radiusY:.23,guardRadiusX:.30,guardRadiusY:.30,length:0,guardDrain:.28,regeneration:.24,blockCost:.30,canGuard:true,guardDepthMin:.035,guardDepthMax:.125},
  {id:'long',label:'Escudo largo',title:'Escudo de duelas',description:'Cubre más altura y consume más guardia.',
    lore:'Duelas de madera con borde de latón y emblema textil: una defensa de taller alta y estrecha.',
    kind:'shield',radiusX:.22,radiusY:.36,guardRadiusX:.27,guardRadiusY:.46,length:0,guardDrain:.37,regeneration:.21,blockCost:.24,canGuard:true,guardDepthMin:.02807524,guardDepthMax:.107,
    profile:[[0,1],[-.82,.68],[-1,.30],[-.86,-.48],[0,-1],[.86,-.48],[1,.30],[.82,.68]],
    planks:[-.68,-.34,0,.34,.68].map(x=>({x,width:.25,height:1.72-.55*Math.abs(x)}))},
  {id:'none',label:'Sin escudo',title:'Mano libre',description:'Sin parada secundaria; deja libre el brazo.',
    lore:'La marioneta confía en la distancia y en su brazo armado. El mazo reserva esta mano para su empuñadura.',
    kind:'none',radiusX:0,radiusY:0,guardRadiusX:0,guardRadiusY:0,length:0,guardDrain:0,regeneration:.24,blockCost:0,canGuard:false},
  {id:'knife',label:'Cuchillo',title:'Daga de parada',description:'Parada precisa con la hoja de la mano secundaria.',
    lore:'Una hoja corta de acero con guarda de latón: desvía la punta rival sin reemplazar el arma principal.',
    kind:'knife',radiusX:0,radiusY:0,guardRadiusX:0,guardRadiusY:0,length:.42,guardDrain:.18,regeneration:.28,blockCost:.42,canGuard:true}
]);

const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
export function normalizeLoadout(value={}){
  const weapon=own(WEAPONS,value?.weapon)?value.weapon:'sword';
  const defense=WEAPONS[weapon].twoHanded?'none':own(DEFENSES,value?.defense)?value.defense:'short';
  return {weapon,defense};
}
export function getWeapon(value){return WEAPONS[normalizeLoadout(typeof value==='string'?{weapon:value}:value?.equipment??value).weapon];}
export function getDefense(value){return DEFENSES[normalizeLoadout(typeof value==='string'?{defense:value}:value?.equipment??value).defense];}
