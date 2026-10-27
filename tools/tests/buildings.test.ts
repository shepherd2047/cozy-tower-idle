// Building (tower 5) + Academy (modules/buildings.ts, modules/academy.ts): building points per ascension, small houses
// + multipliers, big-building build animation -> hasBuilding, house layout (fixed sizes, lazy art), academy nav,
// sages -> training EXP -> levels -> multipliers, Netus-gated Great University, island lift, save/load, reset.
// Run: bun run tools/testkit/run.ts buildings
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';

const g = await createGame();
const b = g.mod('buildings'), a = g.mod('academy');
g.setLevel(5);
g.run(0.1);
check('4 building points on reaching tower 5', near(g.host.res('building_points'), 4), String(g.host.res('building_points')));
g.setLevel(6); g.run(0.1);
check('+4 per later ascension', near(g.host.res('building_points'), 8));

g.give('building_points', 40);
g.buy('build_house', 3); g.buy('build_book_house', 2); g.buy('build_tree_house', 1);
check('houses placed', b.houses.length === 6);
check('spirit houses: magic x1.15^3', near(b.multipliers().magic, Math.pow(1.15, 3)));
check('book houses: knowledge x1.15^2', near(b.multipliers().knowledge, Math.pow(1.15, 2)));
check('first house at the left start, sizes from the art table (not lazy D.size)', b.houses[0].x === 50 && b.houses[0].w > 0 && b.houses[0].h > 0);
check('houses do not overlap', b.houses.slice(1).every((h: any, i: number) => h.x + h.w / 2 + 2 <= b.houses[i].x - b.houses[i].w / 2 + 0.01));
g.give('building_points', 20);
g.buy('build_house', 7);   // 13 houses: the 13th starts the right-hand row
check('13th house starts the right row at x=804', b.houses[12].x === 804);

check('academy nav hidden before build', !a.available());
g.give('knowledge', 1e8);
g.buy('build_academy'); g.buy('build_dragon_nest'); g.buy('build_embassy');
check('bought but still assembling', a.available() && !b.hasBuilding('academy'));
g.run(4);
check('build animation finishes -> hasBuilding', b.hasBuilding('academy') && b.hasBuilding('dragon_nest') && b.hasBuilding('embassy'));

g.give('spirits', 100);
g.buy('summon_spirit_sage', 20);
check('first sage selects Magic Research', a.T.magic_101.selected);
g.run(20);
check('sages level Magic Research', a.trainingLevel('magic_101') > 0, JSON.stringify(a.T.magic_101));
check('cloudling_magic multiplier from Magic Research', near(a.multipliers().cloudling_magic, 1 + a.trainingLevel('magic_101') * 0.05));
g.buy('unlock_herbology');
check('unlock_herbology unlocks + selects Forestry Research', a.T.herbology.unlocked && a.T.herbology.selected && !a.T.magic_101.selected);
const lv0 = a.T.herbology.level; g.run(15);
check('Forestry Research levels', a.T.herbology.level > lv0);
check('textbooks double EXP', (() => { g.buy('herbology_textbooks', 1); return near((a as any).expBonus('herbology'), 2); })());
check('Great University hidden without Netus', !g.host.modules.academy.skills.improved_facilities_2.visible!(g.host));
const e: any = g.host.modules.embassy;
if (e && e.establish) {
  e.establish('netus_nation', true);
  check('Great University visible with Netus', !!a.skills.improved_facilities_2.visible!(g.host));
}

g.setLevel(8); g.run(3);
check('academy island raised 200 px at tower 8', near(b.academyIsland()[1], 153, 1));
check('dragon island raised 100 px at tower 8', near(b.dragonIsland()[1], 255, 1));

check('panels draw', !!g.panel('buildings') && !!g.panel('academy'));
g.draw();
for (const k of Object.keys(b.debug)) b.debug[k]();
for (const k of Object.keys(a.debug)) a.debug[k]();
g.run(2);

// save / load
const sb = JSON.parse(JSON.stringify(b.save())), sa = JSON.parse(JSON.stringify(a.save()));
const nh = b.houses.length, lv = a.trainingLevel('magic_101');
b.load(sb); a.load(sa);
check('save/load keeps houses and research', b.houses.length === nh && a.trainingLevel('magic_101') === lv);
b.reset(true); a.reset(true);
check('reset clears houses and research', b.houses.length === 0 && a.T.magic_101.level === 0);
check('no module errors', g.log.errors.length === 0, g.log.errors.join('\n'));
done();
