import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const source=read('../public/render3d.js');
const beforeDamage=read('../audit/baselines/render3d-pre-joint-damage-1.5.js');
const preAdaptive=read('../audit/adaptive-quality-post1.4.1/baseline/render3d.js');
const before=read('../audit/baselines/render3d-pre-color-culling-post1.4.js');
const fragment=text=>text.slice(text.indexOf('const frag=`'),text.indexOf('function compile('));
const main=text=>fragment(text).slice(fragment(text).indexOf('void main(){'));
const oldVariance='float normalVariance=max(dot(dFdx(N),dFdx(N)),dot(dFdy(N),dFdy(N)));';
const geometricFootprint=[
  '  // Geometric footprint precedes detail/discard: GLSL ES 3.00, 8.9.',
  '  vec3 geometricDx=dFdx(N),geometricDy=dFdy(N);',
  '  float geometricNormalVariance=max(dot(geometricDx,geometricDx),dot(geometricDy,geometricDy));',
];
// The shader's historical correction remains byte-for-byte unchanged. Account
// explicitly for the three render-only additions in the pinned pre-damage
// renderer. New limb topology is separately checked against original healthy
// draw bytes in joint-damage-render.test.mjs. The explicitly reviewed 1.7
// wet-cloth and disjoint-liquid additions are reversed exactly below, so every
// historical BRDF, map and detail byte outside those additions stays protected.
const v17Hunks=JSON.parse(read('./fixtures/shader-v17-hunks.json')).hunks;
function withoutV17Shader(text){
  let value=fragment(text).replaceAll('\r\n','\n');
  for(const {before,after}of v17Hunks){assert.ok(after.length>0);assert.equal(value.split(after).length-1,1,'unique reviewed 1.7 shader hunk');value=value.replace(after,before);}
  return value;
}
function withoutAdaptiveRendering(text){
  let value=text.replaceAll('\r\n','\n');
  const patches=[
    ["import {renderQualityView} from './adaptive-quality.js';\n",''],
    ['Math.min(window.devicePixelRatio||1,this.quality)*(this.renderScale??1)','Math.min(window.devicePixelRatio||1,this.quality)'],
    [" render(game,time,profile=null){\n  this.renderScale=profile?.renderScale??1;\n  game=renderQualityView(game,profile);\n  this.stats.performance={mode:profile?.mode??'fixed',level:profile?.level??0,quality:game.quality,renderScale:this.renderScale};\n  const gl=this.gl,U=this.U;this.resize();this.stats.draws=0;this.stats.triangles=0;this.renderTime=time;",
      ' render(game,time){const gl=this.gl,U=this.U;this.resize();this.stats.draws=0;this.stats.triangles=0;this.renderTime=time;'],
  ];
  for(const [from,to]of patches){assert.equal(value.split(from).length-1,1,'unique authorized adaptive hunk');value=value.replace(from,to);}
  return value;
}

// Inspect the dependency/order of the actual shader expression. This is not a
// rasterizer: compilation and image acceptance remain a separate GPU check.
function inspectVariance(text){
  const body=main(text),variance=/\bfloat normalVariance=([^;]+);/.exec(body);
  assert.ok(variance,'normal variance exists');
  assert.match(variance[1],/^\w+$/,'the late filter must consume a saved footprint, not re-derive detailed N');
  const saved=variance[1],kernel=new RegExp(`\\bfloat ${saved}=max\\(dot\\((\\w+),\\1\\),dot\\((\\w+),\\2\\)\\);`).exec(body);
  assert.ok(kernel,'saved footprint uses the same max of squared x/y differences');
  const positions=[kernel.index];
  for(const [name,axis]of [[kernel[1],'x'],[kernel[2],'y']]){
    const derivative=new RegExp(`\\b${name}=dFd${axis}\\((\\w+)\\)`).exec(body);
    assert.ok(derivative,`${axis} is a direct first derivative, without a nested derivative or bump`);
    const normal=derivative[1],prefix=body.slice(0,derivative.index);
    assert.match(prefix,new RegExp(`\\bvec3 ${normal}=normalize\\(vN\\)`),'derivative input comes directly from the interpolated vertex normal');
    assert.equal([...prefix.matchAll(new RegExp(`\\b${normal}\\s*=(?!=)`,'g'))].length,1,'normal has not yet been flipped, bumped or normal mapped');
    positions.push(derivative.index);
  }
  return {body,positions,lateVariance:variance.index};
}

test('la varianza deriva sólo la normal interpolada antes de modificar N',()=>{
  inspectVariance(source);
});

