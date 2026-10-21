import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Renderer3D} from '../public/render3d.js';
import {DuelEngine,STEP} from '../public/engine.js';
import {buildFluidSurface} from '../public/physics/surfaces.js';
import {AdaptiveQuality} from '../public/adaptive-quality.js';
function fakeWebGL2(){
  const trace={draws:[],depthMasks:[],uniforms:{},uploads:[],buffers:new Set(),shaders:new Set(),programs:new Set()};
  let depthWrite=true,vao=null;
  const draw=kind=>trace.draws.push({kind,vao,depthWrite,material:trace.uniforms.uMaterial,
    model:trace.uniforms.uModel?.slice(),color:trace.uniforms.uColor?.slice(),opacity:trace.uniforms.uOpacity});
  const values={VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:35713,LINK_STATUS:35714,
    ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,STATIC_DRAW:35044,DYNAMIC_DRAW:35048,
    FLOAT:5126,TRIANGLES:4,UNSIGNED_SHORT:5123,DEPTH_TEST:2929,LEQUAL:515,BLEND:3042,
    SRC_ALPHA:770,ONE_MINUS_SRC_ALPHA:771,CULL_FACE:2884,COLOR_BUFFER_BIT:16384,DEPTH_BUFFER_BIT:256,
    trace,
    createBuffer:()=>{const b={};trace.buffers.add(b);return b;},deleteBuffer:b=>trace.buffers.delete(b),
    createShader:()=>{const s={};trace.shaders.add(s);return s;},deleteShader:s=>trace.shaders.delete(s),
    createProgram:()=>{const p={};trace.programs.add(p);return p;},deleteProgram:p=>trace.programs.delete(p),
    getUniformLocation:(_program,name)=>name,
    uniformMatrix4fv:(name,_transpose,value)=>{trace.uniforms[name]=Array.from(value);},
    uniform3fv:(name,value)=>{trace.uniforms[name]=Array.from(value);},
    uniform1i:(name,value)=>{trace.uniforms[name]=value;},
    uniform1f:(name,value)=>{trace.uniforms[name]=value;},
    bindVertexArray:value=>{vao=value;},
    bufferData:(_target,data)=>{trace.uploads.push({vao,data:Array.from(data),type:data.constructor.name});},
    depthMask:value=>{depthWrite=value;trace.depthMasks.push(value);},
    drawElements:()=>draw('indexed'),drawArrays:()=>draw('dynamic'),drawElementsInstanced:()=>draw('instanced')};
  const fake=new Proxy(values,{get(obj,key){
    if(key in obj)return obj[key];
    if(['createShader','createProgram','createVertexArray','createBuffer','getUniformLocation'].includes(key))return ()=>({});
    if(['getShaderParameter','getProgramParameter'].includes(key))return ()=>true;
    if(['getShaderInfoLog','getProgramInfoLog'].includes(key))return ()=>'';
    if(typeof key==='string')return ()=>{};
    return undefined;
  }});
  return fake;
}
test('Las primitivas tienen winding exterior coherente con las normales para transmisión y reverso',()=>{
  const {render,gl}=scene();
  for(const [name,mesh] of Object.entries(render.mesh)){
    const buffers=gl.trace.uploads.filter(x=>x.vao===mesh.vao),p=buffers[0].data,n=buffers[1].data,ix=buffers[2].data;
    for(let i=0;i<ix.length;i+=3){const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3,
      u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]],cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      const outward=cross.reduce((s,x,k)=>s+x*(n[a+k]+n[b+k]+n[c+k]),0);
      assert.ok(outward>=-1e-8,`${name} triangle ${i/3} faces inward`);
    }
  }
});
test('Disponer el renderer libera buffers de índices y shaders además de los programas',()=>{
  const {render,gl}=scene();render.render(new DuelEngine(),0);render.dispose();
  assert.equal(gl.trace.buffers.size,0);assert.equal(gl.trace.shaders.size,0);assert.equal(gl.trace.programs.size,0);
});
test('Fallar al compilar el postproceso libera también el programa principal ya enlazado',()=>{
  for(const failAt of [1,2,3,4]){
    const gl=fakeWebGL2();let count=0;gl.getShaderParameter=()=>++count!==failAt;
    assert.throws(()=>new Renderer3D({getContext:()=>gl}),/GLSL/);
    assert.equal(gl.trace.programs.size,0);assert.equal(gl.trace.shaders.size,0);assert.equal(gl.trace.buffers.size,0);
  }
});
test('Ondas y película húmeda conservan cobertura fraccional y desvanecimiento separados del volumen líquido',()=>{
  const {render,game,gl}=scene();game.puddleStrength=[.6,0];game.rings=[{x:0,z:0,r:.1,age:0,ttl:1,color:1},{x:1,z:0,r:.1,age:.99,ttl:1,color:1}];
  render.render(game,0);const films=gl.trace.draws.filter(d=>d.material===19);
  assert.equal(films.length,3);const alpha=films.map(d=>d.opacity).sort((a,b)=>a-b);
  for(const [i,expected]of [.0024,.054,.24].entries())assert.ok(Math.abs(alpha[i]-expected)<1e-8);
});
function scene(width=1120,height=690){
  const gl=fakeWebGL2(),canvas={clientWidth:width,clientHeight:height,width,height,getContext:()=>gl};
  globalThis.window={devicePixelRatio:1};
  return {render:new Renderer3D(canvas),game:new DuelEngine(),gl};
}
test('la presentación espera el lote completo y usa fallbacks definitivos si los assets fallan',async()=>{
  const {render,game,gl}=scene(),originalFetch=globalThis.fetch,originalError=console.error,frames=[];
  globalThis.fetch=async()=>{throw Error('GLB no disponible');};console.error=()=>{};
  try{
    await render.loadAssets(status=>{
      gl.trace.draws.length=0;render.render(game,0);frames.push({loading:status.loading,draws:gl.trace.draws.length});
    });
    assert.ok(frames.filter(frame=>frame.loading).length>1);
    assert.ok(frames.filter(frame=>frame.loading).every(frame=>frame.draws===0),'no deben mostrarse versiones parciales durante la carga');
    assert.ok(frames.at(-1).draws>190,'el fallback definitivo se presenta tras resolver todos los assets');
    assert.equal(render.assetStatus.errors.length,11);assert.equal(render.assetStatus.loading,false);
  }finally{globalThis.fetch=originalFetch;console.error=originalError;render.dispose();}
});
test('subir equipo válido no permite presentar una mezcla de versiones a mitad de lote',async()=>{
  const {render,game,gl}=scene(),originalFetch=globalThis.fetch,originalError=console.error,originalBitmap=globalThis.createImageBitmap,frames=[];
  gl.createTexture=()=>({});gl.getParameter=()=>16384;
  const binary=await readFile(new URL('../public/assets/equipment/workshop/sword.glb',import.meta.url));
  globalThis.fetch=async url=>{if(!url.endsWith('.glb'))throw Error('Contrato no disponible');return new Response(binary);};
  globalThis.createImageBitmap=async()=>({width:2,height:2,close(){}});console.error=()=>{};
  try{
    await render.loadAssets(status=>{
      gl.trace.draws.length=0;render.render(game,0);frames.push({loading:status.loading,ready:status.ready,draws:gl.trace.draws.length});
    });
    const partial=frames.filter(frame=>frame.loading&&frame.ready>0);
    assert.ok(partial.length>0,'la prueba debe haber subido equipo real antes de terminar');
    assert.ok(partial.every(frame=>frame.draws===0));assert.equal(render.assetStatus.ready,7);
    assert.ok(frames.at(-1).draws>0);assert.equal(render.assetGPU.models.size,7);
  }finally{globalThis.fetch=originalFetch;globalThis.createImageBitmap=originalBitmap;console.error=originalError;render.dispose();}
});
function project(vp,{x,y,z=0}){
  const clip=[0,1,2,3].map(i=>vp[i]*x+vp[i+4]*y+vp[i+8]*z+vp[i+12]);
  return {x:clip[0]/clip[3],y:clip[1]/clip[3]};
}
test('El renderer WebGL2 construye ambas marionetas, articulaciones, escenario y globos',()=>{
  const canvas={clientWidth:1120,clientHeight:690,width:1120,height:690,getContext:()=>fakeWebGL2()};
  globalThis.window={devicePixelRatio:1};
  const render=new Renderer3D(canvas),game=new DuelEngine();
  assert.ok(game.fighters.every(f=>f.pose?.head),'constructor must create initial poses before first frame');
  render.render(game,.35);
  assert.ok(render.stats.draws>190,`draws=${render.stats.draws}`);
  assert.ok(render.stats.triangles>15000);
});
test('El renderer usa cap, superficie libre y menisco reales dentro de cada globo',()=>{
  const {render,game,gl}=scene();render.render(game,0);
  for(const material of [13,14,15])assert.equal(gl.trace.draws.filter(d=>d.kind==='dynamic'&&d.material===material).length,2,`two liquid meshes for material ${material}`);
  assert.equal(gl.trace.draws.filter(d=>d.vao===render.mesh.sphere.vao&&d.material===9).length,0,'the whole interior ellipsoid must be replaced');
});
test('Las burbujas quedan sumergidas; perforar conserva el volumen retenido y vaciar elimina el interior',()=>{
  const {render,game,gl}=scene();
  for(const f of game.fighters)f.fluid.keepContained(f.pose.head,STEP,.3,.8);
  render.render(game,0);
  const bubbles=gl.trace.draws.filter(d=>d.vao===render.mesh.sphere.vao&&d.material===3);
  assert.ok(bubbles.length>0);
  for(const {model:m} of bubbles){
    const f=game.fighters[m[12]<0?0:1],h=f.pose.head,r=f.fluid.surfaceFrame.rotation;
    const q=[(m[12]-h.x)/.392,(m[13]-h.y)/.456,(m[14]-(h.z??.025))/.365];
    const extent=m[0]*Math.hypot(r[1]/.392,r[4]/.456,r[7]/.365);
    assert.ok(q[0]*r[1]+q[1]*r[4]+q[2]*r[7]+extent<=f.fluid.surfaceFrame.height+1e-5,'air pocket must not cross the liquid plane');
  }
  const volume=game.fighters[1].fluid.volume;game.phase='fight';game.burst(game.fighters[1],game.fighters[0],game.fighters[1].pose.head);
  gl.trace.draws.length=0;render.render(game,0);
  for(const material of [13,14,15])assert.equal(gl.trace.draws.filter(d=>d.kind==='dynamic'&&d.material===material).length,2,'a puncture preserves still-retained water');
  game.fighters[1].fluid.release({head:game.fighters[1].pose.head,impact:game.fighters[1].pose.head});
  gl.trace.draws.length=0;render.render(game,0);
  for(const material of [13,14,15])assert.equal(gl.trace.draws.filter(d=>d.kind==='dynamic'&&d.material===material).length,1,'only the filled fighter retains an interior after complete release');
  assert.equal(game.fighters[1].fluid.volume,volume);
});
test('El renderer dibuja malla líquida dinámica y membrana rasgada después del golpe',()=>{
  const canvas={clientWidth:1150,clientHeight:700,width:1150,height:700,getContext:()=>fakeWebGL2()};
  globalThis.window={devicePixelRatio:1};
  const render=new Renderer3D(canvas),game=new DuelEngine();game.phase='fight';game.resetRound();
  game.burst(game.fighters[1],game.fighters[0],game.fighters[0].pose.tip);
  for(let i=0;i<36;i++)game.update(STEP);
  render.render(game,1.27);
  assert.ok(render.waterSurfaces.get(2)?.mesh.p.length>0);
  assert.ok(render.stats.draws>150);
});

