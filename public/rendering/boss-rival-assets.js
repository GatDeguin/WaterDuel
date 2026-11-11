const styles=['sword','spear','axe'];
const styleOf=part=>part.nodeName.match(/^Rival_(sword|spear|axe)_/)?.[1];

/** Each variant views the same uploaded body buffers and the same atlas. */
export function rivalCharacterEntries(prepared,gpu){
  return Object.fromEntries(styles.map(style=>{
    const parts=[],drawParts=[];
    let armorCount=0,triangleCount=0;
    for(const [index,part] of prepared.parts.entries()){
      const owner=styleOf(part);
      if(owner&&owner!==style)continue;
      if(owner===style)armorCount++;
      parts.push(part);drawParts.push(gpu.parts[index]);triangleCount+=part.indices.length/3;
    }
    if(!armorCount)throw Error(`Falta la armadura del jefe ${style}.`);
    return [style,{prepared:{...prepared,parts,triangleCount},gpu:{...gpu,parts:drawParts}}];
  }));
}

export function puppetAsset(characters,fighter){
  if(fighter.boss)return characters?.[fighter.bossArchetype]??characters?.boss;
  return characters?.[fighter.slot===1?'mint':'amber'];
}
