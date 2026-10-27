// Temple / Observatory / Obelisk mechanics (modules/temple.ts, observatory.ts, obelisk.ts): cosmic dust from wall
// damage, the four masters + upgrades, Analyze Wall gate, analysis multipliers, glyphs, save/load, reset.
// Run: bun run tools/testkit/run.ts temple
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';

const g = await createGame();
const t = g.mod('temple'), o = g.mod('observatory'), ob = g.mod('obelisk');
check('modules registered', !!t && !!o && !!ob);
g.setLevel(8);
check('temple locked below tower 9', !g.host.isUnlocked('temple') && !g.host.isUnlocked('observatory'));
const lvl0 = t.level; t.onWallDamage(1e9); g.run(2);
check('no dust before tower 9', t.level === lvl0 && g.host.res('cosmic_dust') === 0);

g.setLevel(9);
check('cap formula (TempleExp.get_cap)', near(t.cap(0), 3.5) && near(t.cap(10), 3.5 * Math.pow(1.23, Math.pow(10, 1.03))));
// cosmic dust: through siege's damage hook when present, else the temple hook
const siege: any = g.host.modules.siege;
const viaSiege = !!(siege && siege.onDamage && siege.listeners);
if (viaSiege) for (const fn of siege.listeners) fn(300 * 100, 'test', 2); else t.onWallDamage(300 * 100);
g.run(4);
check('wall damage -> cosmic dust', g.host.res('cosmic_dust') > 0, `dust ${g.host.res('cosmic_dust')} level ${t.level} via ${viaSiege ? 'siege listeners' : 'temple hook'}`);
// 100 exp total at bonus 1: count levels by hand
let e = 100, L = 0; while (e >= t.cap(L)) { e -= t.cap(L); L++; }
check('100 exp gives the TempleExp level count', t.level === L, `${t.level} vs ${L}`);

// masters
g.give('cosmic_dust', 100); g.give('spirits', 1000);
for (const id of ['summon_tome_master', 'summon_forest_keeper', 'summon_dragon_queen', 'summon_smith_master']) g.buy(id);
check('masters bought (2 dust each)', ['tome_master', 'forest_keeper', 'dragon_queen', 'smith_master'].every(k => t.owned(k)));
check('summons take 30 spirits each', near(g.host.res('spirits'), 1000 - 120));
check('summon spirits in flight', t.spirits.length > 0);
g.run(5);
check('masters faded in', Object.values(t.alpha).every((a: any) => a === 1), JSON.stringify(t.alpha));
check('tome master knowledge x2', near(g.host.mult('knowledge') / (g.host.modules.prestige ? 1 : 1), g.host.mult('knowledge')) && t.multipliers().knowledge === 2);
check('forest keeper wood x4', t.multipliers().wood === 4);
check('smith master magic_gold x2', t.multipliers().magic_gold === 2);
g.buy('upgrade_tome_master', 3); g.buy('upgrade_forest_keeper', 2); g.buy('upgrade_smith_master', 2);
check('upgrades compound', near(t.multipliers().knowledge, 2 * 1.4 ** 3) && near(t.multipliers().wood, 4 * 1.5 ** 2) && near(t.multipliers().magic_gold, 1 + 1.3 ** 2));
check('forest keeper speeds dust exp', near(t.expBonus(), 1.5 * 1.15 ** 2));

// smith master strikes the anvil into runes.addExp; queen feeds dragons.addExp
const runes: any = g.host.modules.runes, dragons: any = g.host.modules.dragons;
const rx: number[] = [], dx: number[] = [];
if (runes) { const f = runes.addExp.bind(runes); runes.addExp = (n: number) => { rx.push(n); return f(n); }; }
if (dragons) { const f = dragons.addExp.bind(dragons); dragons.addExp = (n: number) => { dx.push(n); return f(n); }; }
g.host.setSkillLevel('summon_rune_smith', 5); g.host.setSkillLevel('summon_dragon_keeper', 4);
g.run(8);
check('smith master hammer -> runes.addExp(smiths x 1.4^upg)', !runes || (rx.length > 0 && near(rx[0], 5 * 1.4 ** 2)), JSON.stringify(rx.slice(0, 3)));
check('dragon queen exp orb -> dragons.addExp(2 x keepers)', !dragons || (dx.some(v => near(v, 2 * 4))), JSON.stringify(dx.slice(0, 5)));
check('queen registered with dragons', !dragons || dragons.queenLevel() > 0);

// temple press speeds masters up
t.onHold(); check('temple press x1.15', near(t.speed(), 1.15));
g.run(1); check('speed-up wears off', t.speed() === 1);

