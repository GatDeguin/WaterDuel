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
