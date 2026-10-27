#!/usr/bin/env node
// Headless pacing simulator for the Tower Wizard Cocos demo (tower 0 -> 4, then the post-tower-4 siege).
// The economy mirrors assets/scripts/TowerWizardGame.ts (read-only); keep ECON in sync when those numbers change.
//
//   node tools/pacing/sim.js                 current numbers, 3 profiles, pacing table + siege with SIEGE_TUNING
//   node tools/pacing/sim.js --solve         re-solve the siege constants (prints a SIEGE_TUNING JSON block)
//   node tools/pacing/sim.js --log engaged   purchase log for one profile
//   node tools/pacing/sim.js --tune early.json --siege siege.json   override numbers from JSON files
'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- economy (TowerWizardGame.ts)
function spiritCost(L) { // SkillDefSpirit.gd
  if (L === 1) return 201;
  return Math.floor(200 + 0.7 * Math.pow(L, 2.1 + 0.23 * Math.pow(L, 0.4)) * 0.9);
}
const ECON = {
  towerCosts: [{ magic: 30 }, { magic: 1300 }, { magic: 13000 }, { magic: 350000, wood: 20000 }],
  clickCooldown: 0.25,          // orb click cadence while held / swiped
  clickMagic: 1,                // x (1 + wizard_magic)
  boostBase: 0.35, boostTime: 0.4,
  clickSpeedFlat: L => (L <= 1 ? 0.25 : L <= 2 ? 0.20 : L <= 3 ? 0.15 : 0.10),
  ballPeriod: 4, ballMagic: 20, potency: 0.7,
  bookPeriod: 10, bookKnow: 5, textEnch: 0.5,
  logPeriod: 4, logWood: 4, biggerForest: 0.5,
  spiritGrants: [2, 3],         // tutorialEvent gives 1 spirit after towers 2 and 3
  buildTime: 2.5 + 1.5 + 0.7,   // SPAWN_DURATION + TOWER_DELAY + 0.7 (updateBuild)
  // tutorial popups the player has to read and dismiss (seconds of no swiping); Tutorial.gd steps
  tutorial: { start: ['t0', 't1'], 1: ['t3', 't4', 't5', 't6'], 2: ['t8'], 3: ['forest'], 4: ['prestige'] },
  skills: {
    wizard_magic: { res: 'magic', cost: L => 25 * 2 ** L, max: 4, minLevel: 1 },
    summon_spirit: { res: 'magic', cost: spiritCost, max: Infinity, minLevel: 1, unlock: 'wizard_magic', creates: 'spirits' },
    summon_cloudling: { res: 'spirits', cost: () => 1, max: 10000, minLevel: 1, unlock: 'summon_spirit' },
    cloudling_potency: { res: 'knowledge', cost: L => 20 * 2 ** L, max: 13, minLevel: 1, unlock: 'summon_cloudling' },
    summon_spirit_tome: { res: 'spirits', cost: () => 1, max: 10000, minLevel: 2 },
    text_enchantment: { res: 'knowledge', cost: L => 100 * 2 ** L, max: 13, minLevel: 2, unlock: 'summon_spirit_tome' },
    library_spirits: { res: 'knowledge', cost: L => 1000 * 10 ** L, max: 8, minLevel: 2, unlock: 'text_enchantment' },
    summon_druid: { res: 'spirits', cost: () => 1, max: 10000, minLevel: 3 },
    bigger_forest: { res: 'knowledge', cost: L => 250 * 2 ** L, max: 10, minLevel: 3, unlock: 'summon_druid' },
    craft_totem: { res: 'wood', cost: L => 150 * 2 ** L, max: 1e6, minLevel: 3, unlock: 'summon_druid', creates: 'totems' },
    carve_magic_totem: { res: 'totems', cost: () => 1, max: 50, minLevel: 3, unlock: 'craft_totem' },
    carve_knowledge_totem: { res: 'totems', cost: () => 1, max: 50, minLevel: 3, unlock: 'craft_totem' },
    carve_forest_totem: { res: 'totems', cost: () => 1, max: 50, minLevel: 3, unlock: 'craft_totem' },
  },
};