// observatory
check('observatory nav hidden before astrologer', !o.available());
check('gate blocks 9 -> 10 before analyze', o.towers[0].gate(g.host) === 'Analyze the Wall');
g.buy('summon_astrologer');
check('astrologer builds the observatory', o.built() && o.available() && !!o.anim);
g.run(4);
check('build animation finishes', o.anim === null);
g.give('knowledge', 1e13);
g.buy('analyze_wall');
check('analyze wall opens the gate', o.wallAnalyzed() && o.towers[0].gate(g.host) === null);
g.buy('create_cosmic_analysis', 3); g.run(0.1);
check('cosmic analysis created', g.host.res('cosmic_analysis') === 3, String(g.host.res('cosmic_analysis')));
check('analysis cost 2e11 x 1.5^L', near(g.skills.create_cosmic_analysis.cost(2), 2e11 * 2.25));
g.buy('analyze_cursed', 2); g.buy('analyze_molten');
check('analysis multipliers', near(g.host.mult('curse_damage'), 2) && near(g.host.mult('molten_apply'), 1.4) && g.host.mult('shatter_apply') === 1);

// obelisk glyphs
g.setLevel(9);
ob.debug['Obelisk: carve all rune glyphs']();
check('glyphs carved (instructions excluded)', ob.runes.length === 35 && !ob.runes.includes('instructions'));

// drawing + panels do not throw
g.host.S.activeArea = 'temple'; g.draw(); g.panel('temple'); g.host.S.activeArea = 'observatory'; g.panel('observatory'); g.panel('obelisk');
check('beacon draws above the tower', g.draw().some((c: any[]) => c[0] === 'part' && c[1] === 'beacon_flare'));

// Beacon.gd beam (softened): back pass only, clipped between the lantern (beacon + 302) and the wall's bottom edge,
// brightest at the lantern; a 350 px fade when no wall is targetable
{
  const real = g.host.modules.siege; const b = ob.beaconPos(); const fy = Math.round(b[1]) + 302;
  const h: any = g.host, ts = h.toScreen; h.toScreen = (x: number, y: number) => [x - 200, (y + 400) * 0.5];   // camera: whole beam on the 480 px screen
  const beam = (stub: any) => {
    (g.host.modules as any).siege = stub; ob.t = Math.PI / 4.4;   // pulse at its peak
    g.D.calls.length = 0; ob.drawWorldBack(g.D);
    const rects = g.D.calls.filter((c: any[]) => c[0] === 'rect').map((c: any[]) => ({ y0: c[3] * 2 - 400, y1: (c[3] + c[5]) * 2 - 400, a: c[6] }));
    g.D.calls.length = 0; ob.drawWorld(g.D); const front = g.D.calls.filter((c: any[]) => c[0] === 'rect').length;
    (g.host.modules as any).siege = real; return { rects, front };
  };
  const wallY = Math.round(b[1]) - 500, up = beam({ targetable: () => true, wallY: () => wallY });
  check('beacon: drawn only in the back pass', up.rects.length > 0 && up.front === 0);
  check('beacon: never below the lantern', up.rects.every(r => r.y1 <= fy + 1e-6));
  { const m = Math.min(...up.rects.map(r => r.y0)); check('beacon: reaches toward the wall but never above its bottom', m >= wallY && m <= wallY + 0.2 * (fy - wallY), `top ${m} wall ${wallY}`); }
  const near0 = up.rects.filter(r => r.y1 > fy - 10).map(r => r.a), far = up.rects.filter(r => r.y0 < wallY + 60).map(r => r.a);
  check('beacon: fades from lantern to wall', Math.max(...near0) > 3 * Math.max(...far));
  const idle = beam({ targetable: () => false });
  check('beacon: 350 px fade when no wall', Math.min(...idle.rects.map(r => r.y0)) >= Math.round(b[1]) - 350);
  h.toScreen = (x: number, y: number) => [x + 1000, y];
  g.D.calls.length = 0; ob.drawWorldBack(g.D);
  check('beacon: nothing when off screen', !g.D.calls.some((c: any[]) => c[0] === 'rect'));
  h.toScreen = ts;
}

// save / load
const saved = { t: JSON.parse(JSON.stringify(t.save())), o: JSON.parse(JSON.stringify(o.save())), ob: JSON.parse(JSON.stringify(ob.save())) };
const lv = t.level, xp = t.xp;
t.reset(false); ob.reset(false);
check('reset clears temple exp + glyphs', t.level === 0 && ob.runes.length === 0);
t.load(saved.t); o.load(saved.o); ob.load(saved.ob);
check('load restores temple exp', t.level === lv && near(t.xp, xp));
check('load restores glyphs + observatory intro', ob.runes.length === 35 && o.introduced);

// every debug button runs
for (const m of [t, o, ob]) for (const k in m.debug) m.debug[k]();
g.run(3);
check('no module errors', g.log.errors.length === 0, g.log.errors.join('\n'));
done();
