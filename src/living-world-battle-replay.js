import { createHash } from 'node:crypto';
import { Game } from './game.js';
import { TerrainField } from './terrain.js';
import { levelById } from './config.js';
import { deriveStrategicConsequences, reserveCapturableSurvivor, validateBattleResult } from './living-world-battle.js';

const ALLOWED_COMMANDS=new Set(['hdir','cast','pay','heroUpgrade','stance','choose','towerpri','found','drop','swapset','dodge','blessing']);
const SIM_DT=1/30,MAX_TICKS=108000,MAX_COMMANDS=50000;

export function validateLivingWorldBattleReplay(value){
  if(!value||value.version!==1||!Number.isInteger(value.completedTick)||value.completedTick<1||value.completedTick>MAX_TICKS||!Array.isArray(value.commands)||value.commands.length>MAX_COMMANDS)throw new Error('invalid_battle_replay');
  let previous=-1,atTick=0;
  for(const row of value.commands){
    if(!row||!Number.isInteger(row.tick)||row.tick<0||row.tick>value.completedTick||row.tick<previous||!row.command||!ALLOWED_COMMANDS.has(row.command.t))throw new Error('invalid_battle_replay');
    if(row.tick===previous){atTick++;if(atTick>16)throw new Error('invalid_battle_replay');}else{previous=row.tick;atTick=1;}
  }
  return value;
}

export function verifyLivingWorldBattleReplay(assignment,input){
  const replay=validateLivingWorldBattleReplay(input),snapshot=assignment?.force_snapshot;
  if(!snapshot||!['tactical','live_command','hybrid'].includes(snapshot.engagementMode))throw new Error('tactical_replay_not_available');
  const level=levelById(1),seed=Number(snapshot.seed)||level.seed;
  const map=new TerrainField(seed,level.theme,{size:level.size,nests:level.nests});
  const game=new Game(map,'normal','alexander',null,1,'living_world_battle');
  game.configureLivingWorldBattle(assignment);
  let commandIndex=0,tick=0;
  while(tick<=replay.completedTick&&!game.over){
    while(commandIndex<replay.commands.length&&replay.commands[commandIndex].tick===tick)game.exec(replay.commands[commandIndex++].command);
    game.update(SIM_DT);tick++;
  }
  if(!game.over||Math.abs(tick-replay.completedTick)>1)throw new Error('battle_replay_outcome_mismatch');
  const battle=game.livingWorldBattle,playerWon=game.won;
  const winnerPartyId=playerWon?battle.playerPartyId:battle.opponentPartyId;
  const outcome=winnerPartyId===battle.attackerPartyId?'attacker_victory':'defender_victory';
  const casualties=Object.entries(battle.losses).filter(([,loss])=>loss>0).map(([stackId,loss])=>({stackId,killed:Math.floor(loss*.75),wounded:loss-Math.floor(loss*.75)}));
  const snapshotParties=new Map((snapshot.parties||[]).map((party)=>[party.id,party]));
  const survival=(partyId)=>{
    const armies=new Set((snapshot.armies||[]).filter((army)=>army.party_id===partyId).map((army)=>army.id));
    const stacks=(snapshot.stacks||[]).filter((stack)=>armies.has(stack.army_id));
    const initial=stacks.reduce((sum,stack)=>sum+(Number(stack.healthy)||0),0),lost=stacks.reduce((sum,stack)=>sum+(battle.losses[stack.id]||0),0);
    return initial?Math.max(0,(initial-lost)/initial):0;
  };
  const attackerMorale=Math.max(0,Math.min(100,(Number(snapshotParties.get(battle.attackerPartyId)?.morale)||50)*survival(battle.attackerPartyId)));
  const defenderMorale=Math.max(0,Math.min(100,(Number(snapshotParties.get(battle.defenderPartyId)?.morale)||50)*survival(battle.defenderPartyId)));
  const strategicCasualties=reserveCapturableSurvivor(snapshot,winnerPartyId,casualties);
  const consequences=deriveStrategicConsequences(snapshot,winnerPartyId,strategicCasualties);
  const canonical={assignmentId:assignment.id,completedTick:tick,outcome,winnerPartyId,casualties:strategicCasualties,morale:{attacker:attackerMorale,defender:defenderMorale},...consequences};
  return validateBattleResult({completedTick:tick,outcome,winnerPartyId,casualties:strategicCasualties,morale:canonical.morale,...consequences,stateHash:createHash('sha256').update(JSON.stringify(canonical)).digest('hex')});
}
