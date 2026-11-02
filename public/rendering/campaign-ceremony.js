import {TABLE_TOP} from '../physics/dimensions.js';

/** A newly earned reward is presentation state, never a collider or a replay event. */
export function campaignCeremony(game,individual,startedAt){
 if(game?.mode!=='solo'||game.phase!=='matchover'||game.winner!==1||game.demonstration||individual?.kind!=='campaign'||individual.result!=='complete'||game.fighters?.[1]?.globIntact!==false)return null;
 const view=individual.view(game),tier=view.campaignTier,trophy=view.trophy;
 if(!['normal','advanced'].includes(tier)||!['champion','master'].includes(trophy)||!Number.isFinite(startedAt)||!Number.isFinite(game.clock))return null;
 return {tier,trophy,age:Math.max(0,game.clock-startedAt)};
}

/** Reuse the renderer's prepared primitives; no new assets, text, buffers or physics. */
export function drawCampaignCeremony(renderer,ceremony,reducedMotion=false){
 if(!ceremony||!['normal','advanced'].includes(ceremony.tier)||!['champion','master'].includes(ceremony.trophy)||!Number.isFinite(ceremony.age)||ceremony.age<0||ceremony.age===0&&!reducedMotion)return false;
 const t=Math.min(1,ceremony.age/1.2),s=reducedMotion?1:t*t*(3-2*t),y=TABLE_TOP,z=.08,gold=ceremony.trophy==='master'?0xe9c77e:0xc9a35e;
 const at=height=>y+height*s;
 renderer.box(0,at(.045),z,.44,.09*s,.32,0x513521,0);
 renderer.box(0,at(.096),z,.38,.018*s,.27,gold,1);
 renderer.box(0,at(.052),z+.164,.18,.037*s,.008,gold,1);
 renderer.cylinder(0,at(.19),z,.047,.18*s,.047,gold,1);
 renderer.sphere(0,at(.34),z,.16,.13*s,.13,gold,1);
 renderer.sphere(0,at(.40),z,.135,.025*s,.11,0x493423,1);
 renderer.torus(-.17,at(.35),z,.067,.09*s,.024,gold,1);
 renderer.torus(.17,at(.35),z,.067,.09*s,.024,gold,1);
 renderer.sphere(0,at(.55),z,.10,.135*s,.09,gold,1);
 renderer.sphere(0,at(.70),z,.034,.030*s,.030,gold,1);
 if(ceremony.trophy==='master')for(const x of [-.075,0,.075])renderer.box(x,at(.745),z,.026,(x===0?.12:.08)*s,.026,gold,1);
 return true;
}
