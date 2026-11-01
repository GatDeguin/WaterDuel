import {createHash} from 'node:crypto';

// The user-authorized 1.10 axe correction changes the asymmetric head in J2.
// Historical optimization oracles must compare that same equipment geometry.
// Their stored bytes remain pinned and unchanged: only this reversible layer is
// applied to the imported reference, never to assertions or solver arithmetic.
export const AXE_REFERENCE_PINS=Object.freeze({
  gpu:'0c091be72f17f5912e17927461518e613dcb6e03f4f240f2842fefd0ddd6bcdc',
  passive:'c56c5ebaeb9aa28c7ec55540bb4ad4b836fb158539786f44153f7c5264f2d0bd',
  goal:'11fd0cc7fb655b404b4e911f8adea509ef9d37a742c169f13dcd9eb496398d60'
});
const oldImport="import {normalizeLoadout,getWeapon,getDefense} from '../equipment.js';";
const newImport="import {normalizeLoadout,getWeapon,getDefense,equipmentAcrossSign} from '../equipment.js';";
const oldCenter='      const center={x:p.tip.x+uy*weapon.headAcross,y:p.tip.y-ux*weapon.headAcross};';
const hash=value=>createHash('sha256').update(value).digest('hex');
function replaceExact(source,before,after,count){
  if(source.split(before).length-1!==count)throw Error('Axe reference hunk count changed');
  return source.split(before).join(after);
}
export function applyAxeFacingReference(source,id){
  if(!Object.hasOwn(AXE_REFERENCE_PINS,id)||hash(source)!==AXE_REFERENCE_PINS[id])throw Error('Axe reference original SHA changed');
  const newline=source.includes('\r\n')?'\r\n':'\n';
  const newCenter='      const across=weapon.headAcross*equipmentAcrossSign(weapon.id,this.dir);'+newline+'      const center={x:p.tip.x+uy*across,y:p.tip.y-ux*across};';
  const patched=replaceExact(replaceExact(source,oldImport,newImport,1),oldCenter,newCenter,2);
  const reversed=replaceExact(replaceExact(patched,newCenter,oldCenter,2),newImport,oldImport,1);
  if(reversed!==source||hash(reversed)!==AXE_REFERENCE_PINS[id])throw Error('Axe reference layer is not byte-reversible');
  return patched;
}