test('Al alcanzar el presupuesto de superficie todas las gotas siguen teniendo representación visible',()=>{
  const {render,game}=scene(),fluid=game.fighters[0].fluid;
  fluid.released=true;
  fluid.particles=Array.from({length:260},(_,i)=>({x:-3.6+(i%19)*.4,y:.35+Math.floor(i/95)*.4,z:-1.2+(Math.floor(i/19)%5)*.6,r:.026})).sort((a,b)=>b.y-a.y);
  game.quality='ultra';
  render.renderLiquid(game,0);
  assert.equal(render.waterSurfaces.get(1).mesh.stats.budgetReached,true);
  const droplets=render.pending.find(item=>item.kind==='instance');
  assert.equal(droplets.particles.length,260);
});
test('adaptive rendering changes only the visual profile and restores the full-size fixed path',()=>{
  const {render,game}=scene(1000,600),control=new AdaptiveQuality(),fluid=game.fighters[0].fluid;
  control.configure('adaptive','high');
  fluid.released=true;
  const count=fluid.particles.length,volume=fluid.initialVolume,quality=game.quality;
  render.render(game,0,control.profile('burst'));
  assert.equal(render.width,860);assert.equal(render.height,516);assert.equal(render.stats.performance.quality,'eco');
  assert.equal(game.quality,quality);assert.equal(fluid.particles.length,count);assert.equal(fluid.initialVolume,volume);
  assert.equal(render.waterSurfaces.get(1).quality,'eco');
  control.configure('fixed',quality);render.render(game,0,control.profile('burst'));
  assert.equal(render.width,1000);assert.equal(render.height,600);assert.equal(render.stats.performance.quality,quality);
  assert.equal(render.waterSurfaces.get(1).quality,quality);assert.equal(fluid.particles.length,count);
});

