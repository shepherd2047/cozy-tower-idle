// Sorcery (modules/sorcery.ts): units attack the Cloud Wall through siege, status stacks, curse pop, damage chart,
// totem rule for shamans, no double Combat Magic, stand-in wall without siege, save/load, reset, debug buttons.
// Run: bun run tools/testkit/run.ts sorcery
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';

const g = await createGame({ level: 7, modules: ['sorcery', 'siege'] });
const m: any = g.mod('sorcery'), s: any = g.mod('siege');
s.debug['Siege: Cloud Wall (T7)']();
g.run(0.5);
check('Cloud Wall targetable at tower 7', s.targetable());

g.give('spirits', 100);
g.buy('summon_gorgon', 10); g.buy('summon_shaman', 10); g.buy('summon_ifrit', 10); g.buy('summon_zephyr', 10);
check('summons cost 2 spirits each', near(g.host.res('spirits'), 100 - 80));
g.S.skills.carve_magic_totem = 4;   // shaman damage = 1 x count of the most common totem type
check('shaman base uses most common totem type', near(m.shamanBase(), 4));
g.run(12);
check('units simulated', m.units.gorgon.length === 10 && m.units.zephyr.length === 10);
check('units hover below the wall', m.units.gorgon.every((u: any) => u.y > s.wallPos()[1]));
const hp0 = s.dmgTaken;
check('wall took damage', hp0 > 0, `dmgTaken=${hp0}`);
check('zephyr wind stacks Weakened', s.statusStacks('weakened') > 0);
m.calcChart();
const ids = m.chart.rows.map((r: any) => r.id);
check('chart has gorgon / shaman / ifrit rows', ['gorgon', 'shaman', 'ifrit'].every(id => ids.includes(id)), ids.join(','));
check('chart total = sum of rows (no repair)', near(m.chart.total, m.chart.rows.reduce((a: number, r: any) => a + r.v, 0)));
check('siege feeds the chart (no double count)', m.extFeed === true);

// Combat Magic is applied once, by siege.damage (multipliers() stays empty)
check('sorcery multipliers empty', Object.keys(m.multipliers()).length === 0);
const before = s.damageMult();
g.S.skills.combat_magic = 2;
check('combat magic +50%/level applied once', near(s.damageMult() / before, 2));
g.S.skills.combat_magic = 0;

// Curse: pops the moment Cursed reaches 100, deals shaman-based damage, clears the stacks
const curseBefore = (m.buckets.curse ? Object.values(m.buckets.curse) as number[] : []).reduce((a, b) => a + b, 0);
m.debug['Curse pop (100 Cursed)']();
check('cursed cleared after pop', s.statusStacks('cursed') < 1);
check('curse effect shown', !!m.curse);
const curseAfter = (Object.values(m.buckets.curse || {}) as number[]).reduce((a, b) => a + b, 0);
check('curse damage recorded', curseAfter > curseBefore);
check('curse base = shaman base x shamans', near(m.curseBase(), m.shamanBase() * 10 * g.host.mult('curse_damage')));

// unit cap: more than 60 per type are simulated as 60, each hit scaled
g.give('spirits', 400); g.buy('summon_gorgon', 110);
g.run(1);
check('gorgons capped at 60 simulated', m.units.gorgon.length === 60 && m.weight('gorgon') === 2);

// draw + panel + debug
const calls = g.draw();
check('draws units', calls.some((c: any) => c[1] === 'gorgon' || (Array.isArray(c) && c.includes('gorgon'))) || calls.length > 50, `calls=${calls.length}`);
check('panel draws', !!g.panel('sorcery'));
m.chartOpen = true; m.manualOpen = true; m.infoId = 'm:gorgon'; g.panel('sorcery');
for (const k of Object.keys(m.debug)) m.debug[k]();
g.run(2);

// save / load / reset
const sv = JSON.parse(JSON.stringify(m.save()));
m.load(sv);
check('load restores chart buckets', Object.keys(m.buckets).length === Object.keys(sv.buckets).length);
g.run(0.2);
check('units re-synced after load', m.units.shaman.length === Math.min(60, g.S.skills.summon_shaman));
m.reset(true);
check('reset clears units and chart', m.units.gorgon.length === 0 && Object.keys(m.buckets).length === 0);
check('no module errors', g.log.errors.length === 0, g.log.errors.join('\n'));

// without a siege module: stand-in wall still shows the units off
const g2 = await createGame({ level: 7, modules: ['sorcery'] });
const m2: any = g2.mod('sorcery');
g2.give('spirits', 20); g2.buy('summon_gorgon', 5); g2.buy('summon_zephyr', 3);
g2.run(10);
check('stand-in wall takes damage', m2.local.dmg > 0 && m2.nums.length >= 0);
check('stand-in status stacks', (m2.local.status.weakened || 0) > 0);
g2.draw(); g2.panel('sorcery');
check('no module errors (stand-in)', g2.log.errors.length === 0, g2.log.errors.join('\n'));
done();
