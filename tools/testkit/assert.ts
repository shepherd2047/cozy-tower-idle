// Tiny assertion helpers: print PASS/FAIL lines, exit non-zero on any failure.
let fails = 0, passes = 0;
export function check(name: string, ok: boolean, detail = '') {
  if (ok) { passes++; console.log(`PASS ${name}`); }
  else { fails++; console.log(`FAIL ${name}${detail ? '\n     ' + detail.replace(/\n/g, '\n     ') : ''}`); }
}
export function near(a: number, b: number, rel = 0.02) { return Math.abs(a - b) <= Math.abs(b) * rel + 1e-9; }
export function done() { console.log(`-- ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0); }
