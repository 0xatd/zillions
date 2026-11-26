// Hero-only attack clock. Squads retain their autonomous combat behavior.
import { spellAttack, spellAfterAttack } from './hero-spells.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const targetOf = (g, a) => a.nest ? g.nests.find(n => n.id === a.id && n.alive)
  : g.zombies.find(z => z.id === a.id && !z.dead && z.hp > 0);
export function cancelHeroAttack(h) { h.attack = null; h.attackRecovery = 0; }

function impact(g, h, shot, target) {
  if (!target) return;
  const before = target.hp;
  if (shot.nest) g._damageNest(target, shot.damage);
  else {
    g.damageZombie(target, shot.damage, shot.fx, shot.fz, shot.types, shot.mods);
    spellAfterAttack(g, h, target, shot.damage);
    if (shot.splash) for (const z of g.zombies) {
      if (z !== target && !z.dead && distance(z, target) <= shot.splash)
        g.damageZombie(z, shot.damage * .55, shot.fx, shot.fz, shot.types, shot.mods);
    }
  }
  g.emit({ type: 'heroimpact', kind: shot.kind, fromId: h.id, heroKey: h.key,
    fx: shot.fx, fz: shot.fz, tx: target.x, tz: target.z,
    damage: Math.max(0, before - target.hp), crit: shot.crit, targetKind: shot.nest ? 'nest' : undefined });
}

// Released shots survive movement, weapon swaps and the shooter's death.
export function tickHeroProjectiles(g, h, dt) {
  const pending = [];
  for (const shot of h.attackShots || []) {
    shot.t -= dt;
    if (shot.t <= 1e-8) impact(g, h, shot, targetOf(g, shot));
    else pending.push(shot);
  }
  h.attackShots = pending;
  h.attackRecovery = Math.max(0, (h.attackRecovery || 0) - dt);
}

export function updateHeroAttack(g, h, dt, rofMult) {
  if (h.moving || h.mx || h.mz || h.orderKind === 'move' || h.orderKind === 'stop'
    || h.dodgeT > 0 || h.weaveT > 0 || h.stunT > 0) {
    cancelHeroAttack(h); return;
  }
  const w = h.weapon || h.def;
  let target = h.target || h.targetNest;
  let nest = !h.target && !!h.targetNest;
  // A chosen target cannot silently turn into a nearer enemy while chasing.
  if (h.orderKind === 'attack' && h.orderId != null) {
    target = g.zombies.find(z => z.id === h.orderId && !z.dead && z.hp > 0);
    nest = false;
  }
  if (h.attack) { target = targetOf(g, h.attack); nest = h.attack.nest; }
  const range = g.heroRange(h) + (nest ? 2.5 : 0);
  if (!target || target.dead || target.hp <= 0 || distance(h, target) > range) {
    h.attack = null; return;
  }
  h.facing = Math.atan2(target.x - h.x, target.z - h.z);
  if (!h.attack) {
    if (h.cooldown > 1e-8) return;
    const cycle = 1 / Math.max(.01, w.rof * rofMult);
    const duration = Math.min(w.melee ? .28 : .18, cycle * .3);
    h.attack = { id: target.id, nest, t: duration, duration, cycle };
    return;
  }
  h.attack.t -= dt;
  if (h.attack.t > 1e-8) return;
  const attack = h.attack;
  h.attack = null;
  h.cooldown = Math.max(dt, attack.cycle - attack.duration);
  h.attackRecovery = Math.min(.24, h.cooldown);
  let damage = g.heroDmg(h), crit = false;
  const chance = (w.critChance || 0) + (h.mods.critChance || 0) + (h.auraCrit || 0);
  if (chance > 0 && g.rng() < chance) {
    damage *= (w.critMult || 1.75) + (h.mods.critMult || 0); crit = true;
  }
  if (!nest) damage = spellAttack(g, h, target, damage);
  const kind = w.melee ? 'melee' : w.shotgun ? 'shotgun' : 'hero';
  const duration = w.melee ? 0 : Math.max(.08, Math.min(.45, distance(h, target) / 30));
  const serial = h.attackSerial = (h.attackSerial || 0) + 1;
  const shot = { serial, id: target.id, nest, t: duration, damage, crit, kind,
    fx: h.x, fz: h.z, types: w.types ? { ...w.types } : null,
    mods: { ...h.mods }, splash: w.splash || 0 };
  g.emit({ type: 'herorelease', kind, fromId: h.id, heroKey: h.key,
    fx: h.x, fz: h.z, tx: target.x, tz: target.z, fy: .9,
    serial, targetId: target.id, targetKind: nest ? 'nest' : 'enemy', duration });
  if (duration) (h.attackShots ||= []).push(shot);
  else impact(g, h, shot, target);
  if (w.noise > 0) g.wakeZombies(h.x, h.z, w.noise);
}
