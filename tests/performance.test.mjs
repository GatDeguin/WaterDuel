import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameMetrics} from '../public/performance.js';

test('La medición conserva picos y distingue media, mínimo y percentil 95',()=>{
  const metrics=new FrameMetrics(20);
  for(let i=0;i<19;i++)metrics.record({frameMs:10,simulationMs:1,renderMs:2,phase:'fight'});
  metrics.record({frameMs:100,simulationMs:8,renderMs:20,phase:'burst'});
  const result=metrics.snapshot();
  assert.equal(result.samples,20);
  assert.equal(result.frameP95Ms,10);
  assert.equal(result.frameMaxMs,100);
  assert.equal(result.fpsMin,10);
  assert.ok(Math.abs(result.fpsMean-1000/14.5)<1e-9);
  assert.equal(metrics.snapshot('burst').frameP95Ms,100);
});

test('Las métricas no inventan datos sin muestras ni memoria no disponible',()=>{
  const metrics=new FrameMetrics(2);
  assert.equal(metrics.snapshot(),null);
  metrics.record({frameMs:NaN});
  assert.equal(metrics.snapshot(),null);
  metrics.record({frameMs:20,simulationMs:1,renderMs:2,phase:'fight'});
  assert.equal(metrics.snapshot().heapPeakBytes,null);
  metrics.record({frameMs:30,simulationMs:1,renderMs:3,phase:'fight',heapBytes:500});
  metrics.record({frameMs:40,simulationMs:1,renderMs:3,phase:'fight',heapBytes:400});
  assert.equal(metrics.snapshot().samples,2);
  assert.equal(metrics.snapshot().frameMaxMs,40);
  assert.equal(metrics.snapshot().heapPeakBytes,500);
});
test('Los impactos, desprendimientos y ruptura conservan picos separados sin incluir pausas',()=>{
 const metrics=new FrameMetrics(4);metrics.markEvent('clang',10);metrics.record({frameMs:45,phase:'fight',now:20,eligible:true});
 metrics.markEvent('joint-break',30);metrics.record({frameMs:60,phase:'fight',now:40,eligible:true});
 metrics.record({frameMs:80,phase:'burst',now:50,eligible:true});metrics.record({frameMs:1000,phase:'fight',now:80,eligible:false});
 assert.equal(metrics.report().clash.frameMaxMs,45);assert.equal(metrics.report().detach.frameMaxMs,60);assert.equal(metrics.report().burst.frameMaxMs,80);
 const slots=metrics.slots.slice();for(let i=0;i<8;i++)metrics.record({frameMs:16,phase:'fight',now:1000+i,eligible:true});
 assert.ok(slots.every((slot,i)=>slot===metrics.slots[i]));assert.equal(metrics.peaks.detach,60);assert.equal(metrics.report().steady.samples,4);
});
