import {RULES,clamp} from './engine.js';

const formatTime=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;

// Presentation only: the engine remains the source of scores, resources and results.
export function matchView(game){
  const roundsToWin=game.roundsToWin??RULES.roundsToWin,bestOf=game.bestOf??3;
  const overtime=game.suddenDeath;
  const seconds=overtime?Math.max(0,Math.floor(game.elapsed-RULES.regulationSeconds)):
    Math.max(0,Math.ceil(RULES.regulationSeconds-game.elapsed));
  const fighters=game.fighters.map((fighter,index)=>({
    name:index===0?'MINT MAMBA':game.opponentName||(fighter.boss?'EL MAESTRO HIDRÁULICO':'AMBER ACE'),
    guardPercent:Math.round(clamp(fighter.guardEnergy,0,1)*100),
    guardLabel:fighter.guardBroken?'AGOTADA':fighter.guard?'ACTIVA':'GUARDIA',
    wins:Array.from({length:roundsToWin},(_,round)=>round<game.scores[index]),
  }));
  const winnerName=game.winner?fighters[game.winner-1].name:'';
  return {
    fighters,winnerName,bestOf,roundsToWin,formatLabel:game.scenario==='practice'?'PRÁCTICA LIBRE':`MEJOR DE ${bestOf} · A ${roundsToWin}`,
    clock:`${overtime?'+':''}${formatTime(seconds)}`,
    clockLabel:overtime?'Tiempo extra':'Tiempo restante',
    burstTitle:game.winner?'¡SPLASH!':'DOBLE PINCHAZO',
    burstSubtitle:game.winner?`${winnerName} GANA LA RONDA`:
      `EMPATE · SE REPITE LA RONDA ${String(game.round).padStart(2,'0')}`,
    showBurst:game.phase==='burst'&&game.phaseClock>=.55,
  };
}
