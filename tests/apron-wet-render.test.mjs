import test from 'node:test';
import assert from 'node:assert/strict';
import {apronSurfaceOverride} from '../public/rendering/apron-color.js';
test('mojado local de ambos faldones llega al shader sin teñir latón ni mutar material',()=>{
 const part={accessory:'apron',boneName:'pelvis',nodeName:'Woven_Sash',positions:[0,-.2,0,0,.1,0]},material={name:'Mint_Woven_Sash'},fighter={slot:1,pose:{apron:{wetness:{top:0,bottom:.7}}}};
 const result=apronSurfaceOverride(fighter,part,material);assert.equal(result.wetBottom,.7);assert.equal(result.wetTop,0);assert.equal(result.wetMinY,-.2);assert.equal(result.wetMaxY,.1);assert.equal(result.tint,undefined);
 assert.equal(apronSurfaceOverride(fighter,part,{name:'Brass'}),undefined);assert.deepEqual(material,{name:'Mint_Woven_Sash'});
 fighter.pose.apron.wetness.bottom=0;assert.equal(apronSurfaceOverride(fighter,part,material),undefined);
});
