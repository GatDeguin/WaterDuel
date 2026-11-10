import test from 'node:test';
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {campaignWeather,sampleWeather,WEATHER_TYPES} from '../public/weather.js';
import {createWorkshopWeather} from '../public/rendering/workshop-weather.js';
import {roomCamera} from '../public/rendering/room-camera.js';

test('Cada circuito usa siete condiciones y termina en tormenta',()=>{
  for(const tier of ['normal','advanced']){
    const conditions=Array.from({length:7},(_,stage)=>campaignWeather(stage,tier));
    assert.deepEqual(new Set(conditions),new Set(WEATHER_TYPES));
    assert.equal(conditions.at(-1),'storm');
  }
  assert.equal(campaignWeather(-1,'normal'),'sun');
});

test('El relámpago es determinista y el trueno posterior tiene identidad persistente',()=>{
  const strike=sampleWeather('storm',3),heard=sampleWeather('storm',4.5);
  assert.ok(strike.flash>0&&strike.flash<=1);
  assert.equal(strike.thunderAt,null);
  assert.ok(heard.thunderAt>3&&heard.thunderAt<4.5);
  assert.equal(sampleWeather('storm',5).thunderAt,heard.thunderAt);
  assert.ok(sampleWeather('storm',40).thunderAt>heard.thunderAt);
  assert.ok(Number.isFinite(heard.thunderX)&&heard.thunderStrength>0);
  assert.deepEqual(sampleWeather('storm',4.5),heard);
  assert.equal(sampleWeather('rain',4.5).flash,0);
  assert.equal(sampleWeather('rain',4.5).thunderAt,null);
  assert.equal(sampleWeather('storm',Infinity).elapsed,0);
});

test('La luz de clima actualiza sólo ventanas y conserva los buffers de autoría',()=>{
  const view=createWorkshopWeather(),base={names:['Key','Left tall window | blue bounce','Practical warm bulb'],count:3,
    positions:new Float32Array([1,2,3,4, 5,6,7,8, 9,10,11,12]),colors:new Float32Array(12).fill(.5),directions:new Float32Array(12),keyPosition:[1,2,3]};
  const original=structuredClone(base),rain=view.lighting(base,sampleWeather('rain',0));
  assert.deepEqual(base,original);
  assert.equal(rain.directions,base.directions);
  assert.equal(rain.keyPosition,base.keyPosition);
  assert.deepEqual(rain.positions.subarray(0,7),base.positions.subarray(0,7));
  assert.deepEqual(rain.positions.subarray(8),base.positions.subarray(8));
  assert.notEqual(rain.positions[7],base.positions[7]);
  assert.notDeepEqual(rain.colors.subarray(4,7),base.colors.subarray(4,7));
  assert.equal(view.lighting(base,sampleWeather('rain',1)),rain);
  assert.equal(view.lighting(base,null),base);
});

test('Una tormenta ilumina las ventanas y acota el dibujo a lluvia y relámpago',()=>{
  const view=createWorkshopWeather(),base={names:['Right tall window | blue rim'],
    positions:new Float32Array([0,0,0,1]),colors:new Float32Array([.6,.8,1,.4])};
  const quiet=view.lighting(base,sampleWeather('storm',0)).positions[3];
  const strike=sampleWeather('storm',3);
  assert.ok(view.lighting(base,strike).positions[3]>quiet);
  const draws=[],renderer={gl:{depthMask(){}},flushDynamic(item){draws.push(item);}};
  view.draw(renderer,strike);
  assert.equal(draws.length,2);
  assert.ok(draws[1].mesh.p.length<draws[0].mesh.p.length);
  draws.length=0;
  view.draw(renderer,strike,true);
  assert.equal(draws.length,1);
});

