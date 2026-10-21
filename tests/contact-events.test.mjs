import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';

test('El evento conserva el máximo cierre observado además del último residuo del contacto iterado',()=>{
  const a=new ArticulatedRig({baseX:-1.3}),b=new ArticulatedRig({baseX:1.3,dir:-1});
  a.velocity[4]=1;b.velocity[4]=1;
  const {events}=ArticulatedRig.resolvePair(a,b);
  assert.ok(events.length>0);
  for(const e of events){assert.ok(e.impulse>0);assert.ok(Number.isFinite(e.peakClosingSpeed));assert.ok(e.peakClosingSpeed>=e.closingSpeed);}
  assert.ok(events.some(e=>e.peakClosingSpeed>.3&&e.peakClosingSpeed>5*e.closingSpeed),'el pico inicial no se sustituye por la velocidad residual de convergencia');
});
