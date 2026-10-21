import test from 'node:test';
import assert from 'node:assert/strict';
import * as entry from '../public/entry.js';
const {mobileEntry}=entry;
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

test('La PC táctil mantiene la arena; los teléfonos y el iPad conservan mandos aunque tengan mouse',()=>{
  assert.equal(mobileEntry({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',platform:'Win32',touchPoints:10,coarse:true,hoverNone:true,mobileHint:false}),false);
  assert.equal(mobileEntry({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',platform:'MacIntel',touchPoints:0,coarse:false,hoverNone:false}),false);
  assert.equal(mobileEntry({userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel)',platform:'Linux armv8l',touchPoints:5,coarse:false,hoverNone:false,mobileHint:true}),true);
  assert.equal(mobileEntry({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',platform:'MacIntel',touchPoints:5,coarse:false,hoverNone:false}),true);
});

test('La entrada corrige también enlaces móviles antiguos en PC sin bucles ni perder el prefijo del sitio',()=>{
  assert.equal(typeof entry.entryDestination,'function');
  const pc={userAgent:'Windows NT 10.0',touchPoints:0};
  const phone={userAgent:'iPhone',touchPoints:5};
  assert.equal(entry.entryDestination({href:'https://example.com/WaterDuel/?lang=es',...pc}),null);
  assert.equal(entry.entryDestination({href:'https://example.com/WaterDuel/?lang=es',...phone}),'https://example.com/WaterDuel/mobile.html?lang=es');
  assert.equal(entry.entryDestination({href:'https://example.com/WaterDuel/mobile.html?lang=es',mobileDocument:true,...pc}),'https://example.com/WaterDuel/?lang=es');
  assert.equal(entry.entryDestination({href:'https://example.com/WaterDuel/mobile.html?lang=es',mobileDocument:true,...phone}),null);
  const forced=entry.entryDestination({href:'https://example.com/WaterDuel/?view=mobile',...pc});
  assert.equal(forced,'https://example.com/WaterDuel/mobile.html?view=mobile');
  assert.equal(entry.entryDestination({href:forced,mobileDocument:true,...pc}),null);
});
