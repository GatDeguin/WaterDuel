import assert from 'node:assert/strict';

const stormFilamentHunks=[
  ['uniform vec4 uAssetEmission;', 'uniform vec3 uAssetEmission;'],
  [
    '    assetEmission=uAssetEmission.rgb;\n'+
    '    // The baked filament material is shared. Pendants start above 3.68 m;\n'+
    '    // the oil lamps and bench filaments end below 1.65 m in runtime space.\n'+
    '    if(uAssetEmission.w<1.0&&vPos.y>3.0)assetEmission*=uAssetEmission.w;',
    '    assetEmission=uAssetEmission;'
  ]
];

// Keep all prior shader bytes pinned outside the two reviewed filament changes.
export function withoutStormFilament(source){
  for(const [after,before] of stormFilamentHunks){
    assert.equal(source.split(after).length-1,1,'unique reviewed storm filament shader hunk');
    source=source.replace(after,before);
  }
  return source;
}