// ---------------------------------------------------------------- player profiles
// fervor: average fervor-meter fill f in [0,1]; orb-click magic is x(1 + f) (FERVOR_MAX_MULT = 2).
// active: [on, off] seconds of swiping; check: seconds between looks at the shop; overhead: seconds of
// lost swiping per shopping visit; read: seconds per tutorial popup.
const PROFILES = {
  casual: { clickRate: 2, active: [15, 15], fervor: 0, check: 8, overhead: 1.5, perBuy: 0.3, read: 4 },
  engaged: { clickRate: 4, active: [1, 0], fervor: 0.4, check: 3, overhead: 0.6, perBuy: 0.15, read: 2.5 },
  tryhard: { clickRate: 4, active: [1, 0], fervor: 1.0, check: 1.5, overhead: 0.4, perBuy: 0.1, read: 1 },
};

// ---------------------------------------------------------------- state helpers
function newState() {
  const res = { magic: 0, spirits: 0, knowledge: 0, wood: 0, totems: 0 };
  return {
    t: 0, level: 0, res, earned: { ...res }, skills: Object.fromEntries(Object.keys(ECON.skills).map(k => [k, 0])),
    totems: { magic: 0, knowledge: 0, wood: 0 }, building: 0, busy: 0, lastClick: -9, clickCd: 0,
    accBall: 0, accBook: 0, accLog: 0, log: [], milestones: [], lastBuyT: 0, gaps: [], nextCheck: 0,
  };
}
function visible(S, id) {
  const d = ECON.skills[id];
  if (S.level < d.minLevel) return false;
  if (d.unlock && !(S.skills[d.unlock] > 0)) return false;
  return S.skills[id] < d.max;
}
function add(S, r, v) { S.res[r] += v; S.earned[r] += v; }

// average production rates (per second) for a hypothetical skill/totem set; used by the bot's estimates
function rates(S, P, sk = S.skills, tot = S.totems) {
  const active = P.active[0] / (P.active[0] + P.active[1]);
  const clicks = Math.min(P.clickRate, 1 / ECON.clickCooldown) * active;
  const boostCover = Math.min(1, ECON.boostTime * P.clickRate) * active;
  const speed = 1 + boostCover * (ECON.boostBase + ECON.clickSpeedFlat(S.level));
  const magic = clicks * ECON.clickMagic * (1 + sk.wizard_magic) * (1 + P.fervor)
    + sk.summon_cloudling / ECON.ballPeriod * speed * ECON.ballMagic * (1 + ECON.potency * sk.cloudling_potency) * (1 + tot.magic);
  const knowledge = S.level >= 2 ? sk.summon_spirit_tome / ECON.bookPeriod * ECON.bookKnow * (1 + ECON.textEnch * sk.text_enchantment) * (1 + tot.knowledge) : 0;
  const wood = S.level >= 3 ? sk.summon_druid / ECON.logPeriod * ECON.logWood * (1 + ECON.biggerForest * sk.bigger_forest) * (1 + tot.wood) : 0;
  return { magic, knowledge, wood };
}

