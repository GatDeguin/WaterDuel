// Stable bit positions are also the persisted/wire format. Append IDs rather
// than reordering this catalogue when adding a future effect.
export const AUDIO_EFFECTS=Object.freeze([
  {id:'wood',label:'Crujidos de madera',group:'Cuerpo y pasos'},
  {id:'joint',label:'Articulaciones',group:'Cuerpo y pasos'},
  {id:'shield-wood',label:'Golpes en escudo de madera',group:'Armas y escudos'},
  {id:'footstep-dry',label:'Pasos sobre mesa seca',group:'Cuerpo y pasos'},
  {id:'footstep-wet',label:'Pasos sobre mesa mojada',group:'Cuerpo y pasos'},
  {id:'metal',label:'Golpes metálicos',group:'Armas y escudos'},
  {id:'ring',label:'Resonancia del metal',group:'Armas y escudos'},
  {id:'blade-beat',label:'Choque de hojas',group:'Armas y escudos'},
  {id:'blade-slide',label:'Fricción de hojas',group:'Armas y escudos'},
  {id:'shield-metal',label:'Golpes en escudo metálico',group:'Armas y escudos'},
  {id:'tension',label:'Tensión del globo',group:'Látex'},
  {id:'puncture',label:'Pinchazo',group:'Látex'},
  {id:'tear',label:'Desgarro del látex',group:'Látex'},
  {id:'latex-rub',label:'Roce del globo',group:'Látex'},
  {id:'slosh',label:'Agua dentro del globo',group:'Agua'},
  {id:'jet',label:'Chorro de agua',group:'Agua'},
  {id:'drip',label:'Gotas sobre la mesa',group:'Agua'},
  {id:'splash',label:'Salpicaduras',group:'Agua'},
  {id:'water-burst',label:'Explosión de agua',group:'Agua'},
  {id:'whoosh',label:'Barrido de aire',group:'Armas y escudos'},
  {id:'blade-swish',label:'Movimiento del arma',group:'Armas y escudos'},
  {id:'countdown',label:'Cuenta regresiva',group:'Avisos'},
  {id:'go',label:'Inicio del combate',group:'Avisos'},
  {id:'victory',label:'Victoria',group:'Avisos'},
  {id:'defeat',label:'Derrota',group:'Avisos'},
  {id:'draw',label:'Empate',group:'Avisos'},
  {id:'ui',label:'Interfaz',group:'Avisos'},
  {id:'thunder',label:'Truenos',group:'Clima'},
].map(Object.freeze));
export const ALL_EFFECTS_MASK=2**AUDIO_EFFECTS.length-1;
const bits=new Map(AUDIO_EFFECTS.map((effect,index)=>[effect.id,2**index]));
export const validEffectMask=value=>Number.isInteger(value)&&value>=0&&value<=ALL_EFFECTS_MASK;
export function effectEnabled(mask,id){const bit=bits.get(id);return validEffectMask(mask)&&bit!==undefined&&(mask&bit)!==0;}
export function setEffectEnabled(mask,id,enabled){
  const bit=bits.get(id);
  if(!validEffectMask(mask)||bit===undefined||typeof enabled!=='boolean')throw new RangeError('Efecto o máscara de audio inválidos.');
  return enabled?mask|bit:mask&~bit;
}
