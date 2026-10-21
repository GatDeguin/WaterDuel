// Preparation policy: the school teaches guard with a usable training kit.
// Personal selections are borrowed, never overwritten on leaving the school.
export class SessionEquipment{
  #saved=null;
  #kind=null;
  get locked(){return this.#saved!==null;}
  get reason(){return this.#kind==='depth'?'PROFUNDIDAD · Espada sin escudo para esquivar con la cabeza. Al salir se restaura tu equipo.':this.locked?'ESCUELA · Espada y escudo corto de práctica. Al salir se restaura tu equipo.':'';}
  sync(game,training){
    const kind=training===true?'training':['training','depth'].includes(training)?training:null;
    if(kind===this.#kind)return true;
    if(!['ready','matchover'].includes(game.phase))return false;
    if(kind){
      this.#saved??=game.loadouts.map(loadout=>({...loadout}));this.#kind=kind;
      for(const slot of [1,2])game.setLoadout(slot,{weapon:'sword',defense:kind==='depth'?'none':'short'});
    }else{
      const selections=this.#saved;this.#saved=null;this.#kind=null;
      for(const slot of [1,2])game.setLoadout(slot,selections[slot-1]);
    }
    return true;
  }
}
