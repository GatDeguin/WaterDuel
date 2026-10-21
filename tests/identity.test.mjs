import test from 'node:test';import assert from 'node:assert/strict';import {fighterIdentity,emblemSegments} from '../public/identity.js';
test('Todos los colores tienen emblemas distintos compartidos por globo, falda y mando',()=>{
 const colors=['mint','amber','cobalt','violet','crimson','gold','rose','coral'];
 assert.equal(new Set(colors.map(balloonColor=>fighterIdentity({balloonColor}).glyph)).size,8);
 for(const balloonColor of colors){const id=fighterIdentity({balloonColor});assert.equal(id.key,balloonColor);assert.ok(id.name);for(const s of emblemSegments({balloonColor}))assert.ok([...s.from,...s.to].every(v=>Number.isFinite(v)&&Math.abs(v)<=1));}
 assert.equal(fighterIdentity({slot:2,balloonColor:'invalid'}).key,'amber');
});
