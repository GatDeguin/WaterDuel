import {getWeapon,getDefense,DEFENSES} from '../equipment.js';

// Convex, closed profiles have a raised center ridge and a thin, faceted edge.
// These small meshes are created once, then uploaded with the renderer's other
// static primitives. Equipment changes only submit different model matrices.
function profileMesh(points,edge=.08){
  const p=[],n=[],ix=[],cx=points.reduce((s,v)=>s+v[0],0)/points.length,cy=points.reduce((s,v)=>s+v[1],0)/points.length;
  function triangle(a,b,c){
    const u=b.map((v,i)=>v-a[i]),v=c.map((q,i)=>q-a[i]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...cross)||1;
    if(Math.hypot(...cross)<1e-12)return;
    const start=p.length/3;for(const q of [a,b,c]){p.push(...q);n.push(...cross.map(value=>value/length));}ix.push(start,start+1,start+2);
  }
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],ae=a[2]??edge,be=b[2]??edge;
    const af=[a[0],a[1],ae],bf=[b[0],b[1],be],ab=[a[0],a[1],-ae],bb=[b[0],b[1],-be];
    triangle([cx,cy,.5],af,bf);triangle([cx,cy,-.5],bb,ab);
    triangle(ab,bb,bf);triangle(ab,bf,af);
  }
  return {p,n,ix};
}
export const EQUIPMENT_MESHES=Object.freeze({
  rapierBlade:profileMesh([[0,.5,0],[-.5,-.38],[-.34,-.5],[.34,-.5],[.5,-.38]],.025),
  spearHead:profileMesh([[0,.5,0],[-.5,.06],[-.29,-.36],[0,-.5],[.29,-.36],[.5,.06]],.035),
  axeHead:profileMesh([[0,.5,0],[-.26,.30],[-.28,-.30],[.02,-.5],[.50,-.46],[.56,.28],[.28,.48]],.12),
  shieldLong:profileMesh(DEFENSES.long.profile,.32),
  strikingPlate:profileMesh([[.5,.5],[-.5,.5],[-.5,-.5],[.5,-.5]],.5)
});

function frame(hand,tip,dir=1,defaultZ=.17){
  const origin=[hand.x,hand.y,hand.z??defaultZ],delta=[tip.x-hand.x,tip.y-hand.y,(tip.z??origin[2])-origin[2]],length=Math.hypot(...delta);
  const y=length>1e-8?delta.map(v=>v/length):[dir,0,0],planar=Math.hypot(y[0],y[1]);
  const x=planar>1e-8?[y[1]/planar,-y[0]/planar,0]:[1,0,0];
  const z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  return {origin,x,y,z,length:Math.max(.001,length),ux:y[0],uy:y[1]};
}
const frontFrame=hand=>({origin:[hand.x,hand.y,0],x:[1,0,0],y:[0,1,0],z:[0,0,1]});

function part(renderer,f,shape,x,y,z,sx,sy,sz,color,material=0,axis='along'){
  // Cylinders run along local Y; face turns that axis toward the camera.
  const a=axis==='across'?f.y:f.x,b=axis==='face'?f.z:axis==='across'?f.x.map(v=>-v):f.y,c=axis==='face'?f.y.map(v=>-v):f.z;
  const m=new Float32Array([a[0]*sx,a[1]*sx,a[2]*sx,0,b[0]*sy,b[1]*sy,b[2]*sy,0,c[0]*sz,c[1]*sz,c[2]*sz,0,
    f.origin[0]+f.x[0]*x+f.y[0]*y+f.z[0]*z,f.origin[1]+f.x[1]*x+f.y[1]*y+f.z[1]*z,f.origin[2]+f.x[2]*x+f.y[2]*y+f.z[2]*z,1]);
  renderer.draw(shape,m,color,material);
}
function grip(renderer,f,pal,center=0,radius=.045,length=.26){
  part(renderer,f,'cylinder',0,center,0,radius,length,radius,pal.leather,7);
  for(let i=0;i<6;i++)part(renderer,f,'torus',0,center-length*.41+i*length*.164,0,radius*1.04,radius*1.04,.021,pal.edge,7,'face');
  for(const side of [-1,1])part(renderer,f,'cylinder',0,center+side*length*.5,0,radius*1.14,.022,radius*1.14,pal.metal,1);
}
function shaft(renderer,f,pal,start,end,radius){part(renderer,f,'cylinder',0,(start+end)/2,0,radius,end-start,radius,pal.wood,0);}