test('El fallback usa volumen de cada gota y omite la malla truncada',()=>{
  const {render,game,gl}=scene(),fluid=game.fighters[0].fluid;
  fluid.released=true;render.waterSurfaces.set(1,{time:0,count:fluid.releasedParticles.length,quality:game.quality,fluid,mesh:{p:[0,2,0,1,2,0,0,3,0],n:[0,0,1,0,0,1,0,0,1],stats:{budgetReached:true}}});
  render.renderLiquid(game,0);
  assert.equal(render.pending.filter(item=>item.kind==='dynamic').length,0,'an open truncated surface must not overlap the complete fallback');
  const uploads=[];gl.bufferData=(_target,data)=>{if(data instanceof Float32Array)uploads.push(Array.from(data));};
  const volume=fluid.particles[0].volume;
  render.instance('droplet',[{x:0,y:2,z:0,r:.026,volume},{x:1,y:2,z:0,r:.026,volume,wet:true}],0xffffff);
  const data=uploads.find(data=>data.length===8),buffers=gl.trace.uploads.filter(upload=>upload.vao===render.mesh.droplet.vao);
  const p=buffers.find(upload=>upload.type==='Float32Array').data,ix=buffers.find(upload=>upload.type==='Uint16Array').data;
  let unitVolume=0;for(let i=0;i<ix.length;i+=3){const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;unitVolume+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}
  assert.ok(data,'instance radii must reach GPU');
  assert.ok(Math.abs(Math.abs(unitVolume)*data[3]**3/volume-1)<1e-5,'actual tessellated template must represent ledger volume');
  assert.equal(data[7],data[3],'wet particles keep their geometric volume');
});
test('La emisión de paquetes nuevos invalida la superficie antes del intervalo de caché',()=>{
  const {render,game}=scene(),fluid=game.fighters[0].fluid;
  fluid.beginLeak({head:game.fighters[0].pose.head,impact:game.fighters[0].pose.head});
  fluid.advanceLeak(STEP,{head:game.fighters[0].pose.head,apertureArea:1,pressure:1});
  render.renderLiquid(game,0);const first=render.waterSurfaces.get(1);
  fluid.advanceLeak(STEP,{head:game.fighters[0].pose.head,apertureArea:1,pressure:1});
  assert.ok(fluid.releasedParticles.length>first.count);
  render.renderLiquid(game,.001);const next=render.waterSurfaces.get(1);
  assert.equal(next.count,fluid.releasedParticles.length);assert.notEqual(next.mesh,first.mesh);
});