// ---------------------------------------------------------------- greedy bot
// Score = seconds saved on the estimated time to the next goal per unit of cost, per resource pool.
// The goal is the next tower; once it is reachable (or a pool cannot help it), a virtual goal of 10x the
// current lifetime earnings keeps the bot investing like an engaged player would.
const HORIZON = 60; // seconds a knowledge / spirit producer is credited for
function timeTo(S, goal, R) {
  let T = 0;
  for (const r in goal) { const rem = goal[r] - S.earned[r]; if (rem > 0) T = Math.max(T, R[r] > 0 ? rem / R[r] : 1e7); }
  return T;
}
function goals(S, extra) {
  const g = [];
  const c = (extra && extra.towerCosts || ECON.towerCosts)[S.level];
  if (c) g.push(c);
  g.push({ magic: Math.max(1000, S.earned.magic * 10), ...(S.level >= 3 ? { wood: Math.max(1000, S.earned.wood * 10) } : {}) });
  return g;
}
function saved(S, P, goal, sk, tot) {
  const R0 = rates(S, P), R1 = rates(S, P, sk, tot);
  return timeTo(S, goal, R0) - timeTo(S, goal, R1);
}
function withSkill(S, id, n = 1) { return { ...S.skills, [id]: S.skills[id] + n }; }
function candidates(S, P, extra) {
  const out = [];
  for (const goal of goals(S, extra)) {
    const v = (sk, tot = S.totems) => saved(S, P, goal, sk, tot);
    // direct producers
    const direct = {};
    for (const id of ['wizard_magic', 'summon_cloudling', 'cloudling_potency', 'summon_druid', 'bigger_forest']) if (visible(S, id)) direct[id] = v(withSkill(S, id));
    // a locked spirit sink still gives summon_spirit its value (cloudlings unlock with the first spirit)
    const ghost = {};
    if (!direct.summon_cloudling && visible(S, 'summon_spirit')) ghost.summon_cloudling = v(withSkill(S, 'summon_cloudling'));
    const tot = {};
    if (S.level >= 3 && S.skills.summon_druid > 0) for (const k of ['magic', 'wood', 'knowledge']) tot[k] = v(S.skills, { ...S.totems, [k]: S.totems[k] + 1 });
    // knowledge: shadow price = best seconds saved per knowledge among knowledge sinks that pay back directly
    let pk = 0;
    for (const id of ['cloudling_potency', 'bigger_forest']) if (direct[id] > 0) pk = Math.max(pk, direct[id] / ECON.skills[id].cost(S.skills[id]));
    const R = rates(S, P);
    if (S.level >= 2) {
      const dk = (sk, tt = S.totems) => (rates(S, P, sk, tt).knowledge - R.knowledge) * HORIZON * pk;
      if (visible(S, 'summon_spirit_tome')) direct.summon_spirit_tome = dk(withSkill(S, 'summon_spirit_tome'));
      if (visible(S, 'text_enchantment')) direct.text_enchantment = dk(withSkill(S, 'text_enchantment'));
      if (tot.knowledge !== undefined) tot.knowledge += dk(S.skills, { ...S.totems, knowledge: S.totems.knowledge + 1 });
    }
    // spirits: shadow value = best use of one spirit
    const ps = Math.max(0, ...['summon_cloudling', 'summon_spirit_tome', 'summon_druid'].map(id => direct[id] || ghost[id] || 0));
    if (visible(S, 'summon_spirit')) direct.summon_spirit = ps;
    if (visible(S, 'library_spirits')) direct.library_spirits = 5 * ps;
    if (tot.wood !== undefined) tot.wood += 4 * ps;
    for (const id in direct) {
      const d = ECON.skills[id];
      out.push({ id, res: d.res, cost: d.cost(S.skills[id]), gain: direct[id], goal });
    }
    // totems: craft (wood) + carve (totem); a crafted totem in stock is carved for free
    for (const k in tot) {
      const fromStock = S.res.totems >= 1;
      out.push({ id: 'totem_' + k, kind: k, res: fromStock ? 'totems' : 'wood', cost: fromStock ? 1 : ECON.skills.craft_totem.cost(S.skills.craft_totem), gain: tot[k], goal });
    }
    if (out.some(c => c.goal === goal && c.gain > 1e-6)) break; // the first goal anything helps wins
  }
  return out;
}
function buy(S, c) {
  if (S.res[c.res] + 1e-9 < c.cost) return false;
  if (c.id.startsWith('totem_')) {
    if (c.res === 'wood') { S.res.wood -= c.cost; S.skills.craft_totem++; add(S, 'totems', 1); }
    S.res.totems -= 1; S.totems[c.kind]++; S.skills['carve_' + c.kind + '_totem']++;
    if (c.kind === 'wood') add(S, 'spirits', 4);
  } else {
    S.res[c.res] -= c.cost; S.skills[c.id]++;
    if (c.id === 'summon_spirit') add(S, 'spirits', 1);
    if (c.id === 'library_spirits') add(S, 'spirits', 5);
  }
  return true;
}
// one shopping visit: per pool buy the best-scoring item while it is affordable
function shop(S, P, logOn, extra) {
  let n = 0;
  for (let guard = 0; guard < 400; guard++) {
    const cs = candidates(S, P, extra).filter(c => c.gain > 1e-9);
    const best = {};
    for (const c of cs) { const s = c.gain / c.cost; if (!best[c.res] || s > best[c.res].s) best[c.res] = { c, s }; }
    let did = false;
    for (const r of ['totems', 'spirits', 'knowledge', 'wood', 'magic']) {
      if (best[r] && buy(S, best[r].c)) { did = true; n++; if (logOn) S.log.push(`${fmtT(S.t)} L${S.level} buy ${best[r].c.id} (${fmtN(best[r].c.cost)} ${r})`); break; }
    }
    if (!did) break;
  }
  return n;
}

