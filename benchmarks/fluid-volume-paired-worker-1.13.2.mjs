import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
const [variant,kind,recipeName,fractionText,candidateURL]=process.argv.slice(2),root=new URL('../',import.meta.url),origin=new URL('public/physics/fluid.js',root),sha=v=>createHash('sha256').update(v).digest('hex');
const recipes={normal:{count:200,scale:1,impactScale:1,areaScale:1,label:'normal native API'},boss260:{count:260,scale:1.16,impactScale:1.16,areaScale:1.16**2,label:'boss dimensions1.16 native API; not full engine'},original260:{count:260,scale:1.18,impactScale:1,areaScale:1,label:'original1.18 diagnostic only'}};
const recipe=recipes[recipeName],source=await fs.readFile(variant==='A'?new URL('../tests/fixtures/fluid-pre-volume-query-1.15.js.txt',import.meta.url):new URL(candidateURL),'utf8');
const code=source.replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_m,p,q,path)=>p+q+new URL(path,origin).href+q);
const {FluidVolume}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const H=1/120,head={x:0,y:2.4,z:.025},impact={x:-.422*recipe.impactScale,y:2.4,z:.025},readPairs=4000;
const make=()=>{const f=new FluidVolume(1,recipe.count,recipe.scale);f.keepContained(head,H,.03,0);f.beginLeak({head,impact,attackDir:1,thrust:.8});return f;};
const advance=f=>{for(let tick=0;tick<72;tick++)f.advanceLeak(H,{head,apertureArea:.04*recipe.areaScale,pressure:.5,time:tick*H});};
const phase=f=>({released:f.released,leaking:f.leaking,count:f.particles.length,free:f.particles.reduce((n,p)=>n+Number(!!p.free),0),elapsed:f.elapsed,steps:f.leakSteps,releasedVolume:f.releasedVolume,retainedVolume:f.retainedVolume});
const stateHash=f=>sha(JSON.stringify({particles:f.particles,leak:f.leakState,stats:f.stats()}));
let fixture=null,setupSteps=0;
if(kind==='readings'){
  fixture=make();const fraction=Number(fractionText);
  while(fixture.releasedParticles.length<recipe.count*fraction){fixture.advanceLeak(H,{head,apertureArea:.04*recipe.areaScale,pressure:.5,time:setupSteps*H});if(++setupSteps>=1500)throw Error('partial fixture did not reach target');}
  if(!fixture.leaking)throw Error('readings fixture must stay partial');
}
process.on('message',message=>{
  try{
    if(message.command==='close'){process.disconnect();return;}
    if(message.command!=='run')return;
    const f=fixture??make(),initial=phase(f),beforeHash=kind==='readings'?stateHash(f):null,start=performance.now();let sum=0;
    if(kind==='readings')for(let i=0;i<readPairs;i++){sum+=f.releasedVolume;sum+=f.retainedVolume;}
    else advance(f);
    const ms=performance.now()-start,final=phase(f),hash=stateHash(f);
    if(beforeHash&&beforeHash!==hash)throw Error('volume reads mutated native particles');
    process.send({id:message.id,ms,sum:kind==='readings'?sum:null,initial,final,stateHash:hash});
  }catch(error){process.send({id:message.id,error:error.stack});}
});
process.send({type:'ready',variant,kind,recipeName,recipe,sourceHash:sha(source),readPairs:kind==='readings'?readPairs:null,setupSteps,fixture:fixture?phase(fixture):null});
