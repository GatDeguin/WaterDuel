// The story, the advanced campaign and the boss circuit have separate saves.
export const ADVANCED_CAMPAIGN_STORAGE_KEY='water-duel.campaign-advanced.v1';
export const BOSS_CAMPAIGN_STORAGE_KEY='water-duel.campaign-bosses.v1';
export const CAMPAIGN_TIERS=Object.freeze(['normal','advanced','bosses']);
const encounter=data=>Object.freeze({...data,opponentLoadout:Object.freeze(data.opponentLoadout)});
const boss=data=>encounter({...data,difficulty:'boss',aiStyle:'boss'});
export const HYDRAULIC_MASTER=boss({name:'El Maestro Hidráulico',arena:'atelier',weather:'storm',
  opponentLoadout:{weapon:'maul',defense:'none'},opponentColor:'coral'});
const marshal=boss({name:'El Mariscal de Latón',arena:'atelier',weather:'sunset',
  opponentLoadout:{weapon:'sword',defense:'knife'},opponentColor:'gold',bossArchetype:'sword'});
const sentinel=boss({name:'El Centinela de Presión',arena:'midnight',weather:'full-moon',
  opponentLoadout:{weapon:'spear',defense:'short'},opponentColor:'cobalt',bossArchetype:'spear'});
const serradora=boss({name:'La Serradora Carmesí',arena:'dojo',weather:'rain',
  opponentLoadout:{weapon:'axe',defense:'long'},opponentColor:'crimson',bossArchetype:'axe'});
export const BOSS_CAMPAIGN=Object.freeze([encounter({...marshal,weather:'night'}),sentinel,serradora,HYDRAULIC_MASTER]);

// These six positions are the order written by the original version-1 save.
const veteran=(legacyIndex,data)=>encounter({...data,legacyIndex});
const aguja=veteran(0,{name:'La Aguja del Taller',arena:'atelier',weather:'sun',difficulty:'rookie',aiStyle:'aggressive',opponentLoadout:{weapon:'sword',defense:'short'},opponentColor:'amber'});
const guardian=veteran(1,{name:'El Guardián de Roble',arena:'dojo',weather:'sunset',difficulty:'normal',aiStyle:'defender',opponentLoadout:{weapon:'axe',defense:'long'},opponentColor:'cobalt'});
const eco=veteran(2,{name:'El Eco de Acero',arena:'midnight',weather:'night',difficulty:'normal',aiStyle:'counter',opponentLoadout:{weapon:'sword',defense:'knife'},opponentColor:'violet'});
const sombra=veteran(3,{name:'La Sombra de Latón',arena:'atelier',weather:'rain',difficulty:'normal',aiStyle:'feint',opponentLoadout:{weapon:'axe',defense:'short'},opponentColor:'crimson'});
const punta=veteran(4,{name:'La Punta de Cristal',arena:'dojo',weather:'snow',difficulty:'expert',aiStyle:'precision',opponentLoadout:{weapon:'spear',defense:'knife'},opponentColor:'gold'});
const pendulo=veteran(5,{name:'El Péndulo Salvaje',arena:'midnight',weather:'full-moon',difficulty:'expert',aiStyle:'erratic',opponentLoadout:{weapon:'spear',defense:'long'},opponentColor:'rose'});
const guardavalvulas=encounter({name:'El Guardaválvulas',arena:'midnight',weather:'night',difficulty:'expert',aiStyle:'defender',
  opponentLoadout:{weapon:'sword',defense:'long'},opponentColor:'amber'});

const chapter=(title,subjects,leader)=>Object.freeze({title,subjects:Object.freeze(subjects),boss:leader});
export const STORY_CHAPTERS=Object.freeze([
  chapter('La Guardia de Latón',[aguja,eco],marshal),
  chapter('La Orden de Presión',[punta,pendulo],sentinel),
  chapter('La Forja Carmesí',[guardian,sombra],serradora),
  chapter('La Cámara Hidráulica',[guardavalvulas],HYDRAULIC_MASTER)
]);
export const CAMPAIGN=Object.freeze(STORY_CHAPTERS.flatMap(({subjects,boss},chapterIndex)=>
  [...subjects,boss].map((entry,index)=>Object.freeze({...entry,chapter:chapterIndex+1,position:index+1,
    chapterLength:subjects.length+1,role:index<subjects.length?'subject':'boss'}))));

