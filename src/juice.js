// Presentation-only game feel. Nothing here is read by the simulation or the
// lockstep hash. Curves are pure so a check can lock the feel in place.

const BIG_TYPES = new Set(['brute', 'sieger', 'boss']);

export function isBigEnemy(enemy) {
  if (!enemy) return false;
  if (enemy.boss) return true;
  if (BIG_TYPES.has(enemy.type)) return true;
  const scale = enemy.def?.scale ?? enemy.scale ?? 1;
  return scale >= 1.5;
}

// First raise grows out of the ground. An upgrade pops: short, tall, then
// settled, so the new tier reads as a transformation.
export function buildPop(age, upgraded = false) {
  if (upgraded) {
    const dur = 0.5;
    if (!(age < dur)) return { x: 1, y: 1, z: 1, live: false };
    const k = age / dur;
    let s;
    if (k < 0.42) {
      const u = k / 0.42;
      const e = 1 - (1 - u) * (1 - u);
      s = 0.7 + (1.16 - 0.7) * e;
    } else {
      const u = (k - 0.42) / 0.58;
      const e = 1 - (1 - u) ** 3;
      s = 1.16 + (1 - 1.16) * e;
    }
    const xz = 1 + (s - 1) * 0.45;
    return { x: xz, y: s, z: xz, live: true };
  }
  const dur = 0.7;
  if (!(age < dur)) return { x: 1, y: 1, z: 1, live: false };
  const k = Math.min(1, Math.max(0, age / dur));
  const eased = 1 - (1 - k) ** 3;
  return {
    x: 0.86 + eased * 0.14,
    y: 0.08 + eased * 0.92,
    z: 0.86 + eased * 0.14,
    live: true,
  };
}

// Visual recoil away from a hit. `big` enemies shove harder. The sim position
// is never written; the renderer adds this offset for a fraction of a second.
export function hitImpulse(big = false) {
  return {
    knock: big ? 0.46 : 0.22,
    shake: big ? 0.32 : 0,
    flash: 1,
  };
}

export function waveCue(type, extra = {}) {
  if (type === 'surge') return {
    eyebrow: 'THREAT RISES',
    title: `THREAT ${extra.level ?? ''}`.trim(),
    detail: 'Every hive musters at once.',
    tone: 'wave',
    punch: -5.5,
    shake: 0.62,
    horn: true,
    hold: 2.4,
  };
  if (type === 'horde') {
    const final = !!extra.final;
    return {
      eyebrow: final ? 'FINAL COUNTERATTACK' : 'THE HORDE',
      title: final ? 'THE CHAMPION MARCHES' : 'THEY ARE COMING',
      detail: final ? 'The hives are gone. Break their champion.' : 'A wave is on the field.',
      tone: 'wave',
      punch: final ? -7 : -5.5,
      shake: final ? 1.05 : 0.7,
      horn: true,
      hold: 2.6,
    };
  }
  if (type === 'roomwave') return {
    eyebrow: 'CHAMBER',
    title: `WAVE ${extra.wave ?? ''}`.trim(),
    detail: 'Hold the room.',
    tone: 'wave',
    punch: -5,
    shake: 0.5,
    horn: true,
    hold: 2.2,
  };
  if (type === 'pursuit') {
    const stage = extra.stage || 1;
    return {
      eyebrow: 'BEHIND YOU',
      title: stage >= 3 ? 'THE FLOOD' : stage >= 2 ? 'THE DEAD POUR IN' : 'SOMETHING FOLLOWS',
      detail: 'The Last Lantern is no longer quiet.',
      tone: 'wave',
      punch: -4.5,
      shake: stage >= 3 ? 0.7 : 0.45,
      horn: true,
      hold: 2.4,
    };
  }
  if (type === 'boss') return {
    eyebrow: 'CHAMPION',
    title: extra.name || 'THE LAST STAND',
    detail: 'Break them, or lose the keep.',
    tone: 'wave',
    punch: -6.5,
    shake: 1.15,
    horn: true,
    hold: 2.8,
  };
  return null;
}

export function outcomeCue(won, { mode = 'campaign', threat = 0, defeatCause = null } = {}) {
  const labyrinth = mode === 'labyrinth';
  const survival = mode === 'survival';
  if (won) {
    return {
      eyebrow: labyrinth ? 'TRIAL CLEARED' : 'SIEGE COMPLETE',
      title: labyrinth ? 'YOU WALKED OUT' : 'THE PLANET IS YOURS',
      detail: labyrinth ? 'Every chamber is silent.' : 'Every hive is ash.',
      tone: 'win',
      hold: 1.65,
      punch: 7.5,
      shake: 0.4,
    };
  }
  const lives = defeatCause === 'party_exhausted';
  return {
    eyebrow: survival ? 'THE LINE BREAKS' : labyrinth ? 'THE TRIAL HOLDS' : 'THE KEEP HAS FALLEN',
    title: lives ? 'NO ONE LEFT STANDING' : survival ? 'THE DEAD DO NOT STOP' : labyrinth ? 'THE LABYRINTH KEEPS YOU' : 'THE CITY IS LOST',
    detail: lives ? 'The company is down.' : survival ? `Threat ${threat} outlasted the walls.` : 'The line broke.',
    tone: 'lose',
    hold: 1.35,
    punch: -4.2,
    shake: 1.15,
  };
}