const movingWaterScene=()=>{
  const context=scene(),fluid=context.game.fighters[0].fluid;
  const volume=fluid.particles[0].volume;
  fluid.released=true;fluid.particles=[-.4,0,.4].map(x=>({x,y:2,z:0,volume}));
  return {...context,fluid};
};
const meshBounds=mesh=>{
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  const offset=mesh.offset||{x:0,y:0,z:0},translation=[offset.x,offset.y,offset.z];
  for(let i=0;i<mesh.p.length;i++){const axis=i%3,value=mesh.p[i]+translation[axis];bounds[axis]=Math.min(bounds[axis],value);bounds[axis+3]=Math.max(bounds[axis+3],value);}
  return bounds;
};
test('La superficie que se mueve invalida por distancia antes del plazo y coincide con extracción física fresca',()=>{
  const {render,game,fluid}=movingWaterScene();render.renderLiquid(game,0);const first=render.waterSurfaces.get(1);
  fluid.particles[0].x+=.04;fluid.particles[0].y-=.03;fluid.particles[0].z+=.02;
  render.renderLiquid(game,.001);const next=render.waterSurfaces.get(1);
  assert.ok(next.mesh!==first.mesh,'Una traslación > celda/4 no debe esperar 125 ms');
  const expected=buildFluidSurface(fluid.releasedParticles,{quality:game.quality,domain:{floor:.3245,bounds:3.7,depth:1.31}});
  assert.deepEqual(next.mesh,expected,'La geometría y el ledger deben salir del extractor actual, sin advección de vértices antiguos');
});
test('La cota usa el movimiento acumulado desde la reconstrucción y reutiliza sólo mientras sea subcelda',()=>{
  const {render,game,fluid}=movingWaterScene();render.renderLiquid(game,0);const first=render.waterSurfaces.get(1);
  for(let i=1;i<=3;i++){
    fluid.particles[0].x+=.004;
    render.renderLiquid(game,i*.001);
    assert.equal(render.waterSurfaces.get(1).mesh,first.mesh,'Un movimiento pequeño no exige reconstruir siempre');
  }
  const expected=buildFluidSurface(fluid.releasedParticles,{quality:game.quality,domain:{floor:.3245,bounds:3.7,depth:1.31}});
  const oldBounds=meshBounds(first.mesh),currentBounds=meshBounds(expected);
  assert.ok(Math.max(...oldBounds.map((v,i)=>Math.abs(v-currentBounds[i])))<.03,'El fixture subcelda conserva una cota geométrica de media celda respecto a extracción fresca');
  for(let i=4;i<=5;i++){fluid.particles[0].x+=.004;render.renderLiquid(game,i*.001);assert.equal(render.waterSurfaces.get(1).mesh,first.mesh);}
  fluid.particles[0].x+=.004;render.renderLiquid(game,.006);
  assert.ok(render.waterSurfaces.get(1).mesh!==first.mesh,'Seis microdeformaciones superan el residuo de celda/4 aunque cada frame sea pequeño');
});
test('Una muestra rápida invalida aunque el desplazamiento medio de la nube sea pequeño',()=>{
  const {render,game,fluid}=movingWaterScene();render.renderLiquid(game,0);const first=render.waterSurfaces.get(1);
  fluid.particles[0].z+=.03;render.renderLiquid(game,.001);
  assert.ok(render.waterSurfaces.get(1).mesh!==first.mesh,'La media .01 no debe esconder el desplazamiento máximo .03');
});
test('La tolerancia de caché sigue la componente más fina en cada perfil y no la celda máxima agregada',()=>{
  for(const quality of ['eco','high','ultra']){
    const {render,game,fluid}=movingWaterScene();game.quality=quality;
    fluid.particles[0].volume/=8;fluid.particles[2].volume*=8;
    render.renderLiquid(game,0);const first=render.waterSurfaces.get(1);
    fluid.particles[0].z+=.005;render.renderLiquid(game,.001);
    assert.equal(render.waterSurfaces.get(1).mesh,first.mesh,`${quality} admite .005 dentro de su celda fina`);
    fluid.particles[0].z+=.005;render.renderLiquid(game,.002);
    assert.ok(render.waterSurfaces.get(1).mesh!==first.mesh,`${quality} invalida .01 respecto a la gota fina`);
  }
});
test('Una superficie sin snapshot de movimiento se reconstruye antes de volver a usarla',()=>{
  const {render,game}=movingWaterScene();render.renderLiquid(game,0);const first=render.waterSurfaces.get(1);
  delete first.motion;render.renderLiquid(game,.001);
  assert.ok(render.waterSurfaces.get(1).mesh!==first.mesh,'La ausencia de snapshot no puede desactivar la cota');
});
test('Una traslación común conserva malla, volumen y normales y llega igual a color y profundidad óptica',()=>{
  const {render,game,fluid,gl}=movingWaterScene();render.renderLiquid(game,0);const first=render.waterSurfaces.get(1),positions=first.mesh.p.slice(),normals=first.mesh.n.slice();
  const volume=offset=>{let total=0;for(let i=0;i<positions.length;i+=9){const p=positions.slice(i,i+9).map((v,k)=>v+offset[k%3]);total+=(p[0]*(p[4]*p[8]-p[5]*p[7])+p[1]*(p[5]*p[6]-p[3]*p[8])+p[2]*(p[3]*p[7]-p[4]*p[6]))/6;}return total;};
  render.pending.length=0;
  for(const p of fluid.particles){p.x+=.2;p.y-=.1;p.z+=.05;}
  render.renderLiquid(game,.001);const next=render.waterSurfaces.get(1);
  assert.ok(next.mesh===first.mesh,'Una traslación rígida común no necesita otro extractor');
  assert.deepEqual(next.mesh.p,positions);assert.deepEqual(next.mesh.n,normals);
  assert.ok(Math.abs(next.mesh.offset.x-.2)<1e-12&&Math.abs(next.mesh.offset.y+.1)<1e-12&&Math.abs(next.mesh.offset.z-.05)<1e-12);
  assert.ok(Math.abs(volume([0,0,0])-volume([.2,-.1,.05]))<1e-12,'Trasladar no cambia volumen geométrico');
  render.opticalDepth.available=true;render.transmission.available=true;render.transmission.composite={framebuffer:{}};render.opticalDepth.capture=callback=>callback();
  const models=[],flushDynamic=render.flushDynamic.bind(render);
  render.flushDynamic=item=>{flushDynamic(item);models.push(gl.trace.uniforms.uModel.slice());};
  render.flush();assert.equal(models.length,2,'Se verifican las dos pasadas reales del mismo helper');
  for(const model of models){assert.ok(Math.abs(model[12]-.2)<1e-7&&Math.abs(model[13]+.1)<1e-7&&Math.abs(model[14]-.05)<1e-7);}
});
test('profundidad óptica y color reutilizan una sola subida de la misma geometría, y el cuadro siguiente observa modificaciones',()=>{
  const {render,gl}=scene(),mesh={p:[0,1,0,1,1,0,0,2,0],n:[0,0,1,0,0,1,0,0,1]};
  render.opticalDepth.available=true;render.transmission.available=true;render.transmission.composite={framebuffer:{}};render.opticalDepth.capture=callback=>callback();
  gl.trace.uploads.length=0;gl.trace.draws.length=0;render.dynamicDraw(mesh,0xffffff,9);render.flush();
  assert.equal(gl.trace.draws.length,2,'se conservan profundidad y color');
  assert.equal(gl.trace.uploads.length,2,'posición y normal se transfieren una vez para la pareja de pasadas');
  assert.equal(gl.trace.draws[0].vao,gl.trace.draws[1].vao);
  mesh.p[0]=.125;gl.trace.uploads.length=0;render.dynamicDraw(mesh,0xffffff,9);render.flush();
  assert.equal(gl.trace.uploads.length,2);assert.equal(gl.trace.uploads[0].data[0],.125,'la reutilización no debe ocultar cambios entre cuadros');render.dispose();
});