export const LEGACY_STORY_FINAL=6;
const inheritedSubject=(entry,legacyStage)=>entry.legacyIndex<legacyStage;
export function nextStoryStage(stage,legacyStage=0){
  const final=CAMPAIGN.length-1;
  while(stage<final&&inheritedSubject(CAMPAIGN[stage],legacyStage))stage++;
  return stage;
}
export function storyWins(progress){
  if(progress.completed)return CAMPAIGN.length;
  let wins=progress.stage;
  if(progress.legacyStage)for(let i=progress.stage;i<CAMPAIGN.length;i++)if(inheritedSubject(CAMPAIGN[i],progress.legacyStage))wins++;
  return wins;
}
export const ADVANCED_CAMPAIGN=Object.freeze([
  {name:'La Aguja de Medianoche',arena:'dojo',weather:'night',difficulty:'expert',aiStyle:'counter',opponentLoadout:{weapon:'sword',defense:'knife'},opponentColor:'gold'},
  {name:'La Vigía de Presión',arena:'midnight',weather:'snow',difficulty:'expert',aiStyle:'precision',opponentLoadout:{weapon:'spear',defense:'short'},opponentColor:'violet'},
  {name:'El Tallador de Acero',arena:'atelier',weather:'sun',difficulty:'expert',aiStyle:'aggressive',opponentLoadout:{weapon:'axe',defense:'knife'},opponentColor:'crimson'},
  {name:'La Custodia del Latón',arena:'dojo',weather:'sunset',difficulty:'expert',aiStyle:'feint',opponentLoadout:{weapon:'sword',defense:'long'},opponentColor:'cobalt'},
  {name:'El Filo sin Resguardo',arena:'midnight',weather:'full-moon',difficulty:'expert',aiStyle:'aggressive',opponentLoadout:{weapon:'axe',defense:'none'},opponentColor:'rose'},
  {name:'El Péndulo de Cristal',arena:'atelier',weather:'rain',difficulty:'expert',aiStyle:'erratic',opponentLoadout:{weapon:'spear',defense:'none'},opponentColor:'amber'},
  {name:'El Maestro de Medianoche',arena:'midnight',weather:'storm',difficulty:'boss',aiStyle:'boss',opponentLoadout:{weapon:'maul',defense:'none'},opponentColor:'coral'}
].map(encounter));

export const CAMPAIGN_STARTER_LOADOUT=Object.freeze({weapon:'sword',defense:'none'});

export function campaignArmory(encounters,progress,advancedProgress,bossProgress={stage:0,completed:false},bossesFirst=false){
  const weapons={sword:{unlocked:true,rival:''}};
  const defenses={none:{unlocked:true,rival:''}};
  const collect=(circuit,saved,story=false)=>{
    const wins=saved.completed?circuit.length:saved.stage;
    for(const [index,encounter] of circuit.entries()){
      const {weapon,defense}=encounter.opponentLoadout;
      for(const [items,id] of [[weapons,weapon],[defenses,defense]]){
        const item=items[id]??={unlocked:false,rival:encounter.name};
        if(index<wins||story&&(inheritedSubject(encounter,saved.legacyStage)||saved.legacyCompleted&&index===circuit.length-1))item.unlocked=true;
      }
    }
  };
  if(bossesFirst)collect(BOSS_CAMPAIGN,bossProgress);
  collect(encounters,progress,true);
  collect(ADVANCED_CAMPAIGN,progress.completed||progress.legacyCompleted?advancedProgress:{stage:0,completed:false});
  if(!bossesFirst)collect(BOSS_CAMPAIGN,bossProgress);
  for(const item of [...Object.values(weapons),...Object.values(defenses)])Object.freeze(item);
  return Object.freeze({weapons:Object.freeze(weapons),defenses:Object.freeze(defenses)});
}

export function campaignAllows(loadout,armory){
  return (loadout.weapon==='sword'||armory?.weapons?.[loadout.weapon]?.unlocked===true)&&
    (loadout.defense==='none'||armory?.defenses?.[loadout.defense]?.unlocked===true);
}
