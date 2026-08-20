const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function combatAlert(game, player = 0) {
  if (!game || game.over || game.phase === 'found') return null;
  const hero = game.heroes?.[player];
  const keep = game.buildings?.find((b) => b.kind === 'hq' && b.alive);
  const keepHealth = keep && n(keep.maxHp) > 0 ? n(keep.hp) / n(keep.maxHp) : null;
  const heroHealth = hero && !hero.dead && n(hero.maxHp) > 0 ? n(hero.hp) / n(hero.maxHp) : null;
  if (keepHealth != null && keepHealth <= 0.3) return { key: 'keep-critical', tone: 'critical', icon: '🏰', title: 'KEEP CRITICAL', detail: 'Return to the city. Set the army to Defend and repair the inner line.' };
  if (game.finalStand && game.boss && !game.boss.dead) return { key: game.boss.enraged ? 'boss-enraged' : 'boss-walking', tone: 'boss', icon: '☠️', title: game.boss.enraged ? 'BOSS ENRAGED' : 'CHAMPION AT LARGE', detail: game.boss.enraged ? 'Break contact if needed; focus the champion before it reaches the Keep.' : 'Regroup at the city and focus the marked champion.' };
  if (heroHealth != null && heroHealth <= 0.25) return { key: 'hero-critical', tone: 'warning', icon: '❤️', title: 'HERO WOUNDED', detail: 'Disengage, dodge, and let regeneration work before re-entering the horde.' };
  if (keepHealth != null && keepHealth <= 0.55) return { key: 'keep-damaged', tone: 'warning', icon: '🏰', title: 'KEEP UNDER PRESSURE', detail: 'Check the city line now. Siegers can bypass your army.' };
  return null;
}

export function runReview({ won = false, stats = {}, threat = 0, mode = 'campaign', game = null } = {}) {
  stats ||= {};
  const safe = { kills: n(stats.kills), built: n(stats.built), lost: n(stats.lost), nests: n(stats.nests), bestHeld: n(stats.bestHeld), heroDeaths: n(stats.heroDeaths) };
  const keep = game?.buildings?.find((b) => b.kind === 'hq');
  const remainingNests = game?.liveNests ? n(game.liveNests()) : null;
  if (won) {
    const cause = safe.lost === 0
      ? { icon: '🛡️', title: 'Your defensive line held', detail: `${safe.built} structures raised with none lost.` }
      : safe.nests > 0
        ? { icon: '🔥', title: 'You kept pressure on the hives', detail: `${safe.nests} nests razed before the final counterattack.` }
        : { icon: '⚔️', title: 'You survived the final pressure', detail: `${safe.kills} enemies slain through Threat ${n(threat)}.` };
    return { cause, action: mode === 'campaign' ? 'Review the new rewards, then prepare for the next front.' : 'Continue while this loadout is working.' };
  }
  if (game?.defeatCause === 'party_exhausted') return {
    cause: { icon: '❤️', title: 'The company ran out of lives', detail: `${safe.heroDeaths} hero ${safe.heroDeaths === 1 ? 'fall exhausted' : 'falls exhausted'} the shared life pool.` },
    action: 'Slow down before sealed encounters and save abilities for the largest wave.',
  };
  if (mode === 'labyrinth' && safe.heroDeaths > 0) return { cause: { icon: '❤️', title: 'The company ran out of lives', detail: `${safe.heroDeaths} hero falls exhausted the shared life pool.` }, action: 'Slow down before sealed encounters and save abilities for the largest wave.' };
  if (game?.defeatCause === 'keep_destroyed' || (keep && n(keep.hp) <= 0)) return {
    cause: { icon: '🏰', title: 'The Keep was destroyed', detail: safe.lost > 0 ? `${safe.lost} structures fell before the city collapsed.` : 'The enemy reached the heart of the city.' },
    action: safe.bestHeld === 0 ? 'Take and hold a lane node early, then return before the final counterattack.' : safe.lost >= Math.max(3, safe.built / 2) ? 'Build a tighter inner defense and switch the army to Defend when the champion walks.' : 'Return when the Keep warning appears and focus siegers or the marked champion.',
  };
  if (remainingNests != null && remainingNests > 0) return { cause: { icon: '🔥', title: `${remainingNests} ${remainingNests === 1 ? 'hive remained' : 'hives remained'}`, detail: 'Uncleared hives kept adding pressure to the battlefield.' }, action: safe.bestHeld === 0 ? 'Capture a lane node before pushing the nearest hive.' : 'Push one lane at a time and destroy its hive before the next Threat surge.' };
  return { cause: { icon: '☠️', title: 'The army was overwhelmed', detail: `${safe.kills} enemies slain; ${safe.lost} structures lost by Threat ${n(threat)}.` }, action: safe.heroDeaths > 1 ? 'Disengage earlier when hero health turns red; a dead hero leaves the army without its aura.' : 'Concentrate structures around one defensible lane and use the mission warnings to regroup.' };
}

export function storeRetry(storage, retry) {
  if (!storage || !retry?.level || !retry?.hero) return false;
  try {
    storage.setItem('zillions-retry-mission', JSON.stringify(retry));
    return storage.getItem('zillions-retry-mission') != null;
  } catch {
    return false;
  }
}