export function drawMaulSupportArm(renderer,fighter,pal){
  const p=fighter.pose;
  for(const [a,b,width,depth,color] of [[p.offShoulder,p.offElbow,.20,.16,pal.wood],[p.offElbow,p.offHand,.17,.15,pal.ivory??pal.light]]){
    const f=frame(a,b,fighter.dir,-.10);
    part(renderer,f,'box',0,f.length/2,0,width,f.length,depth,color,0);
    part(renderer,f,'cylinder',width*.4,f.length/2,depth*.32,.012,f.length,.012,pal.metal,1);
    for(const t of [.17,.83])part(renderer,f,'cylinder',0,f.length*t,depth*.59,.018,.018,.018,pal.metal,1,'face');
  }
}

export function drawWeapon(renderer,fighter,pal){
  const p=fighter.pose,weapon=getWeapon(fighter.equipment??p.equipment),f=frame(p.mainHand,p.tip,fighter.dir),length=f.length;
  if(weapon.id==='sword'){
    grip(renderer,f,pal,0,.045,.25);
    part(renderer,f,'sphere',0,-.177,0,.062,.061,.062,pal.metal,1);
    part(renderer,f,'cylinder',0,.135,0,.119,.039,.119,pal.metal,1);
    part(renderer,f,'torus',0,.158,0,.119,.119,.047,pal.metal,1,'face');
    part(renderer,f,'cylinder',0,.166,0,.038,.064,.038,pal.steel,16);
    part(renderer,f,'rapierBlade',0,(length+.18)/2,0,.032,Math.max(.01,length-.18),.026,pal.steel,16);
  }else if(weapon.id==='spear'){
    shaft(renderer,f,pal,-.29,length-.31,.032);
    grip(renderer,f,pal,-.025,.039,.28);
    part(renderer,f,'cylinder',0,-.27,0,.041,.074,.041,pal.metal,1);
    part(renderer,f,'cylinder',0,length-.365,0,.047,.11,.047,pal.metal,1);
    part(renderer,f,'cylinder',0,length-.325,0,.035,.08,.035,0x596e70,17);
    part(renderer,f,'spearHead',0,length-.19,0,.166,.38,.046,pal.steel,16);
    part(renderer,f,'sphere',0,length-.362,.036,.016,.018,.013,pal.metal,1);
  }else if(weapon.id==='axe'){
    shaft(renderer,f,pal,-.27,length-.18,.043);
    grip(renderer,f,pal,-.015,.048,.27);
    part(renderer,f,'sphere',0,-.28,0,.059,.050,.059,pal.metal,1);
    part(renderer,f,'axeHead',0,length-.18,0,.54,.36,.11,pal.steel,16);
    part(renderer,f,'cylinder',-.026,length-.205,0,.067,.22,.067,0x4c5c5d,17);
    for(const y of [length-.295,length-.12])part(renderer,f,'cylinder',-.026,y,0,.073,.034,.073,pal.metal,1);
    for(const y of [length-.25,length-.16])part(renderer,f,'hex',.035,y,.074,.022,.024,.022,pal.metal,1,'face');
  }else{
    const offset=weapon.gripOffset||.22;
    shaft(renderer,f,pal,-offset-.17,length-.23,.050);
    grip(renderer,f,pal,.025,.054,.22);grip(renderer,f,pal,-offset,.054,.19);
    part(renderer,f,'sphere',0,-offset-.17,0,.065,.047,.065,pal.metal,1);
    // A heavy timber mallet, bound in brass, with real steel striking plates.
    part(renderer,f,'box',0,length-.205,0,.46,.30,.30,pal.wood,0);
    for(const y of [length-.32,length-.085])part(renderer,f,'box',0,y,0,.49,.048,.325,pal.metal,1);
    for(const side of [-1,1])part(renderer,f,'box',side*.25,length-.205,0,.065,.30,.35,pal.steel,16);
    part(renderer,f,'strikingPlate',0,length-.0325,0,.525,.065,.35,pal.steel,16);
    part(renderer,f,'box',0,length-.205,.171,.22,.18,.025,pal.edge,0);
    for(const x of [-.15,.15])for(const y of [length-.29,length-.12])part(renderer,f,'hex',x,y,.184,.023,.028,.023,pal.metal,1,'face');
    // The rig supplies the second hand on this exact section of the shaft.
    for(let i=0;i<4;i++){
      part(renderer,f,'box',-.025,-offset+(i-1.5)*.037,.065,.10,.033,.064,pal.wood,0);
      part(renderer,f,'sphere',.025,-offset+(i-1.5)*.037,.098,.023,.021,.023,pal.metal,1);
    }
  }
  return f;
}

