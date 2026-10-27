// Alchemy + Relics: alchemists make exp -> Magic Gold, relic crafting, relic multipliers, save/load, reset.
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';

const g = await createGame({ level: 6, modules: ['alchemy'] });
const A: any = g.mod('alchemy');
check('alchemy registered', !!A && typeof A.relicLevel === 'function');
g.give('spirits', 100); g.buy('summon_alchemist', 40);
g.run(20);
// 40 alchemists x 1 exp / 4 s x 20 s ~ 200 exp; caps 20, 23.5, 25.9, ... -> several Magic Gold
check('magic gold accrues', A.relicLevel('magic_gold') >= 5, `mg=${A.relicLevel('magic_gold')} level=${A.level}`);
check('cap formula', near(A.cap(), 20 * Math.pow(1.175, Math.pow(A.level, 0.7))));

// crafting: 10 MG -> base relic; 10 + 10 base -> combined relic
g.give('magic_gold', 1000); g.run(0.1);
const mg0 = A.relicLevel('magic_gold');
check('craft mana stone', A.craft('mana_stone', 20) === 20 && A.relicLevel('mana_stone') === 20);
check('craft spends magic gold', near(A.relicLevel('magic_gold'), mg0 - 200));
A.craft('cognite', 10); A.craft('dragonite', 10);
check('craft philosopher stone', A.craft('philosopher_stone', 1) === 1 && A.relicLevel('cognite') === 0 && A.relicLevel('mana_stone') === 10);
check('craft holy grail', A.craft('holy_grail', 1) === 1 && A.relicLevel('mana_stone') === 0 && A.relicLevel('dragonite') === 0);
check('cannot craft without ingredients', A.craft('ouroboros', 1) === 0);

// relic multipliers (Resources.get_magic_bonuses / get_knowledge_bonuses, DragonNestUI.get_exp_bonus)
const m = A.multipliers(), mg = A.relicLevel('magic_gold');
check('magic mult', near(m.magic, 1 + (mg * 5 + 3000 + 1500) / 100), `${m.magic}`);
check('knowledge mult', near(m.knowledge, 1 + 4000 / 100), `${m.knowledge}`);
check('dragon exp mult', near(m.dragon_exp, 1 + 3000 / 100), `${m.dragon_exp}`);

// save / load round trip and reset
const s = JSON.stringify(A.save());
A.reset(); check('reset clears level', A.level === 0 && A.xp === 0);
A.load(JSON.parse(s)); check('load restores', JSON.stringify(A.save()) === s);

g.draw(); g.panel('alchemy');
for (const [k, f] of Object.entries(A.debug)) (f as any)();
g.run(2);
check('no module errors', g.log.errors.length === 0, g.log.errors.join('\n'));
done();
