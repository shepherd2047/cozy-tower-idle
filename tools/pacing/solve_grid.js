// Siege upgrade-curve search (node tools/pacing/solve_grid.js "[[powerGrowth,powerEffect,rateGrowth,rateEffect,cost0],...]" [out.json]):
// flatter cost growth -> more frequent purchases; re-solves wall/boss HPs for the engaged profile each time
const s = require('./sim.js');
const early = {}; for (const p in s.PROFILES) early[p] = s.runEarly(s.PROFILES[p]);
const targets = [120, 120, 120, 50, 50, 50];
for (const [pg, pe, rg, re, c0] of JSON.parse(process.argv[2])) {
  const Q = JSON.parse(JSON.stringify(s.SIEGE_DEFAULT));
  Object.assign(Q.upgrades.power, { growth: pg, effect: pe, cost0: c0 }); Object.assign(Q.upgrades.rate, { growth: rg, effect: re, cost0: c0 * 1.5 });
  const R = s.solveSiege(early, Q, targets, [135, 260]);
  const e = s.evalSiege(early, R);
  const gap = p => Math.max(...e[p].gaps.map(g => g.to - g.from)).toFixed(0);
  console.log(`${JSON.stringify([pg, pe, rg, re, c0])} engaged ${s.fmtT(e.engaged.total)} casual ${s.fmtT(e.casual.total)} tryhard ${s.fmtT(e.tryhard.total)} ratio ${(e.engaged.total / e.tryhard.total).toFixed(2)} gaps c/e/t ${gap('casual')}/${gap('engaged')}/${gap('tryhard')} lv ${e.engaged.st.power}/${e.engaged.st.rate}`);
  if (process.argv[3]) require('fs').writeFileSync(process.argv[3], JSON.stringify(R, null, 2));
}
