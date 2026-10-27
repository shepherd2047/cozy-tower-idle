// Embassy mechanics (modules/embassy.ts): build gating, diplomats -> trade agreements, hold speed-up, nation adjacency
// and costs, instant bonuses, multipliers, Chronara, refund, diplomacy gold, map taps, save/load, reset.
// Run: bun run tools/testkit/run.ts embassy
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';

const g = await createGame();
const e: any = g.mod('embassy');
g.setLevel(5);
check('not available before build_embassy', !e.available());
e.debug['Embassy: build']();
g.run(3);   // block animation in buildings.ts
check('available once built', e.available() && e.built());
check('starting nation has relations', e.hasRelations('starting_nation'));
check('hasRelations accepts the short id', e.hasRelations('starting'));

// diplomats walk door -> portal (3 s) -> door: each round trip = 1 trade agreement
g.give('spirits', 50);
check('summon diplomats with spirits', g.buy('summon_diplomat', 20) === 20 && g.host.skillLevel('summon_diplomat') === 20);
g.run(30);
const ta = g.host.res('trade_agreements');
check('diplomats create trade agreements', ta >= 20, `${ta} after 30 s`);
check('diplomats visible while walking', e.diplomats.some((d: any) => !d.hidden));
check('hit area covers the building', e.hitWorld(675, 280) && !e.hitWorld(900, 100));
e.onHold(1 / 30, 675, 280);
check('hold speeds diplomats up (+35%, +5% click bonus at tower <= 6)', near(e.speedMult, 1.40));

// relations: adjacency + cost
g.give('trade_agreements', 10000);
const t0 = g.host.res('trade_agreements');
check('Fel is not adjacent yet', !e.establish('fel_nation') && !e.hasRelations('fel'));
check('Prismara costs 500', e.establish('prismara_nation') && near(t0 - g.host.res('trade_agreements'), 500));
check('magic_gold_speed x1.5 (Prismara)', near(g.host.mult('magic_gold_speed'), 1.5));
e.establish('tempestus_nation'); e.establish('verdania_nation');
check('cloudling_magic x2.5 (Tempestus)', near(g.host.mult('cloudling_magic'), 2.5));
check('wood x2.5 (Verdania)', near(g.host.mult('wood'), 2.5));
const alch: any = g.host.modules.alchemy;
const drag0 = alch && alch.relicLevel ? alch.relicLevel('dragonite') : 0;
e.establish('xara_nation');
const drag1 = alch && alch.relicLevel ? alch.relicLevel('dragonite') : 0;
check('Xara: +5 dragonite relic', !alch || drag1 - drag0 === 5, `${drag0} -> ${drag1}`);
check('Arcanis/Fel academy EXP is not in multipliers (academy.ts applies it)', e.multipliers().academy_exp === undefined);

// Chronara: hidden until Blessing of Exploration, then diplomats-count trade agreements every 2 s
check('Chronara hidden without the blessing', !e.nationVisible({ id: 'chronara_nation', hideUntilBlessing: true }));

// map taps (no document in Bun: nearest-flag picking)
g.panel('embassy');
check('map drawn once diplomats exist', !!e.mapRect);
const m = e.mapRect;
e.onTap(m.x + 50, m.y + 41);   // Arcanis flag (50, 35)
check('tap establishes an available nation (Arcanis)', e.hasRelations('arcanis'));
check('tap selects it for the tooltip', e.selected === 'arcanis_nation');

// everything -> refund
e.debug['Embassy: all relations']();
check('all relations', e.allHaveRelations());
const em = e.multipliers();
check('own multipliers: damage x2 (Janand), dragon_exp x4 (Ceha), knowledge x6.25, wood x6.25, cloudling x6.25, magic_gold_speed x3',
  near(em.damage, 2) && near(em.dragon_exp, 4) && near(em.knowledge, 6.25) && near(em.wood, 6.25) && near(em.cloudling_magic, 6.25) && near(em.magic_gold_speed, 3), JSON.stringify(em));
check('host mult includes them', g.host.mult('damage') >= 2 && g.host.mult('dragon_exp') >= 4);
g.give('trade_agreements', 100);
g.run(2.1);
const sp0 = g.host.res('spirits');
e.refundDiplomats();
check('refund clears diplomats and trade agreements', g.host.skillLevel('summon_diplomat') === 0 && g.host.res('trade_agreements') === 0);
g.run(8);
check('refund returns 20 spirits to the orb', near(g.host.res('spirits') - sp0, 20), `${g.host.res('spirits') - sp0}`);

// Blessing of Diplomacy gold flies to the alchemy area
const mg0 = g.host.res('magic_gold');
e.debug['Embassy: diplomacy gold x30']();
g.run(15);
check('diplomacy gold arrives as magic gold', g.host.res('magic_gold') - mg0 >= 30, `${g.host.res('magic_gold') - mg0}`);

// save / load / reset
const snap = JSON.parse(JSON.stringify(e.save()));
e.reset(false);
check('reset clears relations', !e.hasRelations('prismara') && e.hasRelations('starting'));
e.load(snap);
check('load restores relations', e.allHaveRelations());
check('draws without errors', (g.draw(), true));
check('no module errors', g.log.errors.length === 0, g.log.errors.join('\n'));
done();
