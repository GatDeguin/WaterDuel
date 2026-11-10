import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer3D} from '../public/render3d.js';
import {ARMORY_RACK} from '../public/rendering/armory-display.js';
import {roomCamera} from '../public/rendering/room-camera.js';

const roomInterior={min:[-10.5,.7745,2.4],max:[10.5,6.9,14.3]};
const ready=Object.freeze({phase:'ready',clock:9,phaseClock:0,roomInterior});
const open=Object.freeze({...ready,armoryView:true});

test('La cámara del armero abre y cierra con el reloj de juego congelado',t=>{
  let now=100;
  t.mock.method(performance,'now',()=>now);
  const renderer=Object.create(Renderer3D.prototype);
  const weight=scene=>renderer.armoryCameraProgress(scene,false);
  assert.equal(weight(open),0);
  now+=250;
  const entering=weight(open);
  assert.ok(entering>0&&entering<1);
  now+=1000;
  assert.equal(weight(open),1);
  assert.equal(weight(ready),1);
  now+=250;
  const leaving=weight(ready);
  assert.ok(leaving>0&&leaving<1);
  now+=1000;
  assert.deepEqual(roomCamera({...ready,armoryProgress:weight(ready)}),roomCamera(ready));
  assert.equal(open.clock,ready.clock);
});

test('El encuadre retrato muestra las cuatro esquinas del armero desde dentro del taller',()=>{
  const aspect=9/16,rack=ARMORY_RACK;
  const camera=roomCamera({...open,aspect,armoryProgress:1});
  assert.ok(camera.eye.every((value,i)=>value>=roomInterior.min[i]&&value<=roomInterior.max[i]));
  assert.ok(camera.target[0]>camera.eye[0]);
  const depth=rack.nearX-camera.eye[0],halfHeight=depth*Math.tan(camera.fov/2);
  assert.ok(halfHeight>0);
  for(const y of [rack.y-rack.height/2,rack.y+rack.height/2]){
    for(const z of [rack.z-rack.width/2,rack.z+rack.width/2]){
      assert.ok(Math.abs(y-camera.eye[1])/halfHeight<.9);
      assert.ok(Math.abs(z-camera.eye[2])/(halfHeight*aspect)<.9);
    }
  }
});

test('El combate recupera su cámara aun si queda un pedido de armero anterior',()=>{
  const renderer=Object.create(Renderer3D.prototype);
  assert.equal(renderer.armoryCameraProgress(open,true),1);
  for(const scene of [{...open,phase:'countdown'},{...open,phase:'fight'},{...open,replay:true}]){
    assert.equal(renderer.armoryCameraProgress(scene,false),0);
    assert.deepEqual(roomCamera({...scene,armoryProgress:1}),roomCamera(scene));
  }
});

test('La preferencia de movimiento reducido muestra y cierra el armero de inmediato',()=>{
  const renderer=Object.create(Renderer3D.prototype);
  assert.equal(renderer.armoryCameraProgress(open,true),1);
  assert.equal(renderer.armoryCameraProgress(ready,true),0);
});

test('El mural completo cabe junto al menú lateral y encima del menú vertical',()=>{
  const rack=ARMORY_RACK;
  for(const [aspect,right,bottom] of [[16/9,.48,0],[9/16,0,.58]]){
    const camera=roomCamera({...open,aspect,armoryProgress:1,armoryInset:{right,bottom}});
    const halfHeight=(rack.nearX-camera.eye[0])*Math.tan(camera.fov/2);
    for(const y of [rack.y-rack.height/2,rack.y+rack.height/2]){
      for(const z of [rack.z-rack.width/2,rack.z+rack.width/2]){
        const xNdc=(z-camera.eye[2])/(halfHeight*aspect)+camera.shiftX;
        const yNdc=(y-camera.eye[1])/halfHeight+camera.shiftY;
        assert.ok(xNdc>-1&&xNdc<1-2*right);
        assert.ok(yNdc>-1+2*bottom&&yNdc<1);
      }
    }
  }
});
