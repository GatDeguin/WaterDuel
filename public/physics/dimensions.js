// Shared world-space dimensions for visible surfaces and gameplay proxies.
export const BALLOON_RADII=Object.freeze({x:.422,y:.506,z:.397});
export const TABLE_TOP=.3245;
// The liquid and its free surface share one volume/coordinate contract.
export const WATER_RADII=Object.freeze({x:.392,y:.456,z:.365});
export const WATER_FILL_FRACTION=.65;
// Closed 8-stack / 11-slice droplet template volume (unit circumradius).
// Correct its 8.95% tessellation deficit rather than shrinking wet particles.
export const WATER_DROP_UNIT_VOLUME=3.8138019448576546;
export const waterDropRadius=volume=>Math.cbrt(volume/WATER_DROP_UNIT_VOLUME);
// Fraction below y=h in a unit sphere: (2+3h-h^3)/4. This is its inverse.
export const capHeightForFraction=fraction=>2*Math.sin(Math.asin(Math.max(-1,Math.min(1,2*fraction-1)))/3);
export function containedWaterFrame(slosh=0,time=0,fraction=WATER_FILL_FRACTION){
  const tiltZ=Math.max(-.35,Math.min(.35,slosh*1.25));
  const tiltX=Math.sin(time*3.5)*.025*Math.min(1,Math.abs(slosh)*3+.12);
  const cx=Math.cos(tiltX),sx=Math.sin(tiltX),cz=Math.cos(tiltZ),sz=Math.sin(tiltZ);
  // Row-major Rz*Rx in the unit sphere. Rotating here, before ellipsoid scale,
  // preserves both the enclosing ellipsoid and the submerged cap volume.
  return {height:capHeightForFraction(fraction),fraction,rotation:[cz,-sz*cx,sz*sx,sz,cz*cx,-cz*sx,0,sx,cx]};
}
