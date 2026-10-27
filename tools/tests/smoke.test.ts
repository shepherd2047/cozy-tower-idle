// Smoke test for every module at once: init, unlock at each tower, simulate, draw, panels, debug buttons,
// save/load round-trip, prestige reset. Catches crashes in milliseconds. Run: bun run tools/testkit/run.ts
import { createGame } from '../testkit/fakehost';
import { check, done } from '../testkit/assert';

const g = await createGame();
check('modules registered', g.mods.length >= 10, g.mods.map(m => m.id).join(','));
for (const r of ['magic', 'knowledge', 'wood', 'spirits', 'magic_gold', 'cosmic_dust', 'building_points', 'blank_rune']) g.give(r, 1e15);
for (let level = 0; level <= 10; level++) {
  g.setLevel(level);
  g.run(5);
  g.draw();
  for (const m of g.mods) if (m.drawPanel && level >= m.unlockTower) g.panel(m.id);
}
check('no errors through towers 0..10', g.log.errors.length === 0, g.log.errors.slice(0, 5).join('\n'));
// buy one level of every visible skill (rich player)
let bought = 0; for (const id in g.skills) bought += g.buy(id, 1);
check('skills purchasable', bought > 20, `${bought} bought`);
g.run(10);
check('no errors after buying everything', g.log.errors.length === 0, g.log.errors.slice(0, 5).join('\n'));
// every module debug button runs
for (const m of g.mods) for (const [k, f] of Object.entries(m.debug ?? {})) { try { (f as any)(); } catch (e: any) { g.log.errors.push(`${m.id}.debug[${k}]: ${e?.message}`); } }
g.run(3);
check('debug buttons run', g.log.errors.length === 0, g.log.errors.slice(0, 5).join('\n'));
// save -> load round trip
for (const m of g.mods) if (m.save && m.load) {
  const before = JSON.stringify(m.save());
  m.load(JSON.parse(before));
  check(`${m.id} save/load round-trip`, JSON.stringify(m.save()) === before);
}
// prestige-style reset
g.host.resetRun(); g.run(3);
check('resetRun clean', g.log.errors.length === 0, g.log.errors.slice(0, 5).join('\n'));
done();