// ---------------------------------------------------------------- time stepping
const DT = 0.05;
function isActive(S, P) { const cyc = P.active[0] + P.active[1]; return P.active[1] === 0 || (S.t % cyc) < P.active[0]; }
function step(S, P, opts = {}) {
  const dt = DT; S.t += dt;
  const swiping = S.busy <= 0 && !S.building && isActive(S, P);
  if (S.busy > 0) S.busy -= dt;
  // orb clicks: one per 1/clickRate s, never faster than the cooldown
  S.clickCd -= dt;
  let clicked = 0;
  if (swiping && S.clickCd <= 0) {
    S.clickCd += Math.max(ECON.clickCooldown, 1 / P.clickRate); if (S.clickCd < -dt) S.clickCd = 0;
    clicked = 1; S.lastClick = S.t;
    add(S, 'magic', ECON.clickMagic * (1 + S.skills.wizard_magic) * (1 + P.fervor));
  } else if (!swiping && S.clickCd < 0) S.clickCd = 0;
  const speed = S.t - S.lastClick < ECON.boostTime ? 1 + ECON.boostBase + ECON.clickSpeedFlat(S.level) : 1;
  // cloudlings throw balls during builds too (updateOrbitals does not check building)
  S.accBall += dt * speed / ECON.ballPeriod * S.skills.summon_cloudling;
  while (S.accBall >= 1) { S.accBall -= 1; add(S, 'magic', ECON.ballMagic * (1 + ECON.potency * S.skills.cloudling_potency) * (1 + S.totems.magic)); }
  if (!S.building) {
    if (S.level >= 2) {
      S.accBook += dt / ECON.bookPeriod * S.skills.summon_spirit_tome;
      while (S.accBook >= 1) { S.accBook -= 1; add(S, 'knowledge', ECON.bookKnow * (1 + ECON.textEnch * S.skills.text_enchantment) * (1 + S.totems.knowledge)); }
    }
    if (S.level >= 3) {
      S.accLog += dt / ECON.logPeriod * S.skills.summon_druid;
      while (S.accLog >= 1) { S.accLog -= 1; add(S, 'wood', ECON.logWood * (1 + ECON.biggerForest * S.skills.bigger_forest) * (1 + S.totems.wood)); }
    }
  }
  return clicked;
}
function markPurchase(S) { S.gaps.push({ level: S.level, from: S.lastBuyT, to: S.t }); S.lastBuyT = S.t; }

