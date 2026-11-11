import test from 'node:test';
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {campaignWeather,sampleWeather,WEATHER_TYPES} from '../public/weather.js';
import {createWorkshopWeather} from '../public/rendering/workshop-weather.js';
import {prepareWorkshopLights} from '../public/rendering/workshop-lights.js';
import {readFile} from 'node:fs/promises';
import {roomCamera} from '../public/rendering/room-camera.js';
import {DuelEngine} from '../public/engine.js';
import {CAMPAIGN,ADVANCED_CAMPAIGN,BOSS_CAMPAIGN} from '../public/campaign-progression.js';
import {captureReplayState,replayView} from '../public/replay.js';

test('El corte del jefe empieza tras el primer arranque, permanece entre rondas y se conserva al reproducir',async()=>{
  const {sampleEncounterWeather}=await import('../public/weather.js');
  const game=new DuelEngine();game.difficulty='boss';game.weather='storm';game.weatherStart=0;
  game.aiEnabled=false;game.start();
  assert.equal(sampleEncounterWeather(game).mainPower,1);
  while(game.phase==='countdown')game.update(.04);
  assert.equal(game.stormFightStart,game.clock);
  assert.equal(sampleEncounterWeather(game).mainPower,1);
  const fightStart=game.stormFightStart;
  game.clock=fightStart+.71;
  assert.ok(sampleEncounterWeather(game).mainPower>0&&sampleEncounterWeather(game).mainPower<1);
  game.clock=fightStart+1;
  assert.equal(sampleEncounterWeather(game).mainPower,0);
  assert.equal(sampleEncounterWeather(replayView(captureReplayState(game))).mainPower,0);
  game.phase='countdown';game.round=2;
  assert.equal(sampleEncounterWeather(game).mainPower,0);
  while(game.phase==='countdown')game.update(.04);
  assert.equal(game.stormFightStart,fightStart);
  game.resetMatch();assert.equal(sampleEncounterWeather(game).mainPower,1);
  assert.equal(sampleEncounterWeather({weather:'rain',clock:10,stormFightStart:0}).mainPower,1);
});

test('La falla apaga emisores y filamentos del circuito, conserva luces de apoyo y el relámpago frío',()=>{
  const view=createWorkshopWeather(),base={names:['Key | warm workshop softbox','Practical warm bulb.001','Shade downlight','Left bench oil lamp warm practical illumination','Left tall window | blue bounce'],count:5,
    positions:new Float32Array(20).fill(1),colors:new Float32Array(20).fill(.5),directions:new Float32Array(20),keyIndex:0,keyPosition:[1,2,3]};
  const dark={...sampleWeather('storm',5),mainPower:0},lit={...dark,mainPower:1};
  assert.equal(view.lighting(base,lit).positions[3],1);
  const result=view.lighting(base,dark),quiet=result.positions[19];
  assert.deepEqual([3,7,11,15].map(i=>result.positions[i]),[0,0,0,1]);
  assert.equal(base.positions[3],1);
  const flash=view.lighting(base,{...sampleWeather('storm',8.91),mainPower:0});
  assert.equal(flash.positions[3],0);
  assert.ok(flash.positions[19]>quiet*3);
  assert.ok(view.lighting(base,{...sampleWeather('storm',8.91),mainPower:0},true).positions[19]<quiet*3);
  const filament={name:'Workshop v2 PBR | lamp-warm-tungsten-filament',baseColorFactor:[1,.7,.4,1],emissiveFactor:[1,.5,.15]};
  const oil={name:'Oil lamp',baseColorFactor:[1,1,1,1],emissiveFactor:[1,1,1]};
  const model={materials:[filament,oil]};
  assert.equal(view.environment(model,dark).materials[0].mainCircuitPower,0);
  assert.deepEqual(view.environment(model,dark).materials[0].emissiveFactor,filament.emissiveFactor,'las lámparas de apoyo comparten el material');
  assert.equal(view.environment(model,dark).materials[1],oil);
  assert.equal(view.environment(model,lit).materials[0].mainCircuitPower,1);
});

test('La tormenta del jefe dibuja un contraluz por lado y conserva un rebote cálido entre rayos',async()=>{
  const {sampleEncounterWeather}=await import('../public/weather.js');
  const contract=JSON.parse(await readFile(new URL('../public/assets/environment/workshop/asset-contract.json',import.meta.url),'utf8'));
  const base=prepareWorkshopLights(contract),view=createWorkshopWeather();
  const offset=name=>base.names.indexOf(name)*4;
  const key=offset('Key | warm workshop softbox'),left=offset('Left tall window | blue bounce'),right=offset('Right tall window | blue rim');
  const table=offset('Right table glancing reflection'),front=offset('Soft front return'),oil=offset('Left bench oil lamp warm practical illumination');
  const game={difficulty:'boss',weather:'storm',weatherStart:0,stormFightStart:1,clock:5};
  const snapshot=(clock,reduced=false)=>{
    game.clock=clock;
    const light=view.lighting(base,sampleEncounterWeather(game),reduced);
    return {gains:[key,left,right,table,front,oil].map(i=>light.positions[i+3]/base.positions[i+3]),
      warmth:light.colors[table]/light.colors[table+2],count:light.count,directions:light.directions};
  };
  const quiet=snapshot(5),leftStrike=snapshot(2.8),rightStrike=snapshot(8.9),softStrike=snapshot(8.9,true);
  assert.equal(quiet.gains[0],0);
  assert.ok(quiet.gains[1]<.46&&quiet.gains[2]<.46);
  assert.ok(quiet.gains[3]>1&&quiet.gains[4]>.5&&quiet.gains[4]<1);
  assert.equal(quiet.gains[5],1);
  assert.ok(quiet.warmth>base.colors[table]/base.colors[table+2]);
  assert.ok(leftStrike.gains[1]>leftStrike.gains[2]*2&&rightStrike.gains[2]>rightStrike.gains[1]*2);
  assert.ok(softStrike.gains[2]>quiet.gains[2]&&softStrike.gains[2]<rightStrike.gains[2]*.35);
  assert.equal(rightStrike.count,base.count);
  assert.equal(rightStrike.directions,base.directions);
  const normal=view.lighting(base,sampleWeather('storm',8.9));
  assert.ok(Math.abs(normal.positions[left+3]/base.positions[left+3]-normal.positions[right+3]/base.positions[right+3])<1e-5);
  assert.equal(normal.positions[table+3],base.positions[table+3]);
  assert.equal(normal.colors[table+2],base.colors[table+2]);
});

test('La historia y la avanzada usan siete condiciones y cada circuito termina en tormenta',()=>{
  for(const [tier,encounters] of [['normal',CAMPAIGN],['advanced',ADVANCED_CAMPAIGN]]){
    const conditions=encounters.map((_,stage)=>campaignWeather(stage,tier));
    assert.deepEqual(new Set(conditions),new Set(WEATHER_TYPES));
    assert.equal(conditions.at(-1),'storm');
  }
  assert.equal(campaignWeather(BOSS_CAMPAIGN.length-1,'bosses'),'storm');
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