test('las derivadas del filtro preceden alpha discard y todo bump/normal mapping',()=>{
  const {body,positions,lateVariance}=inspectVariance(source);
  const barriers=[body.indexOf('discard;'),body.indexOf('N=bumpSurface('),body.indexOf('N=normalize(normalize(tangent)')];
  assert.ok(barriers.every(index=>index>=0),'actual shader still includes alpha masking, procedural bump and normal mapping');
  for(const position of positions)assert.ok(position<Math.min(...barriers),'all footprint calculations dominate divergent alpha discard and detail');
  assert.ok(lateVariance>Math.max(...positions),'roughness consumes the already saved footprint');
});

test('el contrato rechaza volver a derivar el bump o mover la huella después del descarte',()=>{
  const good=before.replace('vec3 N=normalize(vN),V=normalize(uEye-vPos);',
    ['vec3 N=normalize(vN),V=normalize(uEye-vPos);',...geometricFootprint].join('\n')).replace(oldVariance,'float normalVariance=geometricNormalVariance;');
  assert.doesNotThrow(()=>inspectVariance(good));
  assert.throws(()=>inspectVariance(good.replace('geometricDx=dFdx(N)','geometricDx=dFdx(bumpSurface(N,0.0,1.0))')),/direct first derivative/);
  const delayed=good.replace(geometricFootprint.join('\n')+'\n','').replace('float normalVariance=geometricNormalVariance;',geometricFootprint.join('\n')+'\n  float normalVariance=geometricNormalVariance;');
  assert.throws(()=>inspectVariance(delayed),/normal has not yet/);
});

test('fuera del origen de la varianza se conservan N detallada, amplitudes, mapas, roughness y BRDF',()=>{
  assert.equal(createHash('sha256').update(beforeDamage).digest('hex'),'cdb2534920ee7a791ecb765d93885ce8f8bf16c9e358ac595ba6d52362f80f47');
  assert.equal(createHash('sha256').update(before).digest('hex'),'0504816e848e1882bb9fea4fd357ead986156197f91cf9bb860873288848cc81');
  const normalized=text=>text.replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(preAdaptive).digest('hex'),'2d34f8211ea0a6a78223e4c36b9af0e924f781d114a28e5d0fb3515b67a2d673');
  assert.equal(withoutAdaptiveRendering(beforeDamage),normalized(preAdaptive),'the pre-damage renderer contains only the explicit adaptive hooks');
  withoutAdaptiveRendering(source); // Each actual adaptive hook is still unique and exact.
  assert.equal(withoutV17Shader(source),fragment(preAdaptive).replaceAll('\r\n','\n'),'outside reviewed 1.7 additions the actual shader is unchanged by adaptive rendering');
  const original=normalized(before),current=normalized(preAdaptive);
  const restored=current.replace(geometricFootprint.join('\n')+'\n','').replace('float normalVariance=geometricNormalVariance;',oldVariance);
  assert.equal(restored,original,'the only renderer delta is moving the derivative source before shading detail');
  assert.doesNotMatch(source,/\btransmissionColorCulling\b/,'the rejected culling candidate has no product option or branch');
});

test('el baseline sin culling incorpora únicamente la misma corrección geométrica aislada',()=>{
  const normalized=text=>text.replaceAll('\r\n','\n');
  const corrected=normalized(read('../audit/baselines/render3d-geometric-variance-no-color-culling-post1.4.js'));
  const restored=corrected.replace(geometricFootprint.join('\n')+'\n','').replace('float normalVariance=geometricNormalVariance;',oldVariance);
  assert.equal(restored,normalized(before),'0504816e remains the source of the corrected product baseline');
  assert.equal(createHash('sha256').update(preAdaptive).digest('hex'),'2d34f8211ea0a6a78223e4c36b9af0e924f781d114a28e5d0fb3515b67a2d673');
  assert.equal(corrected,withoutAdaptiveRendering(beforeDamage),'the pinned pre-damage renderer recovers the geometric-only baseline');
  assert.equal(withoutV17Shader(source),fragment(beforeDamage).replaceAll('\r\n','\n'),'outside reviewed 1.7 additions joint rendering preserves the corrected shader byte for byte');
});

test('la autorización 1.7 rechaza cambios ajenos al detalle y cambios no revisados dentro del hunk',()=>{
  const changed=source.replace('pores*.003,.12','pores*.004,.12');assert.notEqual(changed,source);
  assert.notEqual(withoutV17Shader(changed),fragment(preAdaptive).replaceAll('\r\n','\n'),'una alteración de amplitud sigue detectándose fuera de los nuevos hunks');
  const changedWet=source.replace('base*=1.0-.32*damp','base*=1.0-.5*damp');assert.notEqual(changedWet,source);
  assert.throws(()=>withoutV17Shader(changedWet),/unique reviewed/,'no se acepta cualquier versión de la nueva humedad');
});
