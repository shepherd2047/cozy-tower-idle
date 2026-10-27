// Browser regression sweep, run by build-daemon.ps1 after every good build (through the shared cdp.mjs warm pool).
// Walks towers 0..10, opens every core and module panel at each level, runs the siege stages, and fails on any
// module error (host modErrs), page exception or console error. Writes tools/regress-last.json + screenshots.
export default async function ({ game, sleep, shot, evaluate }) {
  const out = { steps: [], modErrs: [], exceptions: [] };
  await evaluate(`window.__twErr = []; window.addEventListener('error', e => window.__twErr.push(String(e.message))); const ce = console.error; console.error = (...a) => { window.__twErr.push(a.map(String).join(' ').slice(0, 300)); ce.apply(console, a); }; 1`);
  await game(`for (let i = 0; i < 80 && !g.ready; i++) await wait(250); g.beginGame(); for (let i = 0; i < 10; i++) g.tutorialButton(); return 1`);
  for (let level = 0; level <= 10; level++) {
    const r = await game(`host.setTowerLevel(${level}); await wait(250);
      for (const k of ['magic','knowledge','wood','spirits','totems']) g.S.res[k] = 1e15;
      const areas = ['orb','study','forestry', ...Object.keys(host.modules).filter(id => host.isUnlocked(id))];
      for (const a of areas) { g.S.navigated = a; await wait(120); }
      g.S.navigated = ''; await wait(100);
      return { level: g.S.level, areas: areas.length, cam: [Math.round(g.cam.x), Math.round(g.cam.y), +g.cam.zoom.toFixed(2)] };`);
    out.steps.push(r);
    if (level === 4 || level === 7 || level === 10) await shot(`regress_t${level}.png`);
  }
  // siege stages, if present
  const siege = await game(`const s = host.modules.siege; if (!s || !s.debugJump) return 'no siege';
    for (const st of ['wall1','wall2','wall3','boss1','boss2','boss3','ending']) { s.debugJump(st); await wait(400); }
    return 'ok'`);
  out.steps.push({ siege });
  out.modErrs = await game(`return Object.keys(g.modErrs || {})`);
  out.exceptions = await evaluate(`window.__twErr.slice(0, 20)`);
  out.ok = out.modErrs.length === 0 && out.exceptions.length === 0;
  const fs = await import('node:fs');
  fs.writeFileSync('C:/Users/mu/Desktop/New folder/tower-wizard-cocos/tools/regress-last.json', JSON.stringify(out, null, 2));
  console.log(out.ok ? 'REGRESS OK' : 'REGRESS FAIL', JSON.stringify({ modErrs: out.modErrs, exceptions: out.exceptions }).slice(0, 800));
  if (!out.ok) throw new Error('regression failed');
}
