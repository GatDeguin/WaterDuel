import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileEntry} from '../public/entry.js';
test('La entrada táctil abre la arena móvil y el modo PC se puede elegir explícitamente',()=>{
  for(const [options,want] of [
    [{touchPoints:5,coarse:true,hoverNone:true},true],
    [{touchPoints:0,coarse:false,hoverNone:false},false],
    [{touchPoints:5,coarse:false,hoverNone:false},false],
    [{search:'?view=desktop',touchPoints:5,coarse:true,hoverNone:true},false],
    [{search:'?view=mobile'},true],
    [{search:'?slot=1&key=abc'},false],
  ])assert.equal(mobileEntry(options),want);
});
