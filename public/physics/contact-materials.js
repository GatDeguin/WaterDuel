// Coarse exposed surfaces from docs/assets/equipment/contact-materials-v1.json.
// These labels describe the frozen v1 assets, not per-triangle collision data.
const entry=(reach,band,fallback,zones,headFallback)=>Object.freeze({reach,band:Object.freeze(band),fallback,
  zones:Object.freeze(zones.map(zone=>Object.freeze(zone))),headFallback});
const surfaces=Object.freeze({
  sword:entry(1.02,[.18,1.02],'steel',[[-.208,-.13,'brass'],[-.118,.108,'leather'],[.108,.20,'brass'],[.20,1.02,'steel']]),
  spear:entry(1.35,[.15,1],'wood',[[-.152,.128,'leather'],[.128,.933,'wood'],[.933,1.082,'metal_mixed'],[1.082,1.35,'steel']]),
  axe:entry(.92,[.18,.56],'wood',[[-.158,.118,'leather'],[.118,.56,'wood'],[.56,.814,'metal_mixed'],[.814,.92,'steel']],'steel'),
  maul:entry(1.08,[.18,.725],'wood',[[-.315,-.125,'leather'],[-.095,.095,'leather'],[.095,.658,'wood'],[.658,.733,'metal_mixed'],[.733,1.015,'wood_metal_mixed'],[1.015,1.08,'steel']],'wood_metal_mixed'),
  knife:entry(.42,[.09,.42],'steel',[[-.15,-.09,'brass'],[-.074,.074,'leather'],[.074,.125,'brass'],[.125,.42,'steel']])
});
const metal=new Set(['steel','brass','metal','metal_mixed']);
const secondary=new Set(['guard','defense','offWeapon','defenseTip','shield','parry','knife']);
const finitePoint=p=>p&&[p.x,p.y,p.z??0].every(Number.isFinite);

function restAlong(f,point,id,secondaryWeapon){
  const p=f?.pose,item=surfaces[id],hand=secondaryWeapon?p?.offHand:p?.mainHand,tip=secondaryWeapon?p?.defenseTip:p?.tip;
  if(!item||!finitePoint(point)||!finitePoint(hand)||!finitePoint(tip))return null;
  const dx=tip.x-hand.x,dy=tip.y-hand.y,dz=(tip.z??0)-(hand.z??0),length=Math.hypot(dx,dy,dz);
  if(length<1e-9)return null;
  const d=((point.x-hand.x)*dx+(point.y-hand.y)*dy+((point.z??0)-(hand.z??0))*dz)/length;
  const [a,b]=item.band,E=length-item.reach,stretch=1+E/(b-a);
  if(stretch<=0)return null; // Outside the monotonic/legal equipment range.
  return d<=a?d:d>=b+E?d-E:a+(d-a)/stretch;
}

export function classifyEquipmentContact(f,key,point){
  const descriptor=key&&typeof key==='object'?key:null,rawName=descriptor?.key??key,name=typeof rawName==='string'&&rawName.startsWith('weapon-flex-')?'weapon':rawName;
  const explicit=descriptor?.material??point?.material;
  if(typeof explicit==='string'&&explicit.length)return explicit;
  if(name==='main-palm'||name==='off-palm')return 'wood';
  const panel=f?.rig?.collisionPanels?.().find(p=>p.key===name);
  if(typeof panel?.material==='string'&&panel.material.length)return panel.material;
  const equipment=f?.equipment??f?.pose?.equipment??{},defense=secondary.has(name);
  const id=defense?equipment.defense:equipment.weapon;
  if(defense&&(id==='short'||id==='long'))return id==='short'?'metal_mixed':'wood';
  if(!defense&&name!=='weapon'&&name!=='weapon-head'||defense&&id!=='knife')return 'unknown';
  const item=surfaces[id];if(!item)return 'unknown';
  const fallback=name==='weapon-head'?(item.headFallback??item.fallback):item.fallback,s=restAlong(f,point,id,defense);
  if(s===null)return fallback;
  // The small maker's ring is a local exception on an otherwise wooden shaft.
  if(id==='spear'&&s>=.381&&s<=.413)return 'brass';
  for(let i=item.zones.length-1;i>=0;i--){const [lo,hi,material]=item.zones[i];if(s>=lo-1e-10&&s<=hi+1e-10)return material;}
  return fallback;
}

export function contactMaterialPair(a,b){
  if(a==='unknown'||b==='unknown'||!a||!b)return 'unknown';
  if(a==='leather'||b==='leather')return 'leather';
  if(a==='wood_metal_mixed'||b==='wood_metal_mixed'||a==='composite'||b==='composite')return 'composite';
  if(a==='wood'&&b==='wood')return 'wood';
  if(a==='wood'&&metal.has(b)||b==='wood'&&metal.has(a))return 'composite';
  return metal.has(a)&&metal.has(b)?'metal':'unknown';
}