test('La traslación tangente al piso se reutiliza y la normal que cruzaría el tablero reconstruye el campo recortado',()=>{
  const {render,game,fluid}=movingWaterScene();for(const p of fluid.particles)p.y=.39;
  render.renderLiquid(game,0);const first=render.waterSurfaces.get(1);
  for(const p of fluid.particles)p.x+=.2;render.renderLiquid(game,.001);
  assert.ok(render.waterSurfaces.get(1).mesh===first.mesh,'Deslizar paralelo al piso conserva el dominio');
  assert.ok(Math.abs(first.mesh.offset.x-.2)<1e-12);assert.equal(first.mesh.offset.y,0);
  for(const p of fluid.particles)p.y-=.02;render.renderLiquid(game,.002);
  const next=render.waterSurfaces.get(1);
  assert.ok(next.mesh!==first.mesh,'No se debe trasladar la superficie recortada a través del piso');
  assert.ok(meshBounds(next.mesh)[1]>=.3245-1e-8);
  assert.deepEqual(next.mesh,buildFluidSurface(fluid.releasedParticles,{quality:game.quality,domain:{floor:.3245,bounds:3.7,depth:1.31}}));
});
test('El kernel ampliado conserva todas las caras del dominio al invalidar movimiento normal y permitir el tangente',()=>{
  const cases=[
    {name:'pared X positiva',position:{x:3.49,y:2,z:0},axis:'x',delta:.01,boundIndex:3,bound:3.7,tangent:'y'},
    {name:'pared X negativa',position:{x:-3.49,y:2,z:0},axis:'x',delta:-.01,boundIndex:0,bound:-3.7,tangent:'y'},
    {name:'pared Z positiva',position:{x:0,y:2,z:1.10},axis:'z',delta:.01,boundIndex:5,bound:1.31,tangent:'y'},
    {name:'pared Z negativa',position:{x:0,y:2,z:-1.10},axis:'z',delta:-.01,boundIndex:2,bound:-1.31,tangent:'y'},
    {name:'piso',position:{x:0,y:.5345,z:0},axis:'y',delta:-.01,boundIndex:1,bound:.3245,tangent:'x'}
  ];
  for(const c of cases){
    const {render,game,fluid}=movingWaterScene(),volume=fluid.particles[0].volume;
    fluid.particles=Array.from({length:64},()=>({...c.position,volume}));
    render.renderLiquid(game,0);const first=render.waterSurfaces.get(1);
    assert.ok(first.mesh.stats.kernelScale>1,`${c.name}: el fixture requiere expansión real del kernel`);
    assert.ok(Math.abs(meshBounds(first.mesh)[c.boundIndex]-c.bound)<1e-8,`${c.name}: la malla toca la cara`);
    for(const p of fluid.particles)p[c.axis]+=c.delta;
    render.renderLiquid(game,.001);const next=render.waterSurfaces.get(1);
    assert.ok(next.mesh!==first.mesh,`${c.name}: una cara recortada exige extracción fresca en su normal`);
    assert.ok(Math.abs(next.mesh.stats.targetVolume-volume*64)<1e-12);
    assert.ok(Math.abs(next.mesh.stats.reconstructedVolume/(volume*64)-1)<.01);
    for(const p of fluid.particles)p[c.tangent]+=.02;
    render.renderLiquid(game,.002);
    assert.ok(render.waterSurfaces.get(1).mesh===next.mesh,`${c.name}: la traslación tangente conserva la malla`);
    const b=meshBounds(next.mesh);
    for(const [i,lower]of [-3.7,.3245,-1.31].entries())assert.ok(b[i]>=lower-1e-8,`${c.name}: cara mínima ${i} fuera del dominio`);
    for(const [i,upper]of [3.7,Infinity,1.31].entries())assert.ok(b[i+3]<=upper+1e-8,`${c.name}: cara máxima ${i} fuera del dominio`);
  }
});
test('El renderer transmite la punción real a la geometría de rotura',()=>{
  const {render,game}=scene(),f=game.fighters[1];
  f.globIntact=false;f.balloon.ruptureAge=.12;f.balloon.tearAngle=0;
  const captured=[],original=render.dynamicDraw.bind(render);
  render.dynamicDraw=(mesh,color,material,...args)=>{if(material===10)captured.push(mesh.p.slice());return original(mesh,color,material,...args);};
  f.fluid.impact={x:f.pose.head.x-.422,y:f.pose.head.y,z:.025};render.render(game,0);
  f.fluid.impact={x:f.pose.head.x+.422,y:f.pose.head.y,z:.025};render.render(game,0);
  assert.equal(captured.length,2);assert.ok(captured[0].some((v,i)=>Math.abs(v-captured[1][i])>1e-5),'different punctures must reach the visible tear');
});
test('El renderer conserva la punción local al trasladar explícitamente la membrana y su soporte',()=>{
  const {render,game}=scene(),f=game.fighters[1],h=f.pose.head;
  game.phase='fight';game.burst(f,game.fighters[0],{x:h.x-.422,y:h.y,z:.025});f.balloon.ruptureAge=.12;
  const captured=[],original=render.dynamicDraw.bind(render);
  render.dynamicDraw=(mesh,color,material,...args)=>{if(material===10)captured.push(mesh.p.slice());return original(mesh,color,material,...args);};
  render.render(game,0);f.pose.head={...h,y:h.y-.4};f.membrane.attach(f.pose.head);render.render(game,0);
  assert.equal(captured.length,2);
  for(let i=0;i<captured[0].length;i++)assert.ok(Math.abs(captured[1][i]-captured[0][i]-(i%3===1?-.4:0))<1e-9,'falling must translate the same local tear');
});