function runEarly(P, opts = {}) {
  const S = newState(), costs = opts.towerCosts || ECON.towerCosts, logOn = !!opts.log;
  S.busy = ECON.tutorial.start.length * P.read;
  let buildEnd = -1;
  while (S.t < 7200) {
    step(S, P);
    if (S.building && S.t >= buildEnd) {
      S.building = 0; S.milestones.push({ level: S.level, t: S.t });
      if (logOn) S.log.push(`${fmtT(S.t)} tower ${S.level} done`);
      if (ECON.spiritGrants.includes(S.level)) add(S, 'spirits', 1);       // tutorialEvent grants
      S.busy = (ECON.tutorial[S.level] || []).length * P.read;
      markPurchase(S);
      if (S.level >= 4) break;
      continue;
    }
    if (S.building || S.busy > 0 || S.t < S.nextCheck) continue;
    S.nextCheck = S.t + P.check;
    const c = costs[S.level];
    if (c && Object.keys(c).every(k => S.earned[k] >= c[k])) {
      S.level++; S.building = 1; buildEnd = S.t + ECON.buildTime;
      if (logOn) S.log.push(`${fmtT(S.t)} build tower ${S.level}`);
      continue;
    }
    const n = shop(S, P, logOn, opts);
    if (n) { S.busy = P.overhead + P.perBuy * (n - 1); markPurchase(S); }
  }
  return S;
}