export function drawDefense(renderer,fighter,pal){
  const p=fighter.pose,loadout=fighter.equipment??p.equipment,weapon=getWeapon(loadout),defense=getDefense(loadout);
  if(weapon.twoHanded||defense.kind==='none')return;
  if(defense.kind==='knife'){
    const hand=p.offHand,elbow=p.offElbow,dx=hand.x-elbow.x,dy=hand.y-elbow.y,length=Math.hypot(dx,dy)||1;
    const tip=p.defenseTip??{x:hand.x+dx/length*defense.length,y:hand.y+dy/length*defense.length,z:hand.z??-.08};
    const f=frame(hand,tip,fighter.dir,-.08);
    grip(renderer,f,pal,-.035,.038,.18);
    part(renderer,f,'sphere',0,-.16,0,.047,.040,.047,pal.metal,1);
    part(renderer,f,'cylinder',0,.065,0,.018,.20,.018,pal.metal,1,'across');
    for(const x of [-.10,.10])part(renderer,f,'sphere',x,.065,0,.027,.027,.027,pal.metal,1);
    part(renderer,f,'rapierBlade',0,(f.length+.09)/2,0,.073,Math.max(.01,f.length-.09),.032,pal.steel,16);
    return;
  }
  const f=frontFrame(p.offHand),rx=p.shieldRadiusX??p.shieldRadius??defense.radiusX,ry=p.shieldRadiusY??p.shieldRadius??defense.radiusY;
  if(defense.id==='short'){
    // Keep the visible outer rim on the same radius and center as the parry disk.
    part(renderer,f,'cylinder',0,0,.03,rx,.055,ry,pal.steel,1,'face');
    part(renderer,f,'cylinder',0,0,.067,rx*.88,.027,ry*.88,pal.wood,0,'face');
    for(const x of [-.48,0,.48])part(renderer,f,'box',rx*x,0,.088,rx*.22,ry*(x===0?1.64:1.43),.018,pal.light,0);
    part(renderer,f,'torus',0,0,.098,rx*.96,ry*.96,.05,pal.metal,1);
    part(renderer,f,'sphere',0,0,.105,rx*.34,ry*.34,.057,pal.metal,1);
    part(renderer,f,'hex',0,0,.162,.025,.025,.025,pal.steel,16,'face');
    for(let i=0;i<8;i++){const a=i*Math.PI/4;part(renderer,f,'sphere',Math.cos(a)*rx*.82,Math.sin(a)*ry*.82,.11,.014,.014,.012,pal.metal,1);}
  }else{
    part(renderer,f,'shieldLong',0,0,.018,rx,ry,.10,pal.metal,1);
    part(renderer,f,'shieldLong',0,0,.044,rx*.94,ry*.94,.077,pal.wood,0);
    for(const {x,width,height} of defense.planks){
      part(renderer,f,'box',rx*x,0,.086,rx*width,ry*height,.026,x===0?pal.light:pal.wood,0);
    }
    for(const y of [-.35,.35]){
      part(renderer,f,'box',0,y*ry,.108,rx*1.65,.027,.025,pal.metal,1);
      for(const x of [-.70,.70])part(renderer,f,'hex',rx*x,y*ry,.131,.017,.021,.017,pal.steel,16,'face');
    }
    part(renderer,f,'sphere',0,0,.123,rx*.30,ry*.18,.049,pal.metal,1);
    part(renderer,f,'hex',0,0,.173,.025,.021,.025,pal.steel,16,'face');
  }
}
