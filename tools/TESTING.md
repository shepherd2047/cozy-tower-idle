# How to test (read this before running any test)

The old way (every test launches Chrome and loads the whole game) took 30–120 s per run and slowed the whole
machine down. Use these two layers instead.

## 1. Logic tests in Bun: about 1 s, no browser, no build (use these for most checks)

Each module runs against a fake host (`tools/testkit/fakehost.ts`) that follows the real host's rules: gains go
through `onGain`, costs use current resources, `mult()` is the product of every module's `multipliers()`, and a
module runs once its tower is reached.

```bash
bun run tools/testkit/run.ts            # every tools/tests/*.test.ts, in parallel
bun run tools/testkit/run.ts dragons    # only files whose name contains "dragons"
```

Write your checks in `tools/tests/<your-module>.test.ts`. `tools/tests/smoke.test.ts` is the reference. It loads all
modules, steps through towers 0–10, buys every skill, runs every debug button, and does save/load and resetRun.

```ts
import { createGame } from '../testkit/fakehost';
import { check, near, done } from '../testkit/assert';
const g = await createGame({ level: 7 });        // all modules; pass { modules: ['sorcery', 'siege'] } to limit
g.give('spirits', 100); g.buy('summon_gorgon', 5);
g.run(30);                                        // 30 simulated seconds (dt 1/30)
check('gorgons damage the wall', g.mod('siege').damageTaken > 0);
check('no module errors', g.log.errors.length === 0, g.log.errors.join('\n'));
done();
```

`g.log` records gains, sounds, toasts, stories and every module exception. `g.draw()` runs all draw passes and
returns the recorded draw calls, and `g.panel(id)` runs one module's `drawPanel`. If your module reads a host or `S`
field the fake doesn't have yet, add it to `fakehost.ts`, keeping the same shape as the real host.

## 2. Browser tests: about 2–4 s, using the warm pool

`tools/warm-pool.mjs` (run by the coordinator) keeps 3 tabs with the newest good snapshot already loaded, with fresh
state, at 390×844. The shared `cdp.mjs` leases one automatically, so your existing test scripts still work:

```bash
node "C:/Users/mu/AppData/Local/Temp/claude/C--Users-mu-Desktop-New-folder/a4fd49ca-81bd-4744-800e-70997226d6d2/scratchpad/cdp.mjs" my-test.mjs
```

- **Navigation:** `Page.navigate` to the game (ports 8131/8140/8150) is skipped, because the game is already
  there. You don't need to wait for it to load.
- **The `game` helper:** test scripts also get `game(js)`, which runs `js` with `g` (the TowerWizardGame
  component), `host` and `wait(ms)` bound. Example:
  `await game("g.beginGame(); host.debugSetLevel(7); await wait(300); return g.S.level")`.
- **Build version:** the tab is on the newest good build. To know when your edit is in it, poll `BUILD_STATUS.json`
  until `lastGoodStartedAt` is after your edit (the pool switches about 15 s after a new good build).
- **After your test:** the tab is wiped and reloaded in the background for the next lease.
- **Don't:**
  - launch your own Chrome;
  - run your own copy of cdp.mjs, or private servers;
  - set `COLD=1`, except to test a cold first load. `COLD=1` falls back to a private browser, at most 2
    machine-wide.

Only use browser tests for things the fake host can't show: real rendering (screenshots), touch input, layout,
and the full game loop. Do everything else in layer 1.
