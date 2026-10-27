// Runecraft (modules/runes.ts): smiths -> strikes -> blank runes, rune tree rules (parent, depth cost, refining),
// summon runes, infinity upgrade reveal, multipliers, panel draw, save/load, reset, debug buttons.
// Run: bun run tools/testkit/run.ts runes
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';

const g = await createGame();
const r = g.mod('runes');
g.give('spirits', 1e6); g.give('knowledge', 1e13);
g.setLevel(7);
check('locked below tower 8', !g.host.isUnlocked('runes'));
g.setLevel(8);
check('unlocked at tower 8', g.host.isUnlocked('runes'));
check('obelisk + anvil positions', !!r.obeliskPos() && r.anvilPos()[1] === r.obeliskPos()[1] - 75);
check('cap formula (RuneExp.get_cap)', near(r.cap(), 450) && (r.level = 5, near(r.cap(), 450 * Math.pow(1.51, Math.pow(5, 0.74)))));
r.level = 0;

// smiths
g.buy('summon_rune_smith', 10);
check('10 rune smiths bought for 2 spirits each', g.host.skillLevel('summon_rune_smith') === 10);
g.run(12);
check('smiths strike the anvil (exp)', r.xp > 0 || r.level > 0, `xp ${r.xp} level ${r.level}`);
check('drawn smiths = summoned', r.smiths.length === 10);
const xp0 = r.xp, lv0 = r.level; r.addExp(1);
check('addExp(1) = 1 exp x bonus', near(r.xp, xp0 + r.expBonus()) || r.level > lv0);
g.buy('rune_mastery', 1);
check('rune mastery doubles exp bonus', near(r.expBonus(), 2 * (g.host.mult('crafting') || 1) * (g.host.mult('rune_exp') || 1)));
const b0 = g.host.res('blank_rune'); r.debug.forgeRune(); g.run(0.1);
check('a full bar forges 1 blank rune', g.host.res('blank_rune') === b0 + 1, `${g.host.res('blank_rune')} vs ${b0 + 1}`);

// tree rules
r.debug.blankRunes50(); g.run(0.1);
const br = g.host.res('blank_rune');
check('child needs its parent', !r.canBuy('fire_arrows') && !r.buy('fire_arrows'));
check('depth-1 rune costs 1', r.buy('create_shamans') && near(g.host.res('blank_rune'), br - 1));
check('create_shamans gives 10 shamans', g.host.skillLevel('summon_shaman') >= 10);
check('depth-2 rune costs 2', r.buy('fire_arrows') && near(g.host.res('blank_rune'), br - 3));
check('level 1 cap without refining', !r.canBuy('fire_arrows') && r.runeLevel('fire_arrows') === 1);
r.buy('create_gorgons'); r.buy('infinity');
check('infinity rune reveals Infinity Rune upgrade', r.skills.infinity_rune_upgrade.visible!(g.host));
g.buy('infinity_rune_upgrade', 2);
check('infinity upgrade costs blank runes (1 + L)', g.host.skillLevel('infinity_rune_upgrade') === 2 && near(r.infinityBonus(), 1.6));
r.buy('wood_rune'); r.buy('alchemy_rune');
check('wood rune -> mult(wood) includes x3', g.host.mult('wood') >= 3 - 1e-9);
check('runeValue alias (alchemy -> alchemy_rune = 200)', r.runeValue('alchemy') === 200);
check('ownedRunes keeps purchase order', r.ownedRunes().slice(0, 3).join(',') === 'create_shamans,fire_arrows,create_gorgons');
check('runeIcon for registry ids', r.runeIcon('dragon') === 'dragon_rune' && r.runeIcon('fusion') === 'armor_melt');

// refining: upgradable to max_level
r.debug.toggleRefining();
check('refining lifts the cap to max_level', r.canBuy('fire_arrows') && r.buy('fire_arrows') && r.runeLevel('fire_arrows') === 2);
check('runeValue scales with level (fire_arrows 5 x 2)', r.runeValue('fire_arrows') === 10);
r.debug.toggleRefining();

// whole tree
r.debug.maxAllRunes();
check('all 34 runes + root unlocked', r.numRunesUnlocked() === 35, String(r.numRunesUnlocked()));
check('maxed runes at .tres max_level', r.runeLevel('shrapnel_count') === 3 && r.runeLevel('hot_blooded') === 1);
check('arc is not in the tree', r.runeLevel('arc') === 0);

// panel draws
(g.host.D as any).begin(); const rect = g.panel('runes'); const calls = (g.host.D as any).calls;
check('panel returns its rect', !!rect && rect.w > 0 && rect.h > 0, JSON.stringify(rect));
check('panel draws the tree icons', JSON.stringify(calls).includes('fireball_shrapnel_rune'));

// save / load / reset
const snap = JSON.stringify(r.save());
r.reset(false);
check('reset clears tree, bar and blank runes', r.numRunesUnlocked() === 1 && r.level === 0 && g.host.res('blank_rune') === 0);
r.load(JSON.parse(snap));
check('save/load round trip', JSON.stringify(r.save()) === snap);

// debug buttons don't throw
for (const k of Object.keys(r.debug)) { try { r.debug[k](); } catch (e) { check('debug ' + k, false, String(e)); } }
g.run(2);
check('no module errors', g.log.errors.length === 0, g.log.errors.join('\n'));
done();
