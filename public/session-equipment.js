import {CAMPAIGN_STARTER_LOADOUT,campaignAllows} from './campaign-progression.js';

// The school lends a fixed kit. The campaign keeps its own selection.
export class SessionEquipment{
  #saved=null;
  #kind=null;
  #campaignLoadout=CAMPAIGN_STARTER_LOADOUT;
  get locked(){return this.#kind==='training'||this.#kind==='depth';}
  get reason(){return this.#kind==='depth'?'PROFUNDIDAD · Espada sin escudo para esquivar con la cabeza. Al salir se restaura tu equipo.':this.locked?'ESCUELA · Espada y escudo corto de práctica. Al salir se restaura tu equipo.':'';}
  sync(game,experience,armory=null){
    const kind=experience===true?'training':['training','depth','campaign'].includes(experience)?experience:null;
    const previous=this.#kind;
    if(kind===previous&&kind!=='campaign')return true;
    if(!['ready','matchover'].includes(game.phase))return false;
    if(previous==='campaign')this.#campaignLoadout={...game.loadouts[0]};
    if(kind){
      this.#saved??=game.loadouts.map(loadout=>({...loadout}));this.#kind=kind;
      if(kind==='campaign'){
        if(!campaignAllows(this.#campaignLoadout,armory))this.#campaignLoadout=CAMPAIGN_STARTER_LOADOUT;
        const current=game.loadouts[0],chosen=this.#campaignLoadout;
        if(current.weapon!==chosen.weapon||current.defense!==chosen.defense||current.knifeGrip!==chosen.knifeGrip)game.setLoadout(1,chosen);
        if(previous==='training'||previous==='depth')game.setLoadout(2,this.#saved[1]);
      }else for(const slot of [1,2])game.setLoadout(slot,{weapon:'sword',defense:kind==='depth'?'none':'short'});
    }else{
      const selections=this.#saved;this.#saved=null;this.#kind=null;
      for(const slot of [1,2])game.setLoadout(slot,selections[slot-1]);
    }
    return true;
  }
}
