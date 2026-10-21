import assert from 'node:assert/strict';

// JavaScript does not prescribe the sign or payload of an arithmetic NaN.
// Preserve every value and its position; compare all other Float64 bits,
// including signed zero and infinities, without rewriting either input.
export function assertNumericF64Equal(actual,expected,label='Float64 values'){
  assert.equal(Object.getPrototypeOf(actual),Object.getPrototypeOf(expected),label+' array type');
  assert.equal(actual.length,expected.length,label+' length');
  const a=new DataView(Float64Array.from(actual).buffer),b=new DataView(Float64Array.from(expected).buffer);
  for(let i=0;i<expected.length;i++){
    assert.equal(typeof actual[i],'number',`${label}[${i}] numeric type`);
    assert.equal(typeof expected[i],'number',`${label}[${i}] oracle numeric type`);
    if(Number.isNaN(expected[i]))assert.ok(Number.isNaN(actual[i]),`${label}[${i}] NaN position`);
    else assert.equal(a.getBigUint64(i*8),b.getBigUint64(i*8),`${label}[${i}] exact non-NaN Float64 bits`);
  }
}
