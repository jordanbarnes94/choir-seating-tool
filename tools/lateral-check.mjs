/*
 * lateral-check — the lateral alignment measurement, and the thing that decides a solver change.
 *
 *   node tools/lateral-check.mjs
 *
 * The measurement decides: ship a mechanism only if it hits all three targets at once on the example with every split —
 * **laterals under 15** (from 35), **`arrangeAll` under 500 ms**, and **`broken` no worse than
 * baseline** — and otherwise leave the neighbour check's ↕ line as the answer.
 *
 * So the figures have to be reproducible by whoever reads the conclusion, which is what this
 * script is for. It is a tool and not a test, on the same footing as
 * store-smoke.mjs beside it: `arranger.js` is pure, so plain `node` reaches all of it.
 *
 * WHAT IT MEASURES, per preset and per split:
 *   laterals  `lateralIsolated2D` — singers with a same-group neighbour in front or behind but
 *             NONE to either side. This is the number the request's "prioritise, do not prohibit" is
 *             about, and the one the neighbour check already shows.
 *   stranded  `evaluate2D().stranded` — nobody of their group anywhere adjacent. Watched
 *             because a seed that chases laterals could trade this away, and stranded is worse.
 *   broken    `evaluate2D().broken` — groups split into disconnected components. The target
 *             says NO WORSE THAN BASELINE, and this is the measure candidate A died on.
 *   ms        `arrangeAll` wall clock, best of N runs (the solver is deterministic, so the
 *             spread is the machine's and the minimum is the honest figure).
 *
 * It also measures at the 250-singer cap, because the verification list asks for runtime there
 * rather than only on a 75-singer example.
 *
 * COMPARING TWO REVISIONS. Drop a previous `arranger.js` at `.smoke/arranger-old.js` —
 *
 *   git show <rev>:src/utils/arranger.js > .smoke/arranger-old.js
 *
 * — and every figure is printed for both, side by side, with the deltas. That is how a seed
 * change is held against the code it replaces rather than against a remembered number.
 * `.smoke/` is gitignored and the comparison is skipped when the file is absent.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UTILS = resolve(ROOT, 'src/utils');

// Imports take a file URL, never a raw path: on Windows a raw `C:\…` is not a valid specifier.
const A = await import(pathToFileURL(`${UTILS}/arranger.js`).href);
const OLD_PATH = resolve(ROOT, '.smoke/arranger-old.js');
const OLD = existsSync(OLD_PATH) ? await import(pathToFileURL(OLD_PATH).href) : null;

const RUNS = 5; // best-of; the solver is deterministic so this only filters the machine

/* ---------- the two shipped examples, plus a synthetic choir at the cap ---------- */

// A choir of `n` at the same shape as the examples: four sections, a 2-, 3- and 4-way split.
// Built by rule rather than by name so the cap case is reproducible and needs no fixture.
function syntheticRoster(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `s${i + 1}`,
      name: `Singer ${i + 1}`,
      section: A.SECTIONS[i % A.SECTIONS.length],
      '2way': String((i % 2) + 1),
      '3way': String((i % 3) + 1),
      '4way': String((i % 4) + 1)
    });
  }
  return out;
}

function cases(mod) {
  // The example choir with only the 2-way split, and with every split. The splits come from the
  // current module when an older revision named them differently.
  const roster = mod.EXAMPLE_ROSTER;
  const all = mod.EXAMPLE_SPLITS || A.EXAMPLE_SPLITS;
  const rows = A.EXAMPLE_ROWS, cols = A.EXAMPLE_COLS;
  const cap = A.LIMITS.singers;
  return [
    { label: 'Example, 2-way (75)', roster, splits: mod.BASIC_SPLITS, rows, cols },
    { label: 'Example, every split (75)', roster, splits: all, rows, cols },
    // The cap, at a grid that just holds it: 250 singers over 5 rows is 50 columns.
    { label: `At the cap (${cap})`, roster: syntheticRoster(cap), splits: all, rows: 5, cols: Math.ceil(cap / 5) }
  ];
}

/* ---------- one measurement ---------- */