// ---------------------------------------------------------------- siege (post tower 4)
// Parameterised: the orb auto-fires bolts at the current target; every orb click (swipe / tap) also fires a
// swipe-bolt. Fervor multiplies swipe-bolts by (1 + fervorK * f). Magic buys Bolt Power (+power% damage,
// compounding) and Rapid Fire (+rate bolts/s). Towers 5 and 6 are bought with lifetime magic, multiply all
// damage and unlock after the 1st / 2nd wall. Walls / boss phases have a short transition with no damage.
const SIEGE_DEFAULT = {
  walls: [{ name: 'Cloud Wall', hp: 2.0e4 }, { name: 'Solar Wall', hp: 1.2e5 }, { name: 'Cosmic Wall', hp: 6.0e5 }],
  boss: { name: 'The Warden', phases: [6.0e5, 9.0e5, 1.3e6] },
  boltDamage: 30, fireRate: 1.0, swipeDamage: 10, fervorK: 4, fervorExp: 2,
  upgrades: {
    power: { name: 'Bolt Power', cost0: 2000, growth: 1.6, effect: 0.25 },
    rate: { name: 'Rapid Fire', cost0: 3000, growth: 1.8, effect: 0.25 },
  },
  towers: [{ level: 5, after: 1, cost: { magic: 1.5e6 }, damageMult: 2 }, { level: 6, after: 2, cost: { magic: 8e6 }, damageMult: 2 }],
  transition: 3, buildTime: ECON.buildTime,
};
// swipe-bolt multiplier: 1 + fervorK * f^fervorExp (exp > 1 makes the gold, full-fervor tier the real prize)
function fervorMult(Q, P) { return 1 + Q.fervorK * Math.pow(P.fervor, Q.fervorExp || 1); }
function upgCost(u, L) { return u.cost0 * Math.pow(u.growth, L); }
function siegeDps(Q, P, st, active = 1) {
  const power = Math.pow(1 + Q.upgrades.power.effect, st.power) * st.towerMult;
  const auto = Q.boltDamage * (Q.fireRate + Q.upgrades.rate.effect * st.rate) * power;
  const clicks = Math.min(P.clickRate, 1 / ECON.clickCooldown) * active;
  const swipe = clicks * Q.swipeDamage * fervorMult(Q, P) * power;
  return { auto, swipe, total: auto + swipe };
}
function runSiege(P, Q, S0, opts = {}) {
  const S = S0 ? JSON.parse(JSON.stringify(S0)) : newState();
  S.log = opts.log ? [] : null; S.gaps = []; S.lastBuyT = S.t;
  const t0 = S.t, st = { power: 0, rate: 0, towerMult: 1, towers: 0 };
  const targets = [...Q.walls.map(w => ({ name: w.name, hp: w.hp })), ...Q.boss.phases.map((hp, i) => ({ name: `${Q.boss.name} P${i + 1}`, hp }))];
  let ti = 0, hp = targets[0].hp, pause = 0, buildEnd = -1;
  const splits = [], active = P.active[0] / (P.active[0] + P.active[1]);
  let segStart = S.t, swipeDmg = 0, totalDmg = 0, nextShop = 0;
  const power = () => Math.pow(1 + Q.upgrades.power.effect, st.power) * st.towerMult;
  while (ti < targets.length && S.t - t0 < 3600) {
    const clicked = step(S, P, { siege: true });
    if (opts.onStep) opts.onStep(S, S.t - t0);
    if (S.building) { if (S.t >= buildEnd) { S.building = 0; S.busy = P.read; } continue; }
    if (pause > 0) { pause -= DT; continue; }
    // damage: auto bolts continuous, swipe-bolts per click
    const autoD = Q.boltDamage * (Q.fireRate + Q.upgrades.rate.effect * st.rate) * power() * DT;
    const swD = clicked ? Q.swipeDamage * fervorMult(Q, P) * power() : 0;
    hp -= autoD + swD; swipeDmg += swD; totalDmg += autoD + swD;
    if (hp <= 0) {
      splits.push({ name: targets[ti].name, t: S.t - segStart, swipeShare: swipeDmg / totalDmg });
      if (S.log) S.log.push(`${fmtT(S.t - t0)} ${targets[ti].name} down (${fmtT(S.t - segStart)})`);
      ti++; swipeDmg = 0; totalDmg = 0;
      if (ti < targets.length) { hp = targets[ti].hp; pause = Q.transition; segStart = S.t + Q.transition; }
      continue;
    }
    if (S.busy > 0 || S.t < nextShop) continue;
    nextShop = S.t + P.check;
    let n = 0;
    // tower 5 / 6: build as soon as unlocked and affordable (lifetime magic)
    const tw = Q.towers[st.towers];
    if (tw && ti >= tw.after && Object.keys(tw.cost).every(k => S.earned[k] >= tw.cost[k])) {
      st.towers++; st.towerMult *= tw.damageMult; S.level = tw.level; S.building = 1; buildEnd = S.t + Q.buildTime;
      if (S.log) S.log.push(`${fmtT(S.t - t0)} build tower ${tw.level}`);
      markPurchase(S); continue;
    }
    // economy pools other than magic keep running through the greedy shop (it never spends magic here
    // unless spirits are the best siege-independent buy); magic goes to siege upgrades vs. more spirits
    for (let guard = 0; guard < 200; guard++) {
      const base = siegeDps(Q, P, st, active).total;
      const opt = [];
      for (const k of ['power', 'rate']) {
        const s2 = { ...st, [k]: st[k] + 1 };
        opt.push({ k, cost: upgCost(Q.upgrades[k], st[k]), gain: Math.log(siegeDps(Q, P, s2, active).total / base) });
      }
      // a spirit -> cloudling raises magic income; credit it at half weight against siege upgrades
      const R0 = rates(S, P).magic, R1 = rates(S, P, withSkill(S, 'summon_cloudling')).magic;
      opt.push({ k: 'spirit', cost: spiritCost(S.skills.summon_spirit), gain: 0.5 * Math.log(R1 / Math.max(1, R0)) });
      opt.sort((a, b) => b.gain / b.cost - a.gain / a.cost);
      // a player with two upgrade buttons buys whichever affordable one is the better deal
      const o = opt.find(x => x.k !== 'spirit' && S.res.magic >= x.cost) || (S.res.magic >= opt[0].cost ? opt[0] : null);
      if (!o) break;
      S.res.magic -= o.cost; n++;
      if (o.k === 'spirit') { S.skills.summon_spirit++; S.skills.summon_cloudling++; }
      else st[o.k]++;
      if (S.log) S.log.push(`${fmtT(S.t - t0)} buy ${o.k} (${fmtN(o.cost)})`);
    }
    n += shopNonMagic(S, P);
    if (n) { S.busy = P.overhead + P.perBuy * (n - 1); markPurchase(S); }
  }
  return { total: S.t - t0, splits, st, finished: ti >= targets.length, log: S.log, gaps: S.gaps };
}
function shopNonMagic(S, P) { // spirits / knowledge / wood / totems keep feeding the economy during the siege
  let n = 0;
  for (let guard = 0; guard < 200; guard++) {
    const cs = candidates(S, P).filter(c => c.gain > 1e-9 && c.res !== 'magic');
    const best = {};
    for (const c of cs) { const s = c.gain / c.cost; if (!best[c.res] || s > best[c.res].s) best[c.res] = { c, s }; }
    let did = false;
    for (const r of ['totems', 'spirits', 'knowledge', 'wood']) if (best[r] && buy(S, best[r].c)) { did = true; n++; break; }
    if (!did) break;
  }
  return n;
}

