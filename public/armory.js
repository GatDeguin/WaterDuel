import {WEAPONS,DEFENSES,getWeapon,getDefense} from './equipment.js';

// Workshop silhouettes share the live models' steel, timber and brass vocabulary.
const weaponArt={
  sword:'<path d="M43 49 194 21 51 56Z" fill="#b5c9ca"/><path d="m49 51 137-27" stroke="#f0e9d1"/><ellipse cx="44" cy="53" rx="5" ry="13" transform="rotate(-12 44 53)" fill="#cba568"/><path d="m21 58 19-4" stroke="#805639" stroke-width="9"/><circle cx="17" cy="59" r="5" fill="#cba568"/>',
  spear:'<path d="m18 61 141-31" stroke="#805639" stroke-width="7"/><path d="m50 54 7-2m81-18 9-2" stroke="#cfb27b" stroke-width="9"/><path d="m151 28 46-5-38 17-10-4Z" fill="#b5c9ca"/><path d="m154 33 43-10" stroke="#f0e9d1"/>',
  axe:'<path d="m27 62 128-32" stroke="#936440" stroke-width="10"/><path d="m34 60 24-6" stroke="#634733" stroke-width="12"/><path d="m126 31-7-16q28-8 47 2l-9 18 17 9q-10 23-34 20l-8-24Z" fill="#b5c9ca"/><path d="m174 44q-9 23-34 20" fill="none" stroke="#f0e9d1" stroke-width="3"/><circle cx="138" cy="33" r="6" fill="#cba568"/>',
  maul:'<path d="m27 62 121-29" stroke="#91603d" stroke-width="12"/><path d="m30 61 19-5m17-4 20-5" stroke="#4d3c31" stroke-width="15"/><g transform="rotate(-14 140 33)"><rect x="118" y="9" width="44" height="48" rx="3" fill="#976b41" stroke="#cba568" stroke-width="4"/><path d="M117 13v40m46-40v40" stroke="#b5c9ca" stroke-width="8"/><path d="M133 10v46m14-46v46" stroke="#cba568" stroke-width="4"/><circle cx="140" cy="32" r="4" fill="#e4cd95"/></g>'
};
const defenseArt={
  short:'<circle cx="243" cy="41" r="24" fill="#82603f" stroke="#cba568" stroke-width="4"/><circle cx="243" cy="41" r="10" fill="#cba568"/><path d="M229 26v30m27-30v30" stroke="#b5c9ca" stroke-width="2"/><circle cx="243" cy="41" r="5" fill="#e1cca5"/>',
  long:'<path d="M221 14q22-10 44 0v30q0 17-22 27-22-10-22-27Z" fill="#82603f" stroke="#cba568" stroke-width="4"/><path d="M234 13v48m18-48v48M223 32h40m-39 16h38" stroke="#cba568" stroke-width="3"/><circle cx="243" cy="33" r="6" fill="#b5c9ca"/>',
  knife:'<path d="m228 55 34-36-13 45Z" fill="#b5c9ca"/><path d="m231 55 31-36" stroke="#f0e9d1"/><path d="m224 49 21 15" stroke="#cba568" stroke-width="5"/><path d="m226 58-12 13" stroke="#805639" stroke-width="8"/><circle cx="213" cy="72" r="4" fill="#cba568"/>',
  none:'<circle cx="243" cy="41" r="21" fill="none" stroke="#78948c" stroke-dasharray="3 5"/><path d="M234 41h18" stroke="#78948c" stroke-width="2"/>'
};
function preview(weapon,defense){
  return `<svg viewBox="0 0 290 84" xmlns="http://www.w3.org/2000/svg"><path d="M12 76h266M206 10v64" stroke="#6a806533"/><g>${weaponArt[weapon]}${defenseArt[defense]}</g></svg>`;
}

export function mountArmory(game,onChange){
  const $=id=>document.getElementById(id),swap=$('swapEquipment');
  const views=[1,2].map(slot=>{
    const weapon=$(`weapon${slot}`),defense=$(`defense${slot}`);
    for(const [select,catalog] of [[weapon,WEAPONS],[defense,DEFENSES]]){
      select.replaceChildren(...Object.values(catalog).map(item=>{
        const option=document.createElement('option');option.value=item.id;option.textContent=item.label;return option;
      }));
    }
    const change=()=>{
      if(weapon.disabled)return;
      if(game.setLoadout(slot,{weapon:weapon.value,defense:defense.value}))onChange();
      update();
    };
    weapon.addEventListener('change',change);defense.addEventListener('change',change);
    return {slot,weapon,defense,key:'',preview:$(`equipmentPreview${slot}`),note:$(`equipmentNote${slot}`),lore:$(`equipmentLore${slot}`),stats:$(`equipmentStats${slot}`)};
  });
  swap.addEventListener('click',()=>{
    if(!['ready','matchover'].includes(game.phase)||swap.disabled)return;
    const [a,b]=game.fighters.map(f=>({...f.equipment}));
    game.setLoadout(1,b);game.setLoadout(2,a);onChange();update();
  });
  function update({locked=false,reason=''}={}){
    const configurable=['ready','matchover'].includes(game.phase)&&!locked;
    swap.disabled=!configurable;
    $('armoryStatus').textContent=configurable?'Elegí equipo para cada duelista. Los cambios se ven en la arena.':reason||'Equipo fijado durante la partida. Podés cambiarlo al terminar o reiniciar.';
    $('equipmentLegend2').textContent=`02 · ${game.fighters[1].boss?'EL MAESTRO HIDRÁULICO':game.opponentName||'AMBER ACE'}`;
    for(const view of views){
      const selection=game.fighters[view.slot-1].equipment,w=getWeapon(selection),d=getDefense(selection);
      view.weapon.disabled=!configurable;view.defense.disabled=!configurable||w.twoHanded;
      view.weapon.value=w.id;view.defense.value=d.id;
      const key=`${w.id}:${d.id}`;if(view.key===key)continue;view.key=key;
      view.preview.innerHTML=preview(w.id,d.id);
      view.note.textContent=w.twoHanded?'DOS MANOS · La mano secundaria sostiene el mazo.':`${w.title} · ${d.title}`;
      view.lore.textContent=`${w.lore} ${d.kind==='none'?'':d.description}`.trim();
      const stats=[['ALCANCE',w.length>=1.25?'Largo':w.length<1?'Corto':'Medio'],['RECUPERACIÓN',`${w.cooldown.toFixed(2)} s`],['DEFENSA',w.twoHanded?'Dos manos':d.kind==='knife'?'Parada precisa':d.kind==='none'?'Sin bloqueo':d.id==='long'?'Amplia':'Compacta']];
      view.stats.replaceChildren(...stats.map(([label,value])=>{
        const cell=document.createElement('span'),name=document.createElement('small'),data=document.createElement('b');
        name.textContent=label;data.textContent=value;cell.append(name,data);return cell;
      }));
    }
  }
  return {update};
}