test('Los materiales climáticos corresponden al vidrio y cielo GLB reales y los copos quedan detrás del vidrio',async()=>{
  const file=await open(new URL('../public/assets/environment/workshop/workshop-runtime-v4.glb',import.meta.url));
  let gltf;
  try{
    const header=Buffer.alloc(20);await file.read(header,0,header.length,0);
    const json=Buffer.alloc(header.readUInt32LE(12));await file.read(json,0,json.length,20);gltf=JSON.parse(json.toString());
  }finally{await file.close();}
  const glassNode=gltf.nodes.find(node=>node.name==='Workshop_window-cold-diffuse-daylight');
  const glassPrimitive=gltf.meshes[glassNode.mesh].primitives[0];
  const glassZ=gltf.accessors[glassPrimitive.attributes.POSITION].min[2];
  const glass=gltf.materials[glassPrimitive.material],sky=gltf.materials.find(material=>material.name==='WD_V4_EXT_overcast_sky');
  assert.equal(glass.alphaMode,'BLEND');
  const normalize=material=>({...material,baseColorFactor:material.pbrMetallicRoughness.baseColorFactor.slice(),emissiveFactor:material.emissiveFactor.slice()});
  const model={materials:[normalize(glass),normalize(sky),{name:'Workshop timber'}],drawMaterials:[{}, {}, {}]};
  const view=createWorkshopWeather(),sample=sampleWeather('snow',1.75),winter=view.environment(model,sample);
  assert.notEqual(winter,model);
  assert.equal(winter.drawMaterials,model.drawMaterials);
  assert.equal(winter.materials[2],model.materials[2]);
  assert.notDeepEqual(winter.materials[0].baseColorFactor,model.materials[0].baseColorFactor);
  assert.notDeepEqual(winter.materials[1].emissiveFactor,model.materials[1].emissiveFactor);
  const draws=[],masks=[],renderer={gl:{depthMask(value){masks.push(value);}},flushDynamic(item){draws.push(item);},sphere(){throw Error('Snow has no sun or moon disc');}};
  view.draw(renderer,sample);
  assert.equal(draws.length,1);
  assert.deepEqual(masks,[false,true]);
  const {p,n}=draws[0].mesh,first=Array.from(p);
  assert.ok(p.length>0&&p.length===n.length&&p.length%18===0&&p.length<18*256);
  assert.ok(p.every(Number.isFinite));
  for(let i=2;i<p.length;i+=3)assert.ok(p[i]<glassZ);
  view.draw(renderer,sampleWeather('snow',1.75));
  assert.equal(draws[1].mesh,draws[0].mesh);
  assert.deepEqual(Array.from(draws[1].mesh.p),first);
});

function ontoGlass(x,y,z,eye){
  const t=(eye[2]+4.94)/(eye[2]-z);
  return [eye[0]+(x-eye[0])*t,eye[1]+(y-eye[1])*t];
}

test('La nieve alcanza los bordes exterior y superior de ambas ventanas desde el combate',()=>{
  const view=createWorkshopWeather(),eye=roomCamera({phase:'fight'}).eye;
  const seen=[{outer:false,top:false},{outer:false,top:false}];
  const renderer={gl:{depthMask(){}},flushDynamic({mesh:{p}}){
    assert.equal(p.length,132*18);
    for(let i=0;i<p.length;i+=18){
      const [x,y]=ontoGlass(p[i],(p[i+1]+p[i+4])/2,p[i+2],eye),absX=Math.abs(x);
      if(absX<1.849||absX>4.16||y<1.384||y>5.895)continue;
      const pane=seen[x<0?0:1];
      pane.outer||=absX>4.09;pane.top||=y>5.8;
    }
  }};
  for(let i=0;i<24;i++)view.draw(renderer,sampleWeather('snow',i*.23));
  assert.deepEqual(seen,[{outer:true,top:true},{outer:true,top:true}]);
});

test('El núcleo y la rama del relámpago cruzan el cielo visible en ambas ventanas',()=>{
  const view=createWorkshopWeather();
  for(const phase of ['ready','fight']){
    const {eye}=roomCamera({phase,clock:.3,phaseClock:.3});
    for(const [elapsed,side] of [[2.82,-1],[8.92,1]]){
      const draws=[],renderer={gl:{depthMask(){}},flushDynamic(item){draws.push(item);}};
      view.draw(renderer,sampleWeather('storm',elapsed));
      assert.equal(draws.length,2);
      assert.equal(draws[0].mesh.p.length,176*18);
      const bolt=draws[1],{p}=bolt.mesh;
      assert.ok(bolt.color.every(v=>v>1));
      assert.equal(p.length,8*18);
      const visible=offset=>{
        const [x,y]=ontoGlass((p[offset]+p[offset+3]+p[offset+6]+p[offset+12])/4,
          (p[offset+1]+p[offset+4]+p[offset+7]+p[offset+13])/4,p[offset+2],eye);
        return x*side>1.849&&x*side<4.16&&y>4.8&&y<5.895;
      };
      assert.ok([0,1,2,3,4].some(i=>visible(i*18)),`${phase} ${side}: núcleo`);
      assert.ok([5,6,7].some(i=>visible(i*18)),`${phase} ${side}: rama`);
    }
  }
});
