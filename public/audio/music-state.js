/** Read-only modal direction for a DuelEngine snapshot. A common tonic lets the
 * sequencer change color at a musical boundary without restarting the phrase.
 * Burst freezes use the same stable score/AI flags as the duel, never a timer.
 */
export function musicDecision(game){
  const preparation={mode:'lydian',reason:'Preparación'};
  if(!game||typeof game!=='object'||Array.isArray(game))return preparation;
  if(!['fight','burst','matchover'].includes(game.phase))return preparation;

  const exhibition=game.scenario==='practice'||game.demonstration===true;
  if(game.phase==='matchover'){
    if(exhibition)return preparation;
    if(game.winner===1||game.mode==='versus'&&game.winner===2)return {mode:'lydian',reason:'Victoria'};
    if(game.mode==='solo'&&game.winner===2)return {mode:'aeolian',reason:'Derrota'};
    return preparation;
  }
  const duel={mode:'dorian',reason:'Duelo'};
  if(exhibition)return duel;
  if(game.suddenDeath===true)return {mode:'phrygian',reason:'Muerte súbita'};

  // The engine escalates the actual solo boss to AI phase 2 after a player win.
  // Difficulty/style labels alone do not prove that this escalation occurred.
  const enemy=Array.isArray(game.fighters)?game.fighters[1]:null;
  if(game.mode==='solo'&&game.aiEnabled!==false&&enemy?.boss===true&&enemy.ai?.phase===2)
    return {mode:'phrygian',reason:'Jefe en fase avanzada'};

  const scores=game.scores;
  if(!Array.isArray(scores)||![scores[0],scores[1]].every(value=>Number.isInteger(value)&&value>=0))return duel;
  if(game.mode==='solo'&&scores[0]<scores[1])return {mode:'aeolian',reason:'Desventaja'};
  const target=Number.isInteger(game.roundsToWin)&&game.roundsToWin>=2?game.roundsToWin:game.bestOf===5?3:2;
  if(game.mode==='versus'&&(scores[0]>=target-1||scores[1]>=target-1))return {mode:'aeolian',reason:'Punto de partida'};
  return duel;
}