// ---------------------------------------------------------------- siege solver
// Scales each target's HP (in order) so the engaged profile spends `target` seconds on it, then checks the
// casual / tryhard constraints. Searches over the auto-vs-swipe damage split and fervorK.
function solveSiege(early, Q0, targets, towerAt) {
  const Q = JSON.parse(JSON.stringify(Q0));
  const names = [...Q.walls.map((_, i) => ['walls', i]), ...Q.boss.phases.map((_, i) => ['boss', i])];
  const get = ([a, i]) => (a === 'walls' ? Q.walls[i].hp : Q.boss.phases[i]);
  const set = ([a, i], v) => { if (a === 'walls') Q.walls[i].hp = v; else Q.boss.phases[i] = v; };
  // towers 5 / 6: priced at what the engaged player has earned (lifetime magic) shortly after the wall that unlocks them
  if (towerAt) {
    const probe = JSON.parse(JSON.stringify(Q)); probe.walls.forEach(w => { w.hp = 1e18; }); probe.towers = [];
    const want = Q.towers.map((_, i) => towerAt[i]), got = [];
    runSiege(PROFILES.engaged, probe, early.engaged, { onStep: (S, t) => { for (let i = 0; i < want.length; i++) if (got[i] === undefined && t >= want[i]) got[i] = S.earned.magic; if (t > Math.max(...want)) S.t = 1e9; } });
    Q.towers.forEach((tw, i) => { tw.cost = { magic: round2(got[i]) }; });
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < names.length; j++) {
      let lo = get(names[j]) / 50, hi = get(names[j]) * 50;
      for (let it = 0; it < 40; it++) {
        const mid = Math.sqrt(lo * hi); set(names[j], mid);
        const r = runSiege(PROFILES.engaged, Q, early.engaged);
        const tj = r.splits[j] ? r.splits[j].t : 1e9;
        if (tj > targets[j]) hi = mid; else lo = mid;
      }
      set(names[j], round2(Math.sqrt(lo * hi)));
    }
  }
  return Q;
}
function evalSiege(early, Q) {
  const out = {};
  for (const p in PROFILES) out[p] = runSiege(PROFILES[p], Q, early[p]);
  return out;
}
function round2(v) { const e = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / e) * e; }

