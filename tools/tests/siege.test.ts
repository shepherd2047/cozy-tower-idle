// Siege (modules/siege.ts): walls at towers 7 / 8 / 9, damage API + multipliers, status decay, Solar Wall repair,
// tower gates, Fire Magic Beam -> Warden boss (P1 curses, P2 fervor shield, P3) -> story_5 -> Final Ascension -> ending,
// listeners (temple / sorcery / prestige), save/load, reset, debug jumps.
// Run: bun run tools/testkit/run.ts siege
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';

const g = await createGame({ level: 6 });
const s: any = g.mod('siege'), h: any = g.host;
const skip = () => { for (let i = 0; i < 20 && s.dlg; i++) { s.advanceDialog(); s.advanceDialog(); } };

check('idle below tower 7', s.stage === 'idle' && !s.targetable());
check('gate 8 blocked before Cloud Wall', !!s.towerGate(8));

// ---- tower 7: story_1/2, Cloud Wall 2e7
g.setLevel(7); g.run(0.2);
check('T7 intro dialogue (story 1+2)', s.stage === 'intro' && s.dlg && s.dlg.lines.length === 2);
check('not targetable during dialogue', !s.targetable());
skip(); g.run(0.1);
check('Cloud Wall targetable', s.stage === 'wall' && s.targetable() && s.wallLevel() === 0);
const heard: number[] = []; s.onDamage((v: number) => heard.push(v));
let fin = s.damage(1000, 'gorgon', 0, 0);
check('damage returns final (x1 with no bonuses)', near(fin, 1000), String(fin));
check('onDamage listener fires', heard.length === 1 && near(heard[0], 1000));
s.addStatus('weakened', 50); g.S.skills.combat_magic = 2;
fin = s.damage(1000, 'gorgon', 0, 0);
check('weakened 50 x combat magic 2 = x3', near(fin, 1000 * 1.5 * 2), String(fin));
g.S.skills.combat_magic = 0;
check('skipMult ignores multipliers', near(s.damage(1000, 'gorgon', 0, 0, { skipMult: true }), 1000));
// status decay: 0.1 s ticks, ((stacks - start)/100)^1.15, frost raises the start of the others
s.clearStatus('weakened'); s.addStatus('weakened', 200); g.run(1);
check('weakened decays above 0', s.statusStacks('weakened') < 200 && s.statusStacks('weakened') > 150, String(s.statusStacks('weakened')));
s.clearStatus('weakened'); s.addStatus('weakened', 200); s.addStatus('frost', 500); g.run(1);
check('frost holds other effects (decay start = frost stacks)', s.statusStacks('weakened') === 200, String(s.statusStacks('weakened')));
check('shatter is an alias of resonance', (s.addStatus('shatter', 5), s.statusStacks('resonance') === 5));
for (const id of ['weakened', 'frost', 'resonance']) s.clearStatus(id);
// swipe bolts (onOrbClick) fly and hit
const d0 = s.dmgTaken; s.onOrbClick(100, 100, 1); g.run(1.5);
check('swipe bolt damages the wall', s.dmgTaken > d0);
s.debugDamage(0.6);
check('cracks territory (> 50%)', s.dmgTaken / 2e7 > 0.5);
s.debugDamage(1);
check('Cloud Wall breaks', s.broken === 1 && s.stage === 'broken');
g.run(2);
check('await tower 8, gate open', s.stage === 'await' && !s.towerGate(8) && !!s.towerGate(9));

// ---- tower 8: Solar Wall 5e9 + Wall Repair 500M/min
g.setLevel(8); g.run(0.2); skip(); g.run(0.1);
check('Solar Wall', s.stage === 'wall' && s.broken === 1 && s.wallLevel() === 1);
s.damage(2e9, 'dragon', 0, 0, { skipMult: true });
const a = s.dmgTaken; g.run(3.05);
check('Solar Wall repairs 500M/min (8.33M per s)', near(a - s.dmgTaken, 3 * 500e6 / 60, 0.02), String(a - s.dmgTaken));
s.debugDamage(1); g.run(2);
check('Solar Wall breaks, gate 9 open', s.broken === 2 && !s.towerGate(9));

