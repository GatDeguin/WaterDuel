// A second authored circuit uses the same legal equipment and physical rules.
// Its progress is stored separately so old campaign saves remain byte-compatible.
export const ADVANCED_CAMPAIGN_STORAGE_KEY='water-duel.campaign-advanced.v1';
export const ADVANCED_CAMPAIGN=Object.freeze([
  {name:'La Aguja de Medianoche',arena:'dojo',difficulty:'expert',aiStyle:'counter',opponentLoadout:{weapon:'sword',defense:'knife'},opponentColor:'gold'},
  {name:'La Vigía de Presión',arena:'midnight',difficulty:'expert',aiStyle:'precision',opponentLoadout:{weapon:'spear',defense:'short'},opponentColor:'violet'},
  {name:'El Tallador de Acero',arena:'atelier',difficulty:'expert',aiStyle:'aggressive',opponentLoadout:{weapon:'axe',defense:'knife'},opponentColor:'crimson'},
  {name:'La Custodia del Latón',arena:'dojo',difficulty:'expert',aiStyle:'feint',opponentLoadout:{weapon:'sword',defense:'long'},opponentColor:'cobalt'},
  {name:'El Filo sin Resguardo',arena:'midnight',difficulty:'expert',aiStyle:'aggressive',opponentLoadout:{weapon:'axe',defense:'none'},opponentColor:'rose'},
  {name:'El Péndulo de Cristal',arena:'atelier',difficulty:'expert',aiStyle:'erratic',opponentLoadout:{weapon:'spear',defense:'none'},opponentColor:'amber'},
  {name:'El Maestro de Medianoche',arena:'midnight',difficulty:'boss',aiStyle:'boss',opponentLoadout:{weapon:'maul',defense:'none'},opponentColor:'coral'}
].map(encounter=>Object.freeze({...encounter,opponentLoadout:Object.freeze(encounter.opponentLoadout)})));

export const CAMPAIGN_STARTER_LOADOUT=Object.freeze({weapon:'sword',defense:'none'});

export function campaignArmory(encounters,progress,advancedProgress){
  const weapons={sword:{unlocked:true,rival:''}};
  const defenses={none:{unlocked:true,rival:''}};
  const collect=(circuit,saved)=>{
    const wins=saved.completed?circuit.length:saved.stage;
    for(const [index,encounter] of circuit.entries()){
      const {weapon,defense}=encounter.opponentLoadout;
      for(const [items,id] of [[weapons,weapon],[defenses,defense]]){
        const item=items[id]??={unlocked:false,rival:encounter.name};
        if(index<wins)item.unlocked=true;
      }
    }
  };
  collect(encounters,progress);
  collect(ADVANCED_CAMPAIGN,progress.completed?advancedProgress:{stage:0,completed:false});
  for(const item of [...Object.values(weapons),...Object.values(defenses)])Object.freeze(item);
  return Object.freeze({weapons:Object.freeze(weapons),defenses:Object.freeze(defenses)});
}

export function campaignAllows(loadout,armory){
  return (loadout.weapon==='sword'||armory?.weapons?.[loadout.weapon]?.unlocked===true)&&
    (loadout.defense==='none'||armory?.defenses?.[loadout.defense]?.unlocked===true);
}