// ---------------------------------------------------------------- formatting
function fmtT(s) { const m = Math.floor(s / 60), r = Math.round(s - m * 60); return `${m}:${String(r).padStart(2, '0')}`.replace(/:60$/, ':59'); }
function fmtN(n) {
  if (n < 10000) return String(Math.round(n));
  const suf = ['', 'K', 'M', 'B', 'T']; const e = Math.floor(Math.log10(n) / 3);
  return (n / 10 ** (3 * e)).toFixed(n / 10 ** (3 * e) >= 100 ? 0 : 1) + suf[e];
}
function earlyTable(early) {
  const lines = ['| profile | tower 1 | tower 2 | tower 3 | tower 4 | longest wait (segment) | cloudlings / tomes / druids at T4 | magic/s at T4 |', '|---|---|---|---|---|---|---|---|'];
  for (const p in early) {
    const S = early[p], m = S.milestones;
    const g = S.gaps.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a), { from: 0, to: 0, level: 0 });
    const R = rates(S, PROFILES[p]);
    lines.push(`| ${p} | ${m.map(x => fmtT(x.t)).join(' | ')} | ${(g.to - g.from).toFixed(0)} s (L${g.level}→${g.level + 1}, at ${fmtT(g.from)}) | ${S.skills.summon_cloudling} / ${S.skills.summon_spirit_tome} / ${S.skills.summon_druid} | ${fmtN(R.magic)} |`);
  }
  return lines.join('\n');
}
function segTable(early) {
  const lines = ['| profile | 0→1 | 1→2 | 2→3 | 3→4 | longest gap per segment (s) |', '|---|---|---|---|---|---|'];
  for (const p in early) {
    const m = early[p].milestones.map(x => x.t), seg = m.map((t, i) => t - (i ? m[i - 1] : 0));
    const gp = [0, 1, 2, 3].map(L => Math.max(0, ...early[p].gaps.filter(g => g.level === L).map(g => g.to - g.from)).toFixed(0));
    lines.push(`| ${p} | ${seg.map(fmtT).join(' | ')} | ${gp.join(' / ')} |`);
  }
  return lines.join('\n');
}
function siegeTable(res) {
  const names = res.engaged.splits.map(s => s.name);
  const lines = [`| profile | ${names.join(' | ')} | total | swipe share | vs engaged |`, `|---|${names.map(() => '---|').join('')}---|---|---|`];
  for (const p in res) {
    const r = res[p], sh = r.splits.length ? r.splits.reduce((a, s) => a + s.swipeShare, 0) / r.splits.length : 0;
    lines.push(`| ${p} | ${names.map((_, i) => (r.splits[i] ? fmtT(r.splits[i].t) : '—')).join(' | ')} | ${r.finished ? fmtT(r.total) : '>60:00'} | ${(sh * 100).toFixed(0)}% | ${(res.engaged.total / r.total).toFixed(2)}x |`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- main
function main() {
  const args = process.argv.slice(2), arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const extra = arg('--tune') ? JSON.parse(fs.readFileSync(arg('--tune'), 'utf8')) : {};
  if (extra.towerCosts) ECON.towerCosts = extra.towerCosts;
  for (const k of ['ballMagic', 'bookKnow', 'logWood', 'buildTime', 'spiritGrants']) if (extra[k] !== undefined) ECON[k] = extra[k];
  const tuningFile = arg('--siege') || path.join(__dirname, 'siege_tuning.json');
  let Q = fs.existsSync(tuningFile) ? { ...SIEGE_DEFAULT, ...JSON.parse(fs.readFileSync(tuningFile, 'utf8')) } : SIEGE_DEFAULT;
  const early = {};
  for (const p in PROFILES) early[p] = runEarly(PROFILES[p], { log: arg('--log') === p });
  if (arg('--log')) { console.log(early[arg('--log')].log.join('\n')); }
  console.log('## Tower 0 → 4\n\n' + earlyTable(early) + '\n\n' + segTable(early) + '\n');
  if (args.includes('--solve')) {
    const targets = [120, 120, 120, 50, 50, 50];
    Q = solveSiege(early, Q, targets, [135, 260]);
    fs.writeFileSync(path.join(__dirname, 'siege_tuning.solved.json'), JSON.stringify(Q, null, 2));
  }
  const sres = evalSiege(early, Q);
  console.log('## Siege (after tower 4)\n\n' + siegeTable(sres) + '\n');
  for (const p in sres) console.log(`${p}: end of demo at ${fmtT((early[p].milestones[3] ? early[p].milestones[3].t : NaN) + sres[p].total)}; upgrades power ${sres[p].st.power}, rate ${sres[p].st.rate}, towers ${sres[p].st.towers}`);
  if (args.includes('--json')) console.log(JSON.stringify(Q, null, 2));
}
if (require.main === module) main();
module.exports = { ECON, PROFILES, SIEGE_DEFAULT, runEarly, runSiege, evalSiege, solveSiege, rates, fmtT, fmtN, earlyTable, segTable, siegeTable };
