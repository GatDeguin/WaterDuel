const workshopArrays = ['uWorkshopPositions', 'uWorkshopColors', 'uWorkshopDirections'];
const samplers = [
  'uEnvironment', 'uShadowMap', 'uStaticShadow0', 'uStaticShadow1', 'uStaticShadow2',
  'uAssetBaseMap', 'uAssetNormalMap', 'uAssetMRMap', 'uAssetAOMap', 'uAssetEmissionMap',
  'uAssetSheenColorMap', 'uAssetSheenRoughnessMap',
];

function markerIndex(source, marker) {
  const index = source.indexOf(marker);
  if (index < 0 || source.indexOf(marker, index + marker.length) >= 0) {
    throw Error(`Workshop opaque program expected one shader marker: ${marker}`);
  }
  return index;
}

function replaceOnce(source, before, after = '') {
  const index = markerIndex(source, before);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function stripBefore(source, first, next) {
  const start = markerIndex(source, first);
  const end = markerIndex(source, next);
  if (end <= start) throw Error('Workshop opaque program found reordered shader blocks');
  return source.slice(0, start) + source.slice(end);
}

export function workshopOpaqueFragment(source) {
  source = source.replace(/\r\n/g, '\n');
  markerIndex(source, 'uniform int uWorkshopLightCount;');
  // AssetGPU.draw uses this material palette entry for every glTF draw.
  source = replaceOnce(source, 'uniform int uMaterial;', 'const int uMaterial=21;');
  source = replaceOnce(source, 'uniform bool uAssetEnabled;', 'const bool workshopAssetEnabled=true;');
  source = stripBefore(source, '  if(uOpticalSum){', '  vec3 N=normalize(vN)');
  source = stripBefore(source, '    float alpha=uAssetColor.a', '    rough=uAssetParams.x');
  source = replaceOnce(source, '    base=uAssetColor.rgb*texel.rgb*vAssetColor.rgb;',
    '    base=uAssetColor.rgb*texel.rgb*vAssetColor.rgb;\n    opacity=1.0;');
  source = replaceOnce(source, '  vec3 volumeIncident=vec3(0.0);\n');
  source = replaceOnce(source, '      volumeIncident+=radiance*(.25+.5*abs(dot(N,direction)));\n');
  source = stripBefore(source, '  if(uHasScene&&(water||latex||uMaterial==11)){',
    '  if(uAssetEnabled){\n    if(uAssetTransmission>0.0&&uHasScene){');
  source = stripBefore(source, '    if(uAssetTransmission>0.0&&uHasScene){', '    col+=assetEmission;');
  if (/\bdiscard\s*;|\bgl_FragDepth\b/.test(source)) {
    throw Error('Workshop opaque program still contains a late depth operation');
  }
  return source.replaceAll('uAssetEnabled', 'workshopAssetEnabled');
}

export function createWorkshopOpaqueProgram(gl, baseProgram, baseUniforms, buildProgram, vertex, fragment) {
  const program = buildProgram(gl, vertex, workshopOpaqueFragment(fragment));
  try {
    const U = Object.fromEntries(Object.keys(baseUniforms).map(name => [
      name, gl.getUniformLocation(program, workshopArrays.includes(name) ? `${name}[0]` : name),
    ]));
    gl.useProgram(program);
    for (const name of samplers) {
      if (U[name] != null && baseUniforms[name] != null) gl.uniform1i(U[name], gl.getUniform(baseProgram, baseUniforms[name]));
    }
    return { program, U };
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    gl.useProgram(baseProgram);
  }
}

export function uploadWorkshopLights(gl, U, light) {
  gl.uniform1i(U.uWorkshopLightCount, light?.count ?? 0);
  if (!light) return;
  gl.uniform4fv(U.uWorkshopPositions, light.positions);
  gl.uniform4fv(U.uWorkshopColors, light.colors);
  gl.uniform4fv(U.uWorkshopDirections, light.directions);
  gl.uniform3fv(U.uLamp1, new Float32Array(light.keyPosition));
  const fill = Math.max(0, light.names.findIndex(name => /window/i.test(name)));
  gl.uniform3fv(U.uLamp2, light.positions.subarray(fill * 4, fill * 4 + 3));
}

export function uploadWorkshopOpaqueFrame(renderer, viewProjection, eye, light, time, neutral) {
  const { gl, U, environment, transmission, shadows, staticShadows, staticShadowIndices, staticShadowSizes } = renderer;
  gl.uniformMatrix4fv(U.uVP, false, viewProjection);
  gl.uniform3fv(U.uEye, eye);
  gl.uniform1f(U.uTime, time);
  gl.uniform1i(U.uNeutral, neutral ? 1 : 0);
  gl.uniform1i(U.uHasEnvironment, environment.available ? 1 : 0);
  gl.uniform1i(U.uLinearTarget, transmission.available ? 1 : 0);
  uploadWorkshopLights(gl, U, light);
  gl.uniform1i(U.uHasShadow, shadows.available ? 1 : 0);
  if (shadows.available) {
    gl.uniformMatrix4fv(U.uShadowVP, false, shadows.matrix);
    gl.uniform1f(U.uShadowSize, shadows.size);
  }
  gl.uniform3iv(U.uStaticShadowIndices, staticShadowIndices);
  gl.uniform3fv(U.uStaticShadowSizes, staticShadowSizes);
  for (let i = 0; i < staticShadows.length; i++) {
    if (staticShadowIndices[i] >= 0) gl.uniformMatrix4fv(U[`uStaticShadowVP${i}`], false, staticShadows[i].matrix);
  }
}
