import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {projectionModule,wearCorpus,patchValue,WEAR_REFERENCE_SHA} from '../tests/fixtures/combat-wear-corpus-1.11.mjs';
const [reference,current,corpus]=await Promise.all([projectionModule(true),projectionModule(),wearCorpus()]);
const entries=corpus.filter((_,index)=>index%9===4),median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
function run(api){const start=performance.now();let checksum=0;for(const entry of entries){const patch=api.projectForOracle(entry.mark,entry.geometry);if(patch)checksum+=patch.distance+patch.partIndex+patch.indices[0];}return {ms:performance.now()-start,checksum};}
const oracle=entries.map(entry=>patchValue(reference.projectForOracle(entry.mark,entry.geometry)));
if(JSON.stringify(oracle)!==JSON.stringify(entries.map(entry=>patchValue(current.projectForOracle(entry.mark,entry.geometry)))))throw Error('Geometry changed before measurement');
for(let i=0;i<2;i++){run(reference);run(current);}
const pairs=[];
for(let cycle=0;cycle<8;cycle++){
  const a=run(reference),b=run(current),c=run(current),d=run(reference);
  if(a.checksum!==b.checksum||a.checksum!==c.checksum||a.checksum!==d.checksum)throw Error('Projection checksum differs');
  const baseline=(a.ms+d.ms)/2,candidate=(b.ms+c.ms)/2;
  pairs.push({cycle:cycle+1,order:'ABBA',a,b,c,d,baseline,candidate,percent:(baseline-candidate)/baseline*100});
}
const controls=[];for(let i=0;i<8;i++){const a=run(reference),b=run(reference);controls.push({a:a.ms,b:b.ms,percent:Math.abs(a.ms-b.ms)/((a.ms+b.ms)/2)*100});}
const candidateSource=await fs.readFile(new URL('../public/rendering/combat-wear.js',import.meta.url));
const result={scope:'Isolated CPU projection of new real GLB contact marks; not whole-render, GPU or FPS',referenceSHA:WEAR_REFERENCE_SHA,candidateSHA:createHash('sha256').update(candidateSource).digest('hex'),corpusCases:corpus.length,timedCases:entries.length,
  oracleSHA:createHash('sha256').update(JSON.stringify(oracle)).digest('hex'),baselineMedianMs:median(pairs.map(p=>p.baseline)),candidateMedianMs:median(pairs.map(p=>p.candidate)),medianImprovementPercent:median(pairs.map(p=>p.percent)),aaMedianPercent:median(controls.map(p=>p.percent)),aaMaxPercent:Math.max(...controls.map(p=>p.percent)),pairs,controls};
const output=new URL('../.runtime/wear-perf-1.11/paired.json',import.meta.url);await fs.mkdir(new URL('.',output),{recursive:true});await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,pairs:undefined,controls:undefined},null,2));