test('El disco defensivo visible coincide con el centro y radio de parada de ambos jugadores',()=>{
  for(const guard of [false,true]){
    const {render,game,gl}=scene();
    for(const f of game.fighters){f.guard=guard;game.buildPose(f);}
    render.render(game,0);
    const disks=gl.trace.draws.filter(d=>d.vao===render.mesh.cylinder.vao && Math.abs(d.model[14]-.03)<1e-6
      && d.material===1 && Math.abs(d.model[6])>.04);
    assert.equal(disks.length,2);
    for(let i=0;i<2;i++){
      const {offHand,shieldRadius}=game.fighters[i].pose,m=disks[i].model;
      assert.ok(Math.abs(m[12]-offHand.x)<1e-6,'shield center must match the collision disk');
      assert.ok(Math.abs(m[13]-offHand.y)<1e-6);
      assert.ok(Math.abs(m[0]-shieldRadius)<1e-6,'visible horizontal radius must cover the parry disk');
      assert.ok(Math.abs(Math.abs(m[9])-shieldRadius)<1e-6,'visible vertical radius must cover the parry disk');
    }
  }
});

test('Los cuatro pies descansan sobre las tablas sin cambiar las poses de la simulación',()=>{
  const {render,game,gl}=scene();
  const feetBefore=game.fighters.map(f=>structuredClone([f.pose.footF,f.pose.footB]));
  render.render(game,0);
  const feet=gl.trace.draws.filter(d=>d.vao===render.mesh.box.vao && Math.abs(d.model[0]-.42)<1e-6
    && Math.abs(d.model[5]-.12)<1e-6 && Math.abs(d.model[10]-.25)<1e-6);
  assert.equal(feet.length,4);
  for(const {model:m} of feet){
    const bottom=m[13]-m[5]/2;
    assert.ok(bottom>=.32449 && bottom<=.3295,`foot bottom ${bottom} must rest on the stage at .3245`);
  }
  assert.deepEqual(game.fighters.map(f=>[f.pose.footF,f.pose.footB]),feetBefore);
});