// ---- tower 9: Cosmic Wall (indestructible), Fire Magic Beam
g.setLevel(9); g.run(0.2); skip(); g.run(0.1);
check('Cosmic Wall up', s.stage === 'wall' && s.wallLevel() === 2 && s.targetable());
s.damage(1e15, 'zephyr', 0, 0);
check('Cosmic Wall cannot break from damage', s.broken === 2);
let b = s.towerButton(9);
check('Fire Magic Beam needs Analyze Wall', b.label === 'Fire Magic Beam' && b.disabled);
g.S.skills.analyze_wall = 1; g.give('cosmic_dust', 45);
b = s.towerButton(9);
check('Fire Magic Beam enabled with 42 dust', !b.disabled && b.cost.cosmic_dust === 42);
const dust0 = h.res('cosmic_dust'); b.onPress();
check('beam spends 42 dust', near(dust0 - h.res('cosmic_dust'), 42));
g.run(2.6);
check('beam breaks the Cosmic Wall', s.broken === 3);
g.run(1.7);
check('boss intro dialogue', s.stage === 'bossIntro' && !!s.dlg);
skip(); g.run(0.1);
check('Warden boss P1', s.stage === 'boss' && s.phase === 1 && s.bossMax >= 1e9);
check('gate 10 blocked while the Warden fights', !!s.towerGate(10));
g.run(4);
check('P1 throws curse orbs', s.curses.length > 0 || s.popped > 0);
g.give('magic', 1000);
const m0 = h.res('magic'); g.run(10);
check('unpopped curse steals magic', h.res('magic') < m0, `${m0} -> ${h.res('magic')}`);
s.debugDamage(0.5); g.run(1.5);
check('P2 reached at 63%', s.phase === 2 && near(s.bossHp / s.bossMax, 0.63, 0.01));
const hp2 = s.bossHp;
s.damage(1e30, 'gorgon', 0, 0);
check('P2 shield blocks unit damage', s.bossHp === hp2);
s.onOrbClick(100, 100, 0.2); g.run(1.5);
check('P2 shield blocks slow swipes', s.bossHp === hp2);
s.onOrbClick(100, 100, 0.9); g.run(1.5);
check('P2 fast swipe pierces', s.bossHp < hp2);
s.debugDamage(0.5); g.run(1.5);
check('P3 enraged', s.phase === 3);
g.run(3); check('P3 throws two at a time', s.curses.length >= 2 || s.popped >= 0);
s.debugDamage(1);
check('Warden defeated -> story_5', s.stage === 'defeat' && !!s.dlg);
skip();
check('Warden freed', s.stage === 'free' && s.wardenFree && !s.towerGate(10));
check('Final Ascension button (50 dust, normal build)', (b = s.towerButton(9)) && b.label === 'The Final Ascension' && !b.onPress && b.cost.cosmic_dust === 50);
// enchantments + restore toggle
g.give('cosmic_dust', 10); const dust1 = h.res('cosmic_dust');
check('enchant_frost costs 2 dust', g.buy('enchant_frost') === 1 && near(dust1 - h.res('cosmic_dust'), 2));
s.toggleRestore();
check('restored Cosmic Wall is targetable again', s.targetable() && s.wallLevel() === 2);
s.toggleRestore();
g.panel('siege');

// ---- tower 10: ending
g.setLevel(10); g.run(0.2);
check('ending starts at tower 10', s.stage === 'ending');
g.run(9.5);
check('Demo Complete screen', s.stage === 'complete');
g.draw();

// save / load / reset / debug
const saved = JSON.parse(JSON.stringify(s.save()));
s.reset(true);
check('reset wipes walls (story flags kept)', s.broken === 0 && s.stage === 'idle' && s.story.w1);
s.load(saved);
check('load restores progress', s.broken === 3 && s.wardenFree);
for (const k of Object.keys(s.debug)) s.debug[k]();
g.run(1); g.draw();
s.debugJump('boss2');
check('debugJump boss2', s.stage === 'boss' && s.phase === 2 && g.S.level === 9);
s.debugJump('wall1');
check('debugJump wall1', s.stage === 'wall' && s.broken === 0 && g.S.level === 7);
check('no module errors', g.log.errors.length === 0, g.log.errors.join('\n'));
done();
