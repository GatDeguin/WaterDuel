import test from 'node:test';
import assert from 'node:assert/strict';

const api=await import('../public/remote-menu.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const command=(name,value,extra={})=>({type:'command',requestId:1,sentAt:1234,command:name,...(value===undefined?{}:{value}),...extra});

test('El protocolo remoto expone normalización pura de comandos y estados',()=>{
  assert.equal(typeof api.normalizeMenuCommand,'function');
  assert.equal(typeof api.sanitizeMenuState,'function');
});

test('Los comandos permitidos conservan tipos estrictos y sólo campos del contrato',()=>{
  const valid={setMode:['solo','versus'],setExperience:['duel','training','practice','precision','campaign'],
    setDifficulty:['rookie','normal','expert','boss'],setBestOf:[3,5],setArena:['atelier','dojo','midnight'],
    setQuality:['high','ultra','eco'],setCamera:['combat','detail'],setLighting:['cinematic','neutral'],
    setAudio:[true,false],setVolume:[0,100,38],replayOpen:[1,150],replaySeek:[0,.4,1],replaySpeed:[.25,.5,1],
    setLoadout:[{slot:1,weapon:'sword',defense:'short'},{slot:2,weapon:'maul',defense:'none'}]};
  for(const [name,values] of Object.entries(valid))for(const value of values){
    const source=command(name,value,{slot:2,key:'secret',unknown:4});
    assert.deepEqual(api.normalizeMenuCommand(source),{requestId:1,sentAt:1234,command:name,value},name);
  }
  for(const name of ['start','reset','replayToggle','replayClose','replayClear','nextEncounter','resetCampaign'])
    assert.deepEqual(api.normalizeMenuCommand(command(name)),{requestId:1,sentAt:1234,command:name});
});

test('Valores fuera de lista, coerciones, payloads e identificadores inválidos se rechazan',()=>{
  for(const [name,value] of [['setMode','host'],['setBestOf','5'],['setBestOf',7],['setVolume',-1],['setVolume',101],
    ['setVolume','50'],['setAudio',1],['replayOpen',0],['replayOpen',1.5],['replaySeek',NaN],['replaySeek',1.01],
    ['replaySpeed',2],['setLoadout',{slot:0,weapon:'sword',defense:'short'}],
    ['setLoadout',{slot:1,weapon:'knife',defense:'short'}],['setLoadout',{slot:1,weapon:'sword',defense:'invalid'}],
    ['eval','1+1'],['start',{}]])assert.equal(api.normalizeMenuCommand(command(name,value)),null,`${name}: ${value}`);
  for(const value of [null,[],{},command('start',undefined,{requestId:0}),command('start',undefined,{requestId:Infinity}),
    command('start',undefined,{requestId:'1'}),command('start',undefined,{sentAt:'123'}),command('start',undefined,{sentAt:Infinity}),
    command('start',undefined,{type:'control'})])assert.equal(api.normalizeMenuCommand(value),null);
});

test('Armería y estado se copian profundamente sin secretos ni referencias al origen',()=>{
  const source={phase:'ready',mode:'solo',experience:'campaign',difficulty:'boss',bestOf:5,arena:'dojo',quality:'ultra',
    camera:'detail',lighting:'neutral',audioOn:true,volume:63,scores:[2,1],round:4,clock:'01:23',
    fighters:[{slot:1,name:'Mint Mamba',equipment:{weapon:'spear',defense:'knife',key:'secret'},guardPercent:65,guardLabel:'GUARDIA',wins:[true,true,false],token:'secret'},
      {slot:2,name:'El Maestro',equipment:{weapon:'maul',defense:'none'},guardPercent:12,guardLabel:'AGOTADA',wins:[true,false,false]}],
    objective:{kind:'campaign',title:'Campeones',instruction:'Derrotá al rival.',progress:3,total:7,completed:false,nextAction:'advance',target:{secret:true}},
    replay:{clips:[{id:4,duration:3.2,complete:true,key:'secret'}],active:true,paused:true,speed:.5,position:.7,frames:['secret']},
    configurable:true,trainingEquipmentLocked:false,message:'Listo',rendererError:'',hostToken:'secret',links:{1:'http://secret'}};
  const clean=api.sanitizeMenuState(source);
  assert.equal(clean.phase,'ready');assert.equal(clean.bestOf,5);assert.equal(clean.fighters.length,2);
  assert.deepEqual(clean.fighters[0].equipment,{weapon:'spear',defense:'knife'});
  assert.deepEqual(clean.replay,{clips:[{id:4,duration:3.2,complete:true}],active:true,paused:true,speed:.5,position:.7});
  assert.equal(JSON.stringify(clean).includes('secret'),false);
  source.scores[0]=99;source.fighters[0].wins[0]=false;source.fighters[0].equipment.weapon='axe';source.replay.clips[0].duration=90;
  assert.equal(clean.scores[0],2);assert.equal(clean.fighters[0].wins[0],true);assert.equal(clean.fighters[0].equipment.weapon,'spear');
  assert.equal(clean.replay.clips[0].duration,3.2);
  const loadout={slot:1,weapon:'axe',defense:'long',other:{key:'secret'}};
  const normalized=api.normalizeMenuCommand(command('setLoadout',loadout));loadout.weapon='sword';
  assert.deepEqual(normalized.value,{slot:1,weapon:'axe',defense:'long'});
});

test('Estado malformado queda acotado y no expone rutas, URLs, NaN ni listas arbitrarias',()=>{
  const clean=api.sanitizeMenuState({phase:'arbitrary',mode:'root',volume:Infinity,scores:[-5,NaN,3],round:1e12,
    fighters:Array.from({length:90},(_,i)=>({slot:i,name:'x'.repeat(600),guardPercent:1e8,wins:Array(70).fill(true)})),
    replay:{clips:Array.from({length:50},(_,i)=>({id:i+1,duration:Infinity,complete:'yes'})),speed:999,position:999},
    objective:{kind:'training',title:'t'.repeat(2000),instruction:'i'.repeat(10000),progress:999,total:7,nextAction:'execute'},
    message:'Abrí C:\\Users\\Gaston\\secret.txt y https://secret.invalid/?key=abc',rendererError:'file:///D:/private/token.json'});
  assert.equal(clean.phase,'ready');assert.equal(clean.mode,'solo');assert.equal(clean.fighters.length,2);
  assert.equal(clean.replay.clips.length,3);assert.ok(clean.fighters[0].name.length<=64);
  assert.ok(clean.objective.instruction.length<=320);assert.equal(clean.objective.progress,7);assert.equal(clean.objective.nextAction,null);
  assert.ok(clean.round<=9999);assert.ok(clean.replay.position<=1);assert.equal(clean.replay.speed,1);
  assert.equal(/secret|Gaston|private|token\.json/.test(clean.message+clean.rendererError),false);
  assert.ok(!JSON.stringify(clean).includes('NaN'));assert.doesNotThrow(()=>api.sanitizeMenuState(null));
});

test('Estado opcional de assets copia carga, éxito y fallos sin ampliar el DTO con recursos internos',()=>{
  for(const assets of [undefined,null,[],false])assert.equal('assets'in api.sanitizeMenuState({assets}),false);
  const assets={loading:true,ready:2,total:7,names:['Taller','Muñeco menta'],errors:[],gpuBytesApprox:123456,
    urls:['secret'],token:'secret',gpuBuffers:[{secret:true}]};
  const clean=api.sanitizeMenuState({assets});
  assert.deepEqual(clean.assets,{loading:true,ready:2,total:7,names:['Taller','Muñeco menta'],errors:[],gpuBytesApprox:123456});
  assets.names[0]='CAMBIADO';assets.errors.push('Después');assert.equal(clean.assets.names[0],'Taller');assert.deepEqual(clean.assets.errors,[]);
  assert.equal(JSON.stringify(clean).includes('secret'),false);
  assert.deepEqual(api.sanitizeMenuState({assets:{loading:false,ready:7,total:7,names:['Listo'],errors:[],gpuBytesApprox:400}}).assets,
    {loading:false,ready:7,total:7,names:['Listo'],errors:[],gpuBytesApprox:400});
});

test('Assets acota tamaño y números, filtra entradas y omite URLs, rutas y credenciales en las etiquetas de error',()=>{
  const error='Falló https://private.invalid/model.glb?key=abcdef; C:\\Users\\Gaston\\privado.glb /assets/secret.glb key=private-key token:private-token hostToken=private-host '+
    'a'.repeat(40)+' <img src=x onerror=alert(1)> '+'z'.repeat(400);
  const clean=api.sanitizeMenuState({assets:{loading:'true',ready:1e12,total:12.4,
    names:[null,{},...Array.from({length:40},(_,i)=>'Personaje '+i+'x'.repeat(100))],
    errors:[null,123,...Array(30).fill(error)],gpuBytesApprox:Infinity}}).assets;
  assert.ok(clean);assert.equal(clean.loading,false);assert.equal(clean.total,12);assert.equal(clean.ready,12);
  assert.equal(clean.names.length,16);assert.equal(clean.errors.length,12);assert.equal(clean.gpuBytesApprox,0);
  assert.ok(clean.names.every(name=>typeof name==='string'&&name.length<=64));
  assert.ok(clean.errors.every(message=>typeof message==='string'&&message.length<=160));
  assert.doesNotMatch(JSON.stringify(clean),/private|Gaston|privado|secret\.glb|a{40}/);
  assert.deepEqual(api.sanitizeMenuState({assets:JSON.parse(JSON.stringify(clean))}).assets,clean,'Host y relay pueden sanear el mismo DTO sin degradar el estado.');
  const empty=api.sanitizeMenuState({assets:{loading:true,ready:-1,total:NaN,names:'arbitrary',errors:{key:'secret'},gpuBytesApprox:-100}}).assets;
  assert.deepEqual(empty,{loading:true,ready:0,total:0,names:[],errors:[],gpuBytesApprox:0});
});
