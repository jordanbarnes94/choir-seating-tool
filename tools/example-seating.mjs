/*
 * example-seating — generate the Schnittke example's two seating plans, "Option 1" and "Option 2".
 *
 *   node tools/example-seating.mjs
 *
 * Both are Auto-arrange output on EXAMPLE_ROWS × EXAMPLE_COLS in the usual section order, so they
 * score the same. They differ because the solver starts from the seating it is given: Option 1 is
 * arranged from an empty stage, Option 2 from Option 1 turned back to front. It prints both scores
 * and the EXAMPLE_SEAT_NAMES and EXAMPLE_SEAT_NAMES_2 constants to paste into utils/arranger.js.
 * A tool, not a test: test/library.test.js checks the result.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(pathToFileURL(resolve(ROOT, 'src/utils/arranger.js')).href);

const roster = A.EXAMPLE_ROSTER;
const SCH = A.EXAMPLE_SPLITS.map((s) => s.id);
const byId = A.rosterById(roster);
const rows = A.EXAMPLE_ROWS, cols = A.EXAMPLE_COLS, cells = rows * cols;
const engine = (seats) => A.makeEngine({ DATA: roster, byId, SCH, seats, pinned: new Set(), order: A.STAGE_ORDER });

function arrange(start) {
  const { seats, overflow } = engine(start).arrangeAll(rows, cols, roster.map((p) => p.id).filter((id) => !start.includes(id)));
  if (overflow.length) throw new Error(`${overflow.length} singers do not fit ${rows} × ${cols}`);
  return seats;
}
function score(seats) {
  const eng = engine(seats);
  const s = { stranded: 0, broken: 0, lateral: 0 };
  for (const key of [A.SECTION_KEY, ...SCH]) {
    const e = eng.evaluate2D(seats, rows, key);
    s.stranded += e.stranded.length;
    s.broken += e.broken.length;
    s.lateral += eng.lateralIsolated2D(seats, rows, key).length;
  }
  return s;
}

const first = arrange(new Array(cells).fill(A.EMPTY));
const reversed = first.filter(A.isSinger).reverse();
const second = arrange([...reversed, ...new Array(cells - reversed.length).fill(A.EMPTY)]);

for (const [name, seats] of [['Option 1', first], ['Option 2', second]]) {
  const s = score(seats);
  console.log(`${name}: ${s.stranded} stranded, ${s.broken} broken, ${s.lateral} with group-mates only in front or behind`);
  if (s.stranded || s.broken) process.exitCode = 1;
}
console.log(`${first.filter((id, i) => id !== second[i]).length} of ${cells} chairs differ\n`);

function print(name, seats) {
  const names = A.seatNames(seats, byId).map((n, i) => (A.isSinger(seats[i]) ? JSON.stringify(n) : 'EMPTY'));
  console.log(`const ${name} = [`);
  for (let c = 0; c < cols; c++) console.log('  ' + names.slice(c * rows, (c + 1) * rows).join(', ') + (c < cols - 1 ? ',' : ''));
  console.log('];');
}
print('EXAMPLE_SEAT_NAMES', first);
console.log();
print('EXAMPLE_SEAT_NAMES_2', second);
