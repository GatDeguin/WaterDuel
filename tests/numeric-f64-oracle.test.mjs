import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNumericF64Equal} from './helpers/numeric-f64.mjs';

test('the numeric oracle rejects one ULP, signed-zero changes and NaN replaced by finite values',()=>{
  assert.throws(()=>assertNumericF64Equal([1+Number.EPSILON],[1]),/exact non-NaN Float64 bits/);
  assert.throws(()=>assertNumericF64Equal([-0],[0]),/exact non-NaN Float64 bits/);
  assert.throws(()=>assertNumericF64Equal([0],[NaN]),/NaN position/);
  assert.throws(()=>assertNumericF64Equal([NaN],[0]),/exact non-NaN Float64 bits/);
  assert.throws(()=>assertNumericF64Equal([-Infinity],[Infinity]),/exact non-NaN Float64 bits/);
  assert.throws(()=>assertNumericF64Equal([1,2],[1]),/length/);
  assert.throws(()=>assertNumericF64Equal(new Float64Array([1]),[1]),/array type/);
});

test('the numeric oracle compares NaN locations without altering either raw payload',()=>{
  const raw=new DataView(new ArrayBuffer(16));raw.setBigUint64(0,0x7ff8000000000001n);raw.setBigUint64(8,0xfff8000000000002n);
  const a=[raw.getFloat64(0),1,-0,Infinity],b=[raw.getFloat64(8),1,-0,Infinity];
  const beforeA=Buffer.from(Float64Array.from(a).buffer),beforeB=Buffer.from(Float64Array.from(b).buffer);
  assertNumericF64Equal(a,b);
  assert.deepEqual(Buffer.from(Float64Array.from(a).buffer),beforeA);
  assert.deepEqual(Buffer.from(Float64Array.from(b).buffer),beforeB);
});
