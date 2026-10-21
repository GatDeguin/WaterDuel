import {normalizeBalloonColor} from './opponent-loadouts.js';
const symbols=Object.freeze({
 mint:{glyph:'◇',name:'Diamante de menta',lines:[[[-1,0],[0,1],[1,0],[0,-1],[-1,0]]]},
 amber:{glyph:'△',name:'Triángulo de ámbar',lines:[[[-1,-.8],[0,1],[1,-.8],[-1,-.8]]]},
 cobalt:{glyph:'≋',name:'Tres ondas de cobalto',lines:[[[-1,.7],[0,.4],[1,.7]],[[-1,0],[0,-.3],[1,0]],[[-1,-.7],[0,-1],[1,-.7]]]},
 violet:{glyph:'○',name:'Anillo violeta',lines:[Array.from({length:13},(_,i)=>[Math.cos(i*Math.PI/6),Math.sin(i*Math.PI/6)])]},
 crimson:{glyph:'✕',name:'Aspa carmesí',lines:[[[-.8,-.8],[.8,.8]],[[-.8,.8],[.8,-.8]]]},
 gold:{glyph:'♛',name:'Corona dorada',lines:[[[-1,.7],[-.6,-.5],[.6,-.5],[1,.7],[.4,.2],[0,1],[-.4,.2],[-1,.7]],[[-.6,-.85],[.6,-.85]]]},
 rose:{glyph:'✳',name:'Roseta del taller',lines:[[[-1,0],[1,0]],[[0,-1],[0,1]],[[-.7,-.7],[.7,.7]],[[-.7,.7],[.7,-.7]]]},
 coral:{glyph:'⊕',name:'Cruz hidráulica',lines:[Array.from({length:13},(_,i)=>[Math.cos(i*Math.PI/6),Math.sin(i*Math.PI/6)]),[[-.6,0],[.6,0]],[[0,-.6],[0,.6]]]}
});
export function fighterIdentity(fighter){const key=normalizeBalloonColor(fighter?.balloonColor,fighter?.slot);return {key,...symbols[key]};}
export function emblemSegments(fighter){return fighterIdentity(fighter).lines.flatMap(line=>line.slice(1).map((to,index)=>({from:line[index],to})));}
