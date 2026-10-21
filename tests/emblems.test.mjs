import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceEmblem} from '../public/rendering/emblems.js';
test('pigmento se proyecta sobre triángulos reales y omite huecos sin superficie',()=>{
 const f={slot:1},positions=[-1,-1,.2,1,-1,.2,1,1,.2,-1,-1,.2,1,1,.2,-1,1,.2];
 const m=surfaceEmblem(f,{positions,center:[0,0],scale:[.1,.1]});assert.ok(m.p.length>0);
 for(let i=2;i<m.p.length;i+=3)assert.ok(Math.abs(m.p[i]-.2008)<1e-9);
 assert.equal(surfaceEmblem(f,{positions:[],center:[0,0],scale:[.1,.1]}),m);assert.equal(m.p.length,0);
});
