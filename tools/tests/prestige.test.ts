// Prestige + Blessings logic: XP / points, panel flow (taps through onTap), reset animation, blessing purchase,
// host.resetRun, kept data, multipliers, early + damage prestige, run-start blessings, doubling, save/load, draw passes.
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';

const g = await createGame({ level: 0 });
const h: any = g.host, p: any = g.mod ? g.mod('prestige') : h.modules.prestige;
p.debugReset();
const ignorable = (e: string) => /buy: unknown skill (summon_spirit|craft_totem)/.test(e);   // core skills are not in the fake host
const errors = () => g.log.errors.filter(e => /prestige/.test(e) && !ignorable(e));
const tap = (id: string) => { const r = p.regions.find((r: any) => r.id === id); if (!r) return false; return p.onTap(r.x + r.w / 2, r.y + r.h / 2); };
const frame = () => { g.draw(); };

check('module registered', !!p && p.id === 'prestige');
check('no prestige star before tower 4', (frame(), !p.regions.some((r: any) => r.id === 'hud')));

// ---------------------------------------------------------------- XP and points
h.addResource('magic', 365000); g.run(0.1);
check('365K magic -> 5 points (base 700)', p.s.run === 5 && p.s.level === 5, JSON.stringify({ run: p.s.run, level: p.s.level }));
check('cap formula: level 0 cap = 700', near(p.cap.call({ s: { level: 0 } }), 700));
g.setLevel(4); frame();
check('star shows at tower 4', p.unlocked && p.regions.some((r: any) => r.id === 'hud'));

// ---------------------------------------------------------------- panel flow by taps
check('tapping the star opens the panel', tap('hud') && p.mode === 'info');
frame();
check('tile tap selects', tap('bless_knowledge_blessing') && p.sel === 'knowledge_blessing');
frame(); tap('prestige'); check('Prestige -> confirm', p.mode === 'confirm');
frame(); tap('cancel'); check('Cancel -> info', p.mode === 'info');
frame(); tap('prestige'); frame(); tap('confirm');
check('Confirm -> reset animation', p.mode === 'anim');
g.run(1); frame();
g.run(3);
check('animation ends on the blessings screen with points banked', p.mode === 'assign' && p.s.banked === 5 && p.s.run === 0 && p.s.count === 1,
  JSON.stringify({ mode: p.mode, banked: p.s.banked, run: p.s.run }));

// ---------------------------------------------------------------- buy blessings
frame();
for (const [id, n] of [['magic_gain_blessing', 2], ['knowledge_blessing', 2], ['forestry_blessing', 1]] as [string, number][]) {
  tap('bless_' + id); for (let i = 0; i < n; i++) { frame(); tap('buy'); }
}
check('bought Magic 2, Knowledge 2, Forest 1', p.s.bl.magic_gain_blessing === 2 && p.s.bl.knowledge_blessing === 2 && p.s.bl.forestry_blessing === 1 && p.s.banked === 0, JSON.stringify(p.s.bl));
check('max level respected', !p.buyBlessing('magic_gain_blessing'));
frame(); tap('refund'); check('refund gives the point back', p.s.bl.forestry_blessing === 0 && p.s.banked === 1);
frame(); tap('buy');
p.s.banked++; check('locked row cannot be bought', !p.buyBlessing('blessing_of_fire') && p.s.bl.blessing_of_fire === undefined); p.s.banked--;

// ---------------------------------------------------------------- next run
frame(); tap('next');
g.run(0.1);
check('Next Run: host.resetRun -> tower 0, no resources', h.towerLevel() === 0 && h.res('magic') === 0 && p.mode === 'closed');
check('kept: level, count, blessings', p.s.level === 5 && p.s.count === 1 && p.s.bl.magic_gain_blessing === 2);
check('multipliers: magic x4, knowledge x4, wood x2.5', near(h.mult('magic'), 4) && near(h.mult('knowledge'), 4) && near(h.mult('wood'), 2.5),
  [h.mult('magic'), h.mult('knowledge'), h.mult('wood')].join(','));
check('later runs skip the intro', p.skipIntro() === true);
g.setLevel(4); g.run(0.1);
check('Blessing of the Beacon: x1.5 magic / wood at tower 4', near(h.mult('magic'), 6) && near(h.mult('wood'), 3.75));
g.setLevel(0);

// ---------------------------------------------------------------- early + damage prestige
check('Early Prestige offered below tower 4 with blessings', p.early && p.canPrestige);
const r0 = p.s.run; p.onDamage(4.1e4);
check('Damage Prestige: 41K wall damage -> 1 point', p.s.dlevel === 1 && p.s.run === r0 + 1);
p.addDamageExpPercent(50);
check('Tome Master hook adds damage xp', p.s.dxp > 0);

// ---------------------------------------------------------------- other modules read blessings
check('alias spirit_debt_blessing', p.blessingLevel('spirit_debt_blessing') === p.blessingLevel('spirit_debt'));
check('automatic blessings follow owned points', p.blessingLevel('prestige_blessing') === 1 && p.blessingLevel('blessing_of_the_tower') === 0);

// ---------------------------------------------------------------- unlock all -> Final Blessing of the Tower + Debt
p.debugUnlockAll();
check('unlock all: every blessing at max', p.blessingLevel('spirit_debt') === 1 && p.blessingLevel('blessing_of_the_tower_3') === 1 && p.blessingLevel('forest_keeper_blessing') === 2);
p.s.auto = false; p.s.autoTotems = false;
p.openPanel(); p.doPrestige(); g.run(4);
check('early prestige also ends on the blessings screen', p.mode === 'assign');
p.nextRun(); g.run(0.1);
check('Final Blessing of the Tower: run starts at tower 7', h.towerLevel() === 7, 'level ' + h.towerLevel());
check('Blessing of Debt: -100 spirits, 20 cloudlings / druids', h.res('spirits') <= -100 + 1e-9 && h.skillLevel('summon_cloudling') >= 20 && h.skillLevel('summon_druid') >= 20,
  JSON.stringify({ sp: h.res('spirits'), c: h.skillLevel('summon_cloudling'), d: h.skillLevel('summon_druid') }));

// ---------------------------------------------------------------- doubling + spirit bonuses
const c0 = h.skillLevel('summon_cloudling'); h.setSkillLevel('summon_cloudling', c0 + 1); g.run(0.1);
check('Blessing of Doubling: one summon counts twice', h.skillLevel('summon_cloudling') === c0 + 2, `${c0} -> ${h.skillLevel('summon_cloudling')}`);
check('Population boosts the biggest spirit type', p.spiritBonus(p['biggestPopulation']()) >= 2);

// ---------------------------------------------------------------- save / load
const saved = JSON.parse(JSON.stringify(p.save()));
p.debugReset(); check('debugReset wipes', p.s.level === 0 && p.assigned() === 0);
p.load(saved); check('load restores', p.s.level === saved.level && p.s.count === saved.count && p.s.bl.magic_gain_blessing === 2);

// ---------------------------------------------------------------- every draw mode
for (const m of ['info', 'confirm', 'assign']) { p.mode = m; frame(); }
p.mode = 'closed'; frame();
check('no prestige errors', errors().length === 0, errors().join('\n'));
done();
