/** Read the frozen v1 GLBs and write only a derived Audio/FX material contract. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const IDS=['sword','spear','axe','maul','short','long','knife'];
const OUTPUT='docs/assets/equipment/contact-materials-v1.json';
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function multiply(a,b){
  const out=new Array(16).fill(0);
  for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)out[col*4+row]+=a[k*4+row]*b[col*4+k];
  return out;
}
function localMatrix(node){
  if(node.matrix)return node.matrix;
  const [x,y,z,w]=node.rotation??[0,0,0,1],[sx,sy,sz]=node.scale??[1,1,1],[tx,ty,tz]=node.translation??[0,0,0];
  return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*z*w)*sx,(2*x*z-2*y*w)*sx,0,
    (2*x*y-2*z*w)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*x*w)*sy,0,
    (2*x*z+2*y*w)*sz,(2*y*z-2*x*w)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1];
}
const point=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const round=v=>Number(v.toFixed(9));
function bounds(points){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of points)for(let i=0;i<3;i++){if(!Number.isFinite(p[i]))throw new Error('Nonfinite GLB position');min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  return {min:min.map(round),max:max.map(round),dimensions:max.map((v,i)=>round(v-min[i]))};
}
function readGLB(id){
  const relative=`public/assets/equipment/workshop/${id}.glb`,buffer=fs.readFileSync(path.join(ROOT,relative));
  if(buffer.readUInt32LE(0)!==0x46546c67||buffer.readUInt32LE(4)!==2||buffer.readUInt32LE(8)!==buffer.length)throw new Error(`Invalid GLB ${id}`);
  let json,bin;
  for(let offset=12;offset<buffer.length;){const size=buffer.readUInt32LE(offset),type=buffer.readUInt32LE(offset+4),chunk=buffer.subarray(offset+8,offset+8+size);if(type===0x4e4f534a)json=JSON.parse(chunk.toString('utf8'));if(type===0x004e4942)bin=chunk;offset+=size+8;}
  if(!json||!bin)throw new Error(`Incomplete GLB ${id}`);
  const parents=new Map();json.nodes.forEach((n,i)=>(n.children??[]).forEach(child=>parents.set(child,i)));
  const matrix=index=>{const own=localMatrix(json.nodes[index]);return parents.has(index)?multiply(matrix(parents.get(index)),own):own;};
  const materials=json.materials.map(m=>({name:m.name,baseColorFactor:m.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1],
    baseColorTextureEmbedded:m.pbrMetallicRoughness?.baseColorTexture!==undefined,
    metallic:m.pbrMetallicRoughness?.metallicFactor??1,roughness:m.pbrMetallicRoughness?.roughnessFactor??1}));
  const primitives=[],all=[];
  json.nodes.forEach((node,nodeIndex)=>{
    if(node.mesh===undefined)return;
    const world=matrix(nodeIndex);
    json.meshes[node.mesh].primitives.forEach((primitive,primitiveIndex)=>{
      const accessor=json.accessors[primitive.attributes.POSITION],view=json.bufferViews[accessor.bufferView];
      if(accessor.componentType!==5126||accessor.type!=='VEC3'||accessor.sparse)throw new Error(`Unsupported POSITION in ${id}`);
      const base=(view.byteOffset??0)+(accessor.byteOffset??0),stride=view.byteStride??12,positions=[];
      for(let i=0;i<accessor.count;i++)positions.push(point(world,[0,1,2].map(axis=>bin.readFloatLE(base+i*stride+axis*4))));
      const aabb=bounds(positions);all.push(...positions);
      primitives.push({node:node.name,mesh:json.meshes[node.mesh].name,primitive:primitiveIndex,material:materials[primitive.material].name,
        vertices:accessor.count,triangles:primitive.indices===undefined?accessor.count/3:json.accessors[primitive.indices].count/3,
        aabb_glb_m:aabb,along_glb_y_m:[aabb.min[1],aabb.max[1]]});
    });
  });
  const sockets=Object.fromEntries(json.nodes.map((n,i)=>[n.name,i]).filter(([name])=>name.startsWith('Socket_')).map(([name,i])=>[name,point(matrix(i),[0,0,0]).map(round)]));
  return {file:relative,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),bytes:buffer.length,
    bounds_glb_m:bounds(all),sockets,materials,primitives};
}
const zone=(id,min,max,dominant,candidates,note)=>({id,rest_along_m:[min,max],dominant,candidates,note});
const mapping={
  sword:{role:'primary',rest_reach_m:1.02,deformation_m:[.18,1.02],runtime_keys:['weapon'],fallback:'steel',zones:[
    zone('rear_pommel',-.208,-.13,'brass',['brass','steel'],'Pommel, knuckle bow and tang overlap; not part of the ordinary forward weapon panel.'),
    zone('wrapped_grip',-.118,.108,'leather',['leather','brass','steel'],'Leather is exposed; internal steel tang and thin end fittings do not turn the grip into a bare metal surface.'),
    zone('cup_and_collar',.108,.20,'brass',['brass','steel'],'Brass cup/guard and steel ricasso overlap .185–.20; coarse mixed metal.'),
    zone('blade',.20,1.02,'steel',['steel'],'Actual steel primitive begins .185; .20 is the conservative clean-blade routing boundary.')
  ]},
  spear:{role:'primary',rest_reach_m:1.35,deformation_m:[.15,1],runtime_keys:['weapon'],fallback:'wood',zones:[
    zone('wrapped_grip',-.152,.128,'leather',['leather','wood','brass'],'Wood core is covered by leather.'),
    zone('exposed_shaft',.128,.933,'wood',['wood','brass'],'Wooden shaft; local maker band .381–.412 is a small brass override, not a metal shaft.'),
    zone('socket_and_collar',.933,1.082,'metal_mixed',['steel','brass','wood'],'Forged socket, brass ferrules and wood shaft overlap. The steel leaf starts at1.01.'),
    zone('steel_leaf',1.082,1.35,'steel',['steel'],'Clean upper steel spearhead; temper inlay is also metal.')
  ],overrides:[zone('maker_band',.381,.413,'brass',['brass','wood'],'Use only if band location is known; broad key fallback remains wood.')]},
  axe:{role:'primary',rest_reach_m:.92,deformation_m:[.18,.56],runtime_keys:['weapon','weapon-head'],fallback:'wood',head_fallback:'steel',zones:[
    zone('wrapped_grip',-.158,.118,'leather',['leather','wood','brass'],'Exposed leather; brass heel lies at the rear.'),
    zone('exposed_handle',.118,.56,'wood',['wood'],'Exposed timber before the wide head.'),
    zone('head_and_eye',.56,.814,'metal_mixed',['steel','brass','wood'],'Forged/cutting steel surrounds the timber-through eye and brass retainers; along alone cannot distinguish them.'),
    zone('upper_head',.814,.92,'steel',['steel','wood'],'Steel head; small visible wood wedge at .817–.843 is an across-dependent exception.')
  ],head_role_override:{cutting_edge:'steel',forged_web:'steel',eye_retainer:'brass',visible_eye_wedge:'wood'}},
  maul:{role:'primary',rest_reach_m:1.08,deformation_m:[.18,.725],runtime_keys:['weapon','weapon-head'],fallback:'wood',head_fallback:'wood_metal_mixed',zones:[
    zone('secondary_wrapped_grip',-.315,-.125,'leather',['leather','wood','brass'],'Second hand grip; grip socket is at-.22.'),
    zone('main_wrapped_grip',-.095,.095,'leather',['leather','wood','brass'],'Main hand grip centred at0.'),
    zone('exposed_shaft',.095,.658,'wood',['wood'],'Exposed ash shaft; do not inherit weapon-head metal routing.'),
    zone('brass_neck',.658,.733,'metal_mixed',['brass','wood','steel'],'Brass socket/lip around a timber shaft plus pins; neck and head begin to overlap near .725.'),
    zone('laminated_head',.733,1.015,'wood_metal_mixed',['wood','brass','steel'],'Timber block with brass clamps, corner braces and steel side shoes. Along alone is deliberately ambiguous.'),
    zone('forward_striking_plate',1.015,1.08,'steel',['steel','wood'],'Forward plate itself is steel; timber behind it ends at1.025 but is covered on the striking face.')
  ],head_role_override:{front_striking_face:'steel',lateral_striking_shoe:'steel',clamp_band:'brass',exposed_timber_between_hardware:'wood'},
    conditional_regions_glb_m:[
      {id:'steel_side_shoes',across_x_abs:[.2175,.2825],along_y:[.725,1.025],dominant:'steel',note:'Coarse side region; bevels/edge overlaps remain mixed.'},
      {id:'brass_clamp_bands',along_y:[[.736,.784],[.971,1.019]],dominant:'brass',note:'Only when the exposed clamp surface is the contact; not every point at these Y values is brass.'}
    ]},
  short:{role:'secondary_shield',runtime_keys:[],fallback:'metal_mixed',nominal_radii_m:[.23,.23],zones:[
    {id:'front_bowl',dominant:'steel',candidates:['steel','brass'],glb_depth_z_m:[.05,.155],note:'Spun steel bowl/umbo with brass rings and pins; exposed guard face routes to metal.'},
    {id:'rim',dominant:'brass',candidates:['brass','steel'],radial_xy_m:[.208,.23],note:'Rolled brass perimeter; circular radial approximation.'},
    {id:'wood_back',dominant:'wood',candidates:['wood','brass'],glb_depth_z_m:[.035,.06],note:'Rear wooden backing with brass braces; depth overlaps bowl shell. Contact side/normal is required to refine.'},
    {id:'back_handgrip',dominant:'leather',candidates:['leather','wood','brass'],glb_depth_z_m:[-.02,.02],note:'Grip near origin, not the front guard surface; wood core covered by leather.'}
  ]},
  long:{role:'secondary_shield',runtime_keys:[],fallback:'wood',nominal_radii_m:[.22,.36],zones:[
    {id:'front_planks',dominant:'wood',candidates:['wood','brass'],glb_depth_z_m:[.035,.091],note:'Main exposed face is seven timber planks, with sparse brass cleats/rivets.'},
    {id:'rim',dominant:'brass',candidates:['brass','steel'],note:'Brass border. Use proximity to delivered outline/border; rectangular AABB corners are empty and must not be classified as an actual rim hit.'},
    {id:'centre_badge',dominant:'brass',candidates:['brass','enamel_coating'],local_xy_box_m:[[-.064,-.105],[.064,.09]],glb_depth_z_m:[.094,.114],note:'Small brass/enamel plaque over the wood face. Along alone cannot identify it.'},
    {id:'back_braces',dominant:'brass',candidates:['brass','wood'],note:'Metal cross braces on wooden back; source longitudinal bands near±.19.'},
    {id:'back_handgrip_and_strap',dominant:'leather',candidates:['leather','wood','brass'],glb_depth_z_m:[-.045,.028],note:'Leather grip/forearm strap damp impact. This is not cloth and is not the exposed guard face.'}
  ]},
  knife:{role:'secondary_parry_only',rest_reach_m:.42,deformation_m:[.09,.42],runtime_keys:[],fallback:'steel',zones:[
    zone('pommel',-.15,-.09,'brass',['brass','steel'],'Turned brass pommel and peened steel tang.'),
    zone('wrapped_grip',-.074,.074,'leather',['leather','wood','brass'],'Wood core covered by leather; origin is hand centre.'),
    zone('quillons_ring_and_collar',.074,.125,'brass',['brass','steel'],'Brass guard/ring overlaps blade root. Finger-ring extent is partly below this along band.'),
    zone('parrying_blade',.125,.42,'steel',['steel','brass'],'Actual steel starts .11; fine brass-dark inlay/pins do not change blade fallback. No independent primary attack.')
  ]}
};
for(const asset of Object.values(mapping))for(const zone of asset.zones??[])if(zone.rest_along_m&&asset.rest_reach_m)zone.rest_along_normalized=zone.rest_along_m.map(v=>round(v/asset.rest_reach_m));

const assets=Object.fromEntries(IDS.map(id=>[id,{...mapping[id],measured:readGLB(id)}]));
const output={version:1,date:'2026-10-17',purpose:'Approximate contact-material routing for Audio/FX from the frozen seven v1GLB assets; no runtime mutation.',
  scope:{source_set:'public/assets/equipment/workshop',no_none_mesh:true,no_runtime_changes:true,no_per_triangle_material_claim:true,
    measured:'POSITION buffer data decoded from each material primitive, node world transforms applied; min/max recomputed, not copied from authoring scripts.',
    semantic_zones:'Deliberately coarse exposed-surface regions informed by measured GLB material bounds plus the delivered part construction; overlapping materials are labelled mixed.'},
  coordinates:{glb:{across:'+X',along:'+Y',front:'+Z',unit:'metres',origin:'grip centre'},
    runtime_projection:'d=dot(contact-hand,normalize(tip-hand)); L=length(tip-hand); alphaPosed=d/L. hand=mainHand for primary, offHand for knife.',
    rest_normalization:'alphaRest=s/rest_reach_m; use rest_along_m or alphaRest to lookup zones. Do not compare alphaPosed directly to rest-zone alpha thresholds.',
    rendered_extension:'E=L-rest_reach_m; renderer uses F(s)=s+E*clamp((s-a)/(b-a),0,1), [a,b]=deformation_m. Grip/heads are not uniformly scaled.',
    inverse_rendered_extension:'If d<=a: s=d. If d>=b+E: s=d-E. Else s=a+(d-a)/(1+E/(b-a)). This is the monotonic inverse for the current legal equipment range.',
    shields:'Invert current equipmentTransform shield sx/sy around offHand before classifying local XY regions. GLB depth Z is unchanged by guard sx/sy.',
    fallback_when_contact_position_missing:'Use explicit runtime material/palm evidence first, then key+equipment fallback. Mixed remains mixed; never guess a precise face from an AABB.'},
  runtime_key_policy:{
    explicit_material:'An existing explicit material=wood/palm contact wins over a broad weapon body key; main-palm/off-palm are character timber, outside this item contract.',
    weapon:'Shaft/whole primary proxy. Resolve by equipment id and recovered rest along. A weapon body is not automatically metal.',
    'weapon-head':'Wide axe/maul proxy, still body weapon. Axe fallback steel; maul fallback wood_metal_mixed. The key alone cannot identify a clamp or steel shoe.',
    defenses:'Current shield/dagger guard contacts have no universal weapon-head material key; combine defense id with known face/rim/back context. These logical zones do not add colliders or events.',
    missing_contact_location:'sword->steel; spear->wood; axe weapon->wood and weapon-head->steel; maul weapon->wood and weapon-head->wood_metal_mixed; short guard->metal_mixed; long guard->wood; knife parry->steel.'},
  material_families:{wood:['WD_wood','WD_wood_light','WD_wood_dark'],steel:['WD_steel','WD_steel_dark'],brass:['WD_brass','WD_brass_dark'],leather:['WD_leather','WD_leather_edge'],
    enamel_coating:['WD_enamel_black'],cloth:[],cloth_note:'The actual seven v1 assets contain no cloth material primitives. Leather damping is not evidence of fabric.'},
  pair_routing_priority:[
    {priority:1,condition:'Explicit collision body material already resolves character wood or another authoritative surface.',route:'Preserve that material; do not override with weapon id.'},
    {priority:2,condition:'Known exposed steel/brass against steel/brass.',route:'metal impact/clang family; metal detail may be secondary to mass/impulse. No automatic sparks from material alone.'},
    {priority:3,condition:'Wood against wood.',route:'wood/thud family.'},
    {priority:4,condition:'Wood against metal, or unresolved maul mixed head.',route:'wood/thud body with optional short metal accent; do not promote every mixed overlap to a full sustained clang.'},
    {priority:5,condition:'Leather or explicitly known cloth at the actual surface.',route:'damped contact; underlying wood/metal may remain a quiet transient. No cloth is delivered in this asset set.'},
    {priority:6,condition:'Small enamel coat, engraving or tiny fastener overlaps a larger exposed surface.',route:'Route the structural/exposed substrate; do not create a separate impact solely from decoration.'}
  ],assets};
const destination=path.join(ROOT,OUTPUT);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(output,null,2)+'\n');
for(const [id,asset] of Object.entries(assets))console.log(`${id}: ${asset.measured.primitives.length} material primitives; ${asset.measured.bounds_glb_m.dimensions.join(' x ')} m; ${asset.measured.sha256}`);
console.log(`Wrote only ${OUTPUT}`);