test('Toda la pasada transparente mantiene depthMask(false), incluso tras lotes de gotas',()=>{
  const {render,gl}=scene();
  render.pending.push({kind:'instance',particles:[{x:0,y:2,z:0,r:.03}],color:0xffffff,material:3,opacity:.7,order:0,depth:0});
  render.sphere(0,2,0,.4,.5,.4,0x21b79b,2,.8);
  render.pending.push({kind:'instance',particles:[{x:1,y:2,z:0,r:.03}],color:0xffffff,material:3,opacity:.7,order:2,depth:0});
  render.flush();
  assert.equal(gl.trace.draws.length,3);
  assert.ok(gl.trace.draws.every(d=>d.depthWrite===false),'no transparent draw may write depth');
  assert.deepEqual(gl.trace.depthMasks,[false,true],'only the pass changes depth writing');
  render.box(0,1,0,.2,.2,.2,0xaaaaaa);
  assert.equal(gl.trace.draws.at(-1).depthWrite,true,'opaque drawing is restored after the transparent pass');
});

test('La película rasgada resuelta conserva el pliegue más cercano sin dar profundidad a gotas posteriores',()=>{
  const {render,gl}=scene();render.transmission.available=true;
  render.sphere(0,2,0,.4,.5,.4,0x21b79b,10,.8);
  render.pending.push({kind:'instance',particles:[{x:1,y:2,z:0,r:.03}],color:0xffffff,material:3,opacity:.7,order:2,depth:0});
  render.flush();
  assert.equal(gl.trace.draws.find(x=>x.material===10).depthWrite,true);
  assert.equal(gl.trace.draws.find(x=>x.material===3).depthWrite,false);
});

test('La cámara de combate no deriva con el tiempo ni sigue los movimientos del muñeco',()=>{
  const {render,game,gl}=scene();game.phase='fight';
  render.render(game,0);
  const firstVP=gl.trace.uniforms.uVP.slice(),firstEye=gl.trace.uniforms.uEye.slice();
  game.fighters[0].lean=.8;game.buildPose(game.fighters[0]);
  render.render(game,10);
  assert.deepEqual(gl.trace.uniforms.uEye,firstEye);
  assert.deepEqual(gl.trace.uniforms.uVP,firstVP);
});

