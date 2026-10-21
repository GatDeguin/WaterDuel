// Reduced optical model in scene units. Not calibrated SI water/latex data.
export const LATEX_REST_THICKNESS=.0045;
export function latexThickness(restArea,currentArea){return LATEX_REST_THICKNESS*Math.max(0,restArea)/Math.max(currentArea,1e-12);}
export function ggxDistribution(nh,roughness){const a2=Math.max(roughness,.001)**4,d=(nh*a2-nh)*nh+1;return a2/(Math.PI*Math.max(d*d,1e-20));}
export function waterOptics(color,distance){
  const tint=color.map(x=>Math.max(0,Math.min(1,x))**2.2);
  const absorption=tint.map(x=>.018+(1-x)*.85),scattering=tint.map(x=>.0015+x*.002);
  return {absorption,scattering,transmittance:absorption.map((a,i)=>Math.exp(-(a+scattering[i])*Math.max(0,distance)))};
}
// Pigment scattering is a reduced homogeneous thin-film model. Coefficients
// are artistic scene-unit values, not a measurement of commercial latex.
export function latexOptics(color,distance){
  const tint=color.map(x=>Math.max(0,Math.min(1,x))**2.2);
  const absorption=tint.map(x=>(1-x)*140),scattering=tint.map(x=>.5+x*18);
  return {absorption,scattering,transmittance:absorption.map((a,i)=>Math.exp(-(a+scattering[i])*Math.max(0,distance)))};
}
export function scatterRadiance(medium,incident){return medium.transmittance.map((t,i)=>(1-t)*medium.scattering[i]/Math.max(medium.absorption[i]+medium.scattering[i],.001)*Math.max(0,incident[i]));}
export const OPTICS_GLSL=`
float ggx(float nh,float r){float a2=pow(max(r,.001),4.0),d=(nh*a2-nh)*nh+1.0;return a2/(3.14159265359*max(d*d,1e-20));}
float viewDistance(float depth){return (.1*64.0)/(64.0-depth*(64.0-.1));}
vec3 waterAbsorption(vec3 tint){return vec3(.018)+(1.0-pow(clamp(tint,0.0,1.0),vec3(2.2)))*.85;}
vec3 waterScattering(vec3 tint){return vec3(.0015)+pow(clamp(tint,0.0,1.0),vec3(2.2))*.002;}
vec3 latexAbsorption(vec3 tint){return (1.0-pow(clamp(tint,0.0,1.0),vec3(2.2)))*140.0;}
vec3 latexScattering(vec3 tint){return vec3(.5)+pow(clamp(tint,0.0,1.0),vec3(2.2))*18.0;}
`;
