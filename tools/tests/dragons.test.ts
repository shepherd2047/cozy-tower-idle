// Dragon Nest mechanics (modules/dragons.ts): keepers -> EXP -> levels/points, growth stages, abilities,
// magic breath, pulse of knowledge, fireballs + queen split + shrapnel against a wall stub, save/load, reset.
// Run: bun run tools/testkit/run.ts dragons
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';

const g = await createGame();
const d = g.mod('dragons');
g.give('spirits', 1e6); g.give('knowledge', 1e12);
g.setLevel(7);
check('cap formula (DragonNestUI.cap)', near(d.cap(0), 4) && near(d.cap(10), 4 * Math.pow(1.33, Math.pow(10, 1.007))));
check('not available before the nest is built', !d.available());
d.debug.buildNest(); g.run(5);   // tw-buildings' build animation
check('available after buildNest', d.available());
check('debug gives 10 keepers', g.host.skillLevel('summon_dragon_keeper') >= 10);
g.run(12);
check('keepers level the dragon', d.level > 0 || d.xp > 0, `level ${d.level} xp ${d.xp}`);
check('level-ups grant ability points', d.points() === d.level, `points ${d.points()} level ${d.level}`);
check('pulse of knowledge active from level 0', d.abilityValue('pulse_of_knowledge') === 30);

d.debug.level10();
check('telepathy at Lv 10 -> academy_exp x5', near(g.host.mult('academy_exp'), 5));
d.debug.level20();
d.breathT = 0; d.fireballT = 0; const m0 = g.host.res('magic'); d.debug.breathNow(); g.run(6);
const want = g.host.cloudlingMagic() * 55;
check('magic breath = 55 cloudlings of magic', near(g.host.res('magic') - m0, want, 0.05), `${g.host.res('magic') - m0} vs ${want}`);
d.debug.level36();
check('treasure keeper -> magic_gold_speed x3', near(g.host.mult('magic_gold_speed'), 3));
d.debug.level50();
check('elder dragon at 50 (stage 4)', d.stageIdx() === 4);
const p0 = d.points(); d.upgradeAbility('fireballs', 2);
check('upgrade spends points', d.points() === p0 - 2 && d.abilityLevel('fireballs') === 2);
check('fireball base value 150 x 1.2', near(d.abilityValue('fireballs'), 180));

// wall stub
const hits: any[] = []; const statuses: any[] = [];
const realSiege = g.host.modules.siege;
(g.host.modules as any).siege = { targetable: () => true, wallY: () => 60, statusStacks: (id: string) => id === 'molten' ? 10 : 0,
  damage: (a: number, s: string, x: number, y: number) => { hits.push([a, s, x, y]); return a; }, addStatus: (id: string, n: number) => statuses.push([id, n]) };
d.fireballT = 0; d.breathT = 0; d.setQueen(0); d.fireball(); g.run(8);
check('fireball reaches the wall', hits.length === 1 && hits[0][1] === 'dragon' && d.fireballs.length === 0, JSON.stringify(hits));
check('molten stacks boost fireball (+3%/stack)', hits.length > 0 && near(hits[0][0], 180 * 1.3));
hits.length = 0;
d.fireballT = 0; d.setQueen(true); d.fireball(); g.run(8);
check('queen splits the fireball in two', hits.length === 2, JSON.stringify(hits.map(h => h[1])));
d.setQueen(0);
const r: any = g.host.modules.runes;
if (r && r.debug) {
  hits.length = 0;
  const realRune = r.runeLevel; r.runeLevel = (id: string) => ({ fireball_shrapnel: 1, shrapnel_molten: 1 } as any)[id] || 0;
  d.fireballT = 0; d.fireball(); g.run(10);
  const shr = hits.filter(h => h[1] === 'fireball_shrapnel').length;
  check('fireball shrapnel (10 shards) hits the wall', shr === 10, `${shr} shards`);
  check('shrapnel applies molten', statuses.some(s => s[0] === 'molten'));
  r.runeLevel = realRune;
}
(g.host.modules as any).siege = realSiege;

// save / load / reset
const snap = JSON.stringify(d.save());
d.reset(false);
check('reset wipes the dragon', d.level === 0 && d.points() === 0 && d.abilityLevel('fireballs') === 0);
d.load(JSON.parse(snap));
check('load restores level and abilities', d.level === 50 && d.abil.fireballs === 2);
g.draw(); g.panel('dragons');
check('no module errors', g.log.errors.length === 0, g.log.errors.slice(0, 5).join('\n'));
done();
