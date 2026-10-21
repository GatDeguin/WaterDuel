// Preparation policy: the school teaches guard with a usable training kit.
// Personal selections are borrowed, never overwritten on leaving the school.
export class SessionEquipment{
  #saved=null;
  get locked(){return this.#saved!==null;}
  get reason(){return this.locked?'ESCUELA · Espada y escudo corto de práctica. Al salir se restaura tu equipo.':'';}
  sync(game,training){
    if(training===this.locked)return true;
    if(!['ready','matchover'].includes(game.phase))return false;
    if(training){
      this.#saved=game.loadouts.map(loadout=>({...loadout}));
      for(const slot of [1,2])game.setLoadout(slot,{weapon:'sword',defense:'short'});
    }else{
      const selections=this.#saved;this.#saved=null;
      for(const slot of [1,2])game.setLoadout(slot,selections[slot-1]);
    }
    return true;
  }
}