function measure(mod, { roster, splits, rows, cols }) {
  const SCH = splits.map((s) => s.id);
  const byId = mod.rosterById(roster);
  const order = [...mod.STAGE_ORDER];
  const engineFor = (seats) => mod.makeEngine({ DATA: roster, byId, SCH, seats, pinned: new Set(), order });

  // Start from an empty stage with everybody waiting, which is what Auto-arrange does on a
  // freshly imported roster — the case the complaint is about.
  const empty = new Array(rows * cols).fill(mod.EMPTY);
  const ids = roster.map((p) => p.id);

  let best = Infinity, seats = null;
  for (let i = 0; i < RUNS; i++) {
    const eng = engineFor(empty.slice());
    const t = process.hrtime.bigint();
    const res = eng.arrangeAll(rows, cols, ids);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    if (ms < best) best = ms;
    seats = res.seats;
  }

  const eng = engineFor(seats);
  const per = {};
  let laterals = 0, stranded = 0, broken = 0;
  for (const split of SCH) {
    const e = eng.evaluate2D(seats, rows, split);
    const l = eng.lateralIsolated2D(seats, rows, split);
    per[split] = { laterals: l.length, stranded: e.stranded.length, broken: e.broken.length };
    laterals += l.length;
    stranded += e.stranded.length;
    broken += e.broken.length;
  }
  // the section grouping too, to check the claim that it is already 0
  const sec = eng.evaluate2D(seats, rows, mod.SECTION_KEY);
  per.section = {
    laterals: eng.lateralIsolated2D(seats, rows, mod.SECTION_KEY).length,
    stranded: sec.stranded.length,
    broken: sec.broken.length
  };

  return { ms: best, laterals, stranded, broken, per, seats };
}

/* ---------- report ---------- */

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const delta = (now, then) => {
  if (then === undefined) return '';
  const d = now - then;
  if (d === 0) return '    =';
  return num((d > 0 ? '+' : '') + (Number.isInteger(d) ? d : d.toFixed(1)), 5);
};

console.log(`\nitem 14 — lateral alignment. best of ${RUNS} runs, from an empty stage.`);
console.log(OLD ? 'comparing against .smoke/arranger-old.js\n' : '(no .smoke/arranger-old.js — measuring this revision only)\n');

for (const c of cases(A)) {
  const now = measure(A, c);
  const then = OLD ? measure(OLD, { ...c, roster: c.roster, splits: c.splits }) : null;

  console.log(pad(c.label, 20) + num('ms', 8) + num('laterals', 10) + num('stranded', 10) + num('broken', 8));
  console.log(
    pad('  this revision', 20) +
      num(now.ms.toFixed(1), 8) +
      num(now.laterals, 10) +
      num(now.stranded, 10) +
      num(now.broken, 8)
  );
  if (then) {
    console.log(
      pad('  previous', 20) + num(then.ms.toFixed(1), 8) + num(then.laterals, 10) + num(then.stranded, 10) + num(then.broken, 8)
    );
    console.log(
      pad('  delta', 20) +
        num(delta(now.ms, then.ms), 8) +
        num(delta(now.laterals, then.laterals), 10) +
        num(delta(now.stranded, then.stranded), 10) +
        num(delta(now.broken, then.broken), 8)
    );
  }
  for (const [split, v] of Object.entries(now.per)) {
    const was = then ? then.per[split] : undefined;
    console.log(
      pad(`    ${split}`, 20) +
        num('', 8) +
        num(v.laterals + (was ? ` (${delta(v.laterals, was.laterals).trim()})` : ''), 10) +
        num(v.stranded + (was ? ` (${delta(v.stranded, was.stranded).trim()})` : ''), 10) +
        num(v.broken + (was ? ` (${delta(v.broken, was.broken).trim()})` : ''), 8)
    );
  }
  console.log('');
}

/* ---------- the three targets, on the example with every split ---------- */
{
  const c = cases(A)[1];
  const m = measure(A, c);
  const ok = (b) => (b ? 'PASS' : 'FAIL');
  console.log('the target, on the example with every split:');
  console.log(`  laterals under 15        ${num(m.laterals, 6)}   ${ok(m.laterals < 15)}`);
  console.log(`  arrangeAll under 500 ms  ${num(m.ms.toFixed(1), 6)}   ${ok(m.ms < 500)}`);
  console.log(`  broken no worse          ${num(m.broken, 6)}   ${OLD ? ok(m.broken <= measure(OLD, c).broken) : '(needs .smoke/arranger-old.js)'}`);

  // Determinism is not one of the three, but the compare feature and the example seatings both
  // depend on it, so it is asserted here rather than assumed.
  const again = measure(A, c);
  console.log(`  deterministic            ${num('', 6)}   ${ok(JSON.stringify(m.seats) === JSON.stringify(again.seats))}`);
}
console.log('');
