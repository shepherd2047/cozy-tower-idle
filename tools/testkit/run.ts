// Runs tools/tests/*.test.ts (or the files given) in parallel, each in its own Bun process (fresh module registry).
// Usage:  bun run tools/testkit/run.ts                 all tests
//         bun run tools/testkit/run.ts dragons         files whose name contains "dragons"
import { readdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dir, '..', '..');
const dir = path.join(root, 'tools', 'tests');
const filter = process.argv.slice(2);
const files = readdirSync(dir).filter(f => f.endsWith('.test.ts') && (!filter.length || filter.some(x => f.includes(x))));
const t0 = Date.now();
const results = await Promise.all(files.map(async f => {
  const p = Bun.spawn(['bun', '--preload', path.join(root, 'tools/testkit/preload.ts'), path.join(dir, f)], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
  return { f, code: await p.exited, out: out + err };
}));
let bad = 0;
for (const r of results) {
  const fails = r.out.split('\n').filter(l => l.startsWith('FAIL') || l.startsWith('     ') || /error/i.test(l) && r.code);
  console.log(`${r.code ? 'FAIL' : 'ok  '} ${r.f}  ${(r.out.match(/-- .*/) || [''])[0]}`);
  if (r.code) { bad++; console.log(fails.slice(0, 30).map(l => '   ' + l).join('\n') || r.out.slice(-1500)); }
}
console.log(`${files.length} files, ${bad} failing, ${Date.now() - t0} ms`);
process.exit(bad ? 1 : 0);
