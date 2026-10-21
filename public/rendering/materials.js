// Linear-light material parameters shared by the shader and inspection tools.
// Metal colors come from the object palette; dielectric F0 comes from its IOR.
export const MATERIALS=Object.freeze([
  {name:'Roble aceitado',roughness:.36,metallic:0,ior:1.48,coat:.26},
  {name:'Latón mecanizado',roughness:.28,metallic:1,ior:1.5,coat:0},
  {name:'Membrana de látex',roughness:.13,metallic:0,ior:1.50,coat:0},
  {name:'Gota de agua',roughness:.045,metallic:0,ior:1.333,coat:0},
  {name:'Lino tejido',roughness:.91,metallic:0,ior:1.45,coat:0},
  {name:'Sombra de contacto',roughness:1,metallic:0,ior:1.5,coat:0},
  {name:'Emisión',roughness:1,metallic:0,ior:1.5,coat:0},
  {name:'Cuero curtido',roughness:.69,metallic:0,ior:1.47,coat:.04},
  {name:'Revoco mineral',roughness:.93,metallic:0,ior:1.5,coat:0},
  {name:'Agua liberada',roughness:.045,metallic:0,ior:1.333,coat:0},
  {name:'Látex desgarrado',roughness:.13,metallic:0,ior:1.50,coat:0},
  {name:'Vidrio de ventana',roughness:.07,metallic:0,ior:1.52,coat:0},
  {name:'Tablas barnizadas',roughness:.35,metallic:0,ior:1.48,coat:.72},
  {name:'Agua contenida',roughness:.045,metallic:0,ior:1.333,coat:0},
  {name:'Superficie libre',roughness:.027,metallic:0,ior:1.333,coat:0},
  {name:'Menisco',roughness:.025,metallic:0,ior:1.333,coat:0},
  {name:'Acero pulido',roughness:.17,metallic:1,ior:1.5,coat:0},
  {name:'Acero pavonado',roughness:.39,metallic:1,ior:1.5,coat:0},
  {name:'Bronce patinado',roughness:.48,metallic:.86,ior:1.5,coat:0},
  {name:'Película húmeda y ondas',roughness:.045,metallic:0,ior:1.333,coat:0},
].map(Object.freeze));
export function dielectricF0(ior){return ((ior-1)/(ior+1))**2;}
export function beerLambert(absorption,distance){return absorption.map(a=>Math.exp(-Math.max(0,a)*Math.max(0,distance)));}
const scalar=n=>Number(n).toFixed(5);
export const MATERIAL_GLSL=`
const int MATERIAL_COUNT=${MATERIALS.length};
const vec4 MATERIAL_PARAMS[${MATERIALS.length}]=vec4[](
${MATERIALS.map(m=>`vec4(${[m.roughness,m.metallic,m.ior,m.coat].map(scalar).join(',')})`).join(',\n')});
`;