test('El renderer aplica la cámara por reloj simulado, expone diagnóstico y respeta movimiento reducido',()=>{
  const {render,game,gl}=scene();game.phase='fight';render.render(game,0);
  const frontal=gl.trace.uniforms.uEye.slice();
  game.phase='ready';game.clock=18;render.render(game,0);
  assert.notDeepEqual(gl.trace.uniforms.uEye,frontal);assert.ok(render.stats.camera.motionWeight>0);assert.equal(render.stats.camera.detail,false);
  const idle=gl.trace.uniforms.uEye.slice();render.render(game,1000);assert.deepEqual(gl.trace.uniforms.uEye,idle,'render time must not advance the camera');
  game.reducedMotion=true;render.render(game,1000);assert.deepEqual(gl.trace.uniforms.uEye,frontal);assert.equal(render.stats.camera.motionWeight,0);
  game.reducedMotion=false;game.phase='countdown';game.phaseClock=2.4;render.render(game,1000);assert.deepEqual(gl.trace.uniforms.uEye,frontal);
});
test('La cámara de detalle acerca la inspección y queda bloqueada en combate y cuenta atrás',()=>{
  const {render,game,gl}=scene();game.phase='fight';render.render(game,0);
  const combatVP=gl.trace.uniforms.uVP.slice(),head=game.fighters[0].pose.head;
  const baseTop=project(combatVP,{x:head.x,y:head.y+.6}),baseBottom=project(combatVP,{x:head.x,y:head.y-.4});
  game.phase='ready';game.cameraMode='detail';render.render(game,0);
  const detailTop=project(gl.trace.uniforms.uVP,{x:head.x,y:head.y+.6}),detailBottom=project(gl.trace.uniforms.uVP,{x:head.x,y:head.y-.4});
  assert.ok(detailTop.y-detailBottom.y>(baseTop.y-baseBottom.y)*1.3,'inspection must enlarge the head');
  for(const phase of ['fight','countdown']){game.phase=phase;game.phaseClock=2.4;render.render(game,0);assert.deepEqual(gl.trace.uniforms.uVP,combatVP,'active play must keep the settled combat view');}
});
test('La iluminación neutral se solicita al shader y no cambia la geometría ni el resultado',()=>{
  const {render,game,gl}=scene();render.render(game,0);
  const draws=render.stats.draws,scores=game.scores.slice();assert.equal(gl.trace.uniforms.uNeutral,0);
  game.lightingMode='neutral';render.render(game,0);
  assert.equal(gl.trace.uniforms.uNeutral,1);assert.equal(render.stats.draws,draws);assert.deepEqual(game.scores,scores);
  game.lightingMode='cinematic';render.render(game,0);assert.equal(gl.trace.uniforms.uNeutral,0);
});

test('El encuadre cambia continuamente al cruzar una proporción casi cuadrada',()=>{
  const {render,game,gl}=scene(734,700);game.phase='fight';
  render.render(game,0);
  const before=project(gl.trace.uniforms.uVP,{x:1.53,y:3.1});
  render.canvas.clientWidth=736;render.render(game,0);
  const after=project(gl.trace.uniforms.uVP,{x:1.53,y:3.1});
  assert.ok(Math.abs(after.x-before.x)<.01 && Math.abs(after.y-before.y)<.01,'two pixels of resize must not jump the camera');
});

test('En horizontal los luchadores ocupan al menos la mitad de la altura útil de pantalla',()=>{
  const {render,game,gl}=scene(1120,690);game.phase='fight';
  render.render(game,0);
  const head=game.fighters[0].pose.head,vp=gl.trace.uniforms.uVP;
  const top=project(vp,{x:head.x,y:head.y+.61,z:.025});
  const bottom=project(vp,{x:game.fighters[0].pose.footF.x,y:.3245,z:.29});
  assert.ok(top.y-bottom.y>1,'full-body silhouette must occupy more than half of the viewport height');
});

test('El plano frontal mantiene cabezas, defensa y pies completos con margen libre',()=>{
  for(const [width,height] of [[1920,1080],[1120,690],[734,700],[390,440],[320,440]]){
    const {render,game,gl}=scene(width,height);game.phase='fight';game.setDifficulty('boss');
    for(const lean of [-.9,0,.9]){
      for(const f of game.fighters){f.lean=lean;f.guard=true;f.offX=1;f.offY=1;game.buildPose(f);}
      render.render(game,0);
      const vp=gl.trace.uniforms.uVP;
      for(const f of game.fighters){
        const p=f.pose,s=f.balloonSize;
        const points=[{x:p.head.x,y:p.head.y+.61*s,z:.025},{x:p.head.x-.45*s,y:p.head.y,z:.025},
          {x:p.head.x+.45*s,y:p.head.y,z:.025},{x:p.offHand.x-f.pose.shieldRadius,y:p.offHand.y,z:.10},
          {x:p.offHand.x+f.pose.shieldRadius,y:p.offHand.y,z:.10},
          {x:p.footF.x+.26,y:.3245,z:p.footF.z},{x:p.footB.x-.26,y:.3245,z:p.footB.z}];
        for(const point of points){
          const screen=project(vp,point);
          assert.ok(Math.abs(screen.x)<.94 && screen.y>-.84 && screen.y<.66,
            `${width}x${height}, lean ${lean}: point ${JSON.stringify(point)} projected to ${JSON.stringify(screen)}`);
        }
      }
    }
  }
});
