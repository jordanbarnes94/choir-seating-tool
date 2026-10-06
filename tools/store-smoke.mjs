/*
 * store-smoke — exercise the LIVE store headlessly, from a bare `node`.
 *
 *   node tools/store-smoke.mjs
 *
 * `npm test` covers the pure modules in utils/. What is left in useChoirArranger.js is where the
 * stored shape actually lands: restoreJSON, save(), reconcileSeats, the bench, the exports. This
 * script imports the store as it is and runs it against stubbed browser globals. It is a tool and
 * not a test.
 *
 * It was written for stable singer ids, where the whole verification list is
 * "nothing changed" and none of it could be clicked, and it walks that list.
 *
 * It does NOT replace checking in a browser. It cannot see a colour, a page
 * break, a drag, or a file opening in Excel. What it can see is whether the plan still holds the
 * right people afterwards.
 *
 * To hold the solver against an older revision, use lateral-check.mjs, which measures both.
 */
import assert from 'node:assert/strict';
import { computed } from 'vue';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UTILS = resolve(ROOT, 'src/utils');
// Imports take a file URL, never a raw path: on Windows a raw `C:\…` is not a valid specifier.
const url = (path) => pathToFileURL(path).href;

/* ---------- browser stubs ---------- */
const LSMAP = new Map();
globalThis.localStorage = {
  getItem: (k) => (LSMAP.has(k) ? LSMAP.get(k) : null),
  setItem: (k, v) => LSMAP.set(k, String(v)),
  removeItem: (k) => LSMAP.delete(k),
  clear: () => LSMAP.clear()
};
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.location = { search: '' };
globalThis.confirm = () => true;
globalThis.alert = () => {};
let DOWNLOADED = null;
globalThis.Blob = class { constructor(parts) { this.text = parts.join(''); } };
globalThis.URL = { createObjectURL: (b) => { DOWNLOADED = b.text; return 'blob:x'; }, revokeObjectURL: () => {} };
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, click() {}, remove() {}, appendChild() {} }),
  body: { appendChild() {}, removeChild() {} }
};

const { useChoirArranger } = await import(url(resolve(ROOT, 'src/composables/useChoirArranger.js')));
const A = await import(url(`${UTILS}/arranger.js`));
const P = await import(url(`${UTILS}/persistence.js`));
const Pal = await import(url(`${UTILS}/palettes.js`));
const { PLAN_FIELDS } = await import(url(`${UTILS}/plan.js`));

const store = useChoirArranger();
const names = () => A.seatNames(store.seats.value, store.byId.value);
const ok = (m) => console.log('  ok  ' + m);
// Open the seed's Schnittke.
const openExample = () => {
  const ex = store.concertOptions.value.find((c) => c.name === "Schnittke's Concerto for Choir");
  assert.ok(ex, 'the seed has no Schnittke concert');
  assert.ok(store.openArrangementById(ex.id, ''));
};
// ...and a copy of it, so a section that edits leaves Schnittke as seeded.
let copies = 0;
const openCopy = () => {
  openExample();
  return store.saveConcertAs(`Schnittke copy ${++copies}`);
};
// A roster edit goes through the same path as the Roster tab's Save: the whole list, committed.
const editRoster = (rosterId, mutate) => {
  const singers = store.library.value.rosters.find((r) => r.id === rosterId).singers.map((p) => ({ ...p }));
  mutate(singers);
  return store.commitRoster(rosterId, singers);
};
const members = () => store.concert.value.members.map((m) => m.singerId);

/* ---------- 1. a first visit opens the seed, seat for seat ---------- */
store.init();
assert.deepEqual(store.library.value.rosters.map((r) => r.name), ['Example Choir'], 'a first visit starts on the seed');
assert.deepEqual(store.library.value.concerts.map((c) => c.name), ["Schnittke's Concerto for Choir", 'Così fan tutte']);
assert.equal(store.openConcertName.value, "Schnittke's Concerto for Choir", 'with its first concert open');
const SEEDED = store.seats.value.slice();
assert.equal(store.data.value.length, 75);
assert.deepEqual(names().slice(0, 3), ['Kim Shelton', 'Kaya Quinlivan', 'Selma Rowntree']);
assert.equal(names()[65], 'Julian Barlow');
assert.equal(store.waiting.value.length, 0);
assert.ok(store.data.value.every((p) => /^s\d+$/.test(p.id)));
assert.equal(store.openArrangementName.value, 'Option 1');
assert.deepEqual(store.SCH.value, ['2way', '3way', '4way'], 'with the 2-, 3- and 4-way splits');
assert.deepEqual(store.concert.value.arrangements.map((a) => a.name), ['Option 1', 'Option 2'], 'with both seating plans');
assert.equal(store.hasUnsavedChanges(), false, 'and it opens clean');
ok('a first visit opens the seed: 75 singers, seat for seat');

// the seed is ordinary data: its plans save like any other
{
  store.swap(0, 1);
  assert.equal(store.hasUnsavedChanges(), true);
  assert.equal(store.saveArrangement(), true, 'a seeded plan saves');
  assert.equal(store.hasUnsavedChanges(), false);
  store.seats.value = SEEDED.slice();
  store.saveArrangement();
  ok('the seed is editable like anything else');
}

// Save as: a copy over the same roster, opened, seat for seat
{
  openExample();
  const roster = store.openRoster.value.id;
  store.swap(0, 1);
  const moved = store.seats.value.slice();
  const copy = store.saveConcertAs(`Schnittke copy ${++copies}`);
  assert.ok(copy);
  assert.equal(store.openConcertId.value, copy.id, 'the copy is what is open now');
  assert.deepEqual(store.seats.value, moved, 'carrying the unsaved seating from the stage');
  assert.equal(store.data.value.length, 75);
  assert.equal(store.openRoster.value.id, roster, 'sharing the roster');
  assert.equal(store.hasUnsavedChanges(), false, 'and the plan it opens on is saved');
  store.seats.value = SEEDED.slice();
  store.saveArrangement();
  ok('Save as makes a copy of the concert over the same roster');
}

/* ---------- 2. auto-arrange ---------- */
store.autoArrange();
const arranged = names().slice();
store.seats.value = SEEDED.slice(); // the same INPUT, which is what deterministic means
store.autoArrange();
assert.deepEqual(names(), arranged, 'auto-arrange must be deterministic for the same input');
assert.equal(arranged.filter(A.isSinger).length, 75);
assert.equal(new Set(arranged.filter(A.isSinger)).size, 75, 'nobody seated twice');
ok('auto-arrange: deterministic, everyone seated exactly once');

// Comparing against an older solver is lateral-check.mjs's job: it measures both on the same
// choirs (laterals, stranded, broken, time). A seat-for-seat check lived here until the solver
// was rewritten to change seats on purpose.

/* ---------- 3. the case singer ids exist for ---------- */
store.seats.value = SEEDED.slice();
const jordan = store.data.value.find((p) => p.name === 'Julian Barlow');
const chair = store.seats.value.indexOf(jordan.id);
const ji = store.data.value.indexOf(jordan);
const splitBefore = jordan['3way'];
store.togglePin(jordan.id);
store.applyRosterEdit((r) => { r[ji].name = 'Julian Barlow-Smith'; });
assert.equal(store.seats.value[chair], jordan.id, 'same chair');
assert.equal(names()[chair], 'Julian Barlow-Smith', 'under the new name');
assert.ok(store.pinnedSet.value.has(jordan.id), 'the pin survives');
assert.equal(store.byId.value[jordan.id]['3way'], splitBefore, 'the split membership survives');
assert.equal(store.waiting.value.length, 0, 'and they did not fall onto the bench');
ok('rename: the chair, the pin and the split all survive (this FAILED before singers had ids)');

/* ---------- 4. two singers with one name ---------- */
store.applyRosterEdit((r) => { r[ji].name = 'Julian Barlow'; });
const oi = store.data.value.findIndex((p) => p.name === 'Bob Dobson');
store.applyRosterEdit((r) => { r[oi].name = 'Julian Barlow'; });
const twins = store.data.value.filter((p) => p.name === 'Julian Barlow');
assert.equal(twins.length, 2);
assert.notEqual(twins[0].id, twins[1].id);
assert.notEqual(store.seats.value.indexOf(twins[0].id), store.seats.value.indexOf(twins[1].id));
store.togglePin(twins[1].id);
assert.ok(store.pinnedSet.value.has(twins[0].id) && store.pinnedSet.value.has(twins[1].id));
store.togglePin(twins[1].id);
assert.ok(store.pinnedSet.value.has(twins[0].id) && !store.pinnedSet.value.has(twins[1].id));
ok('duplicate names: independently seated, independently pinned');
// put Bob Dobson back, so the sections below can identify a singer by name again
store.applyRosterEdit((r) => { r[store.data.value.findIndex((p) => p.id === twins[1].id)].name = 'Bob Dobson'; });
const seated0 = names().slice();

/* ---------- 5. no id reaches a file ---------- */
store.exportSeatingCSV();
const seating = DOWNLOADED;
assert.ok(seating.includes('Julian Barlow'));
assert.ok(!/(^|[,"\n])s\d+([,"\n]|$)/.test(seating), 'a bare id must never reach the seating file');
store.exportRosterCSV();
assert.ok(!/(^|,)s\d+(,|$)/m.test(DOWNLOADED), 'nor the roster file');
assert.equal(DOWNLOADED.replace(/^﻿/, '').split('\r\n')[0], 'Name,Section', 'a roster file has no split columns, whatever is open');
store.exportConcertCSV();
assert.ok(!/(^|,)s\d+(,|$)/m.test(DOWNLOADED), 'nor the concert file');
assert.equal(DOWNLOADED.replace(/^﻿/, '').split('\r\n')[0], ['Name', 'Section', ...store.splits.value.map((s) => s.name)].join(','), 'a concert file carries its splits');
assert.equal(DOWNLOADED.trim().split('\r\n').length - 1, store.data.value.length, 'one row per singer in the concert');
ok('the three CSV exports carry names and no ids; only the concert one carries splits');

/* ---------- 5b. the Roster tab's import: a new roster, or a replace matched by name ---------- */
{
  const S = await import(url(`${UTILS}/spreadsheet.js`));
  const rowsOf = (list) => S.normaliseRows([['Name', 'Section', 'Notes'], ...list.map((p) => [p.name, p.section, 'x'])]);
  const concertsBefore = store.library.value.concerts.length;
  const made = store.importAsRoster(rowsOf([{ name: 'Ann New', section: 'Alto' }]), 'Imported roster');
  assert.equal(made.ok, true);
  assert.deepEqual(store.library.value.rosters.find((x) => x.id === made.rosterId).singers.map((p) => [p.name, p.section]), [['Ann New', 'Alto']]);
  assert.equal(store.library.value.concerts.length, concertsBefore, 'and no concert is made');
  assert.equal(store.importAsRoster(rowsOf([{ name: 'X', section: 'Bass' }]), ' ').ok, false, 'a roster needs a name');

  const r = store.openRoster.value;
  const withoutSeq = () => JSON.stringify({ ...store.library.value, seq: 0 });
  const lib = withoutSeq();
  const seqBefore = store.library.value.seq;
  const [keep, gone] = r.singers;
  const incoming = r.singers.filter((p) => p !== gone).map((p) => (p === keep ? { ...p, name: p.name.toUpperCase() } : p));
  const res = store.rosterReplacement(rowsOf([...incoming, { name: 'Brand New', section: 'Tenor' }]), r.id);
  assert.equal(res.ok, true);
  assert.equal(res.singers.find((p) => p.name === keep.name.toUpperCase()).id, keep.id, 'a loose match keeps the id');
  assert.deepEqual(res.removed, [gone.name]);
  assert.deepEqual(res.added, ['Brand New']);
  assert.equal(withoutSeq(), lib, 'and nothing is committed: the Roster tab saves it');
  assert.ok(!r.singers.some((p) => p.id === res.singers.at(-1).id) && store.library.value.seq > seqBefore, 'though the new id is taken off the counter, so nothing else can be given it');
  assert.equal(store.rosterReplacement(rowsOf(incoming), 'r-none').ok, false, 'a roster that does not exist cannot be replaced');
  ok('roster import: a new roster on its own, or a replace that keeps matched ids and commits nothing');
}

/* ---------- 6. the walk-on list ---------- */
const entries = store.walkOnPlan.value.list.queues.flatMap((q) => q.groups.flatMap((g) => g.entries));
assert.equal(entries.length, 75);
entries.forEach((e) => assert.ok(!/^s\d+$/.test(e.name), `${e.name} looks like an id`));
assert.ok(store.walkOnCopyText().includes('Julian Barlow'));
ok('the walk-on list and its clipboard text are names');

/* ---------- 6b. walk-on rows: directions, order, and nothing hidden ---------- */
{
  const w = store.walkOn;
  assert.equal(store.walkOnBadgeMap.value, null, 'no seat numbers on the Arrange tab');
  store.ui.tab = 'walkon';
  assert.ok(store.walkOnBadgeMap.value, 'and every seat is numbered on the Walk-on order tab');
  store.setWalkOn('enterFrom', 'left');
  store.setWalkOnRow(0, 'left');
  assert.deepEqual(w.perRow, [], 'choosing the general direction for a row stores no override');
  store.setWalkOnRow(0, 'right');
  assert.deepEqual(w.perRow, ['right']);
  store.setWalkOn('enterFrom', 'right');
  assert.deepEqual(w.perRow, [], 'a row set to what becomes the general direction stops differing');
  store.setWalkOn('enterFrom', 'left');
  const before = store.walkOnRowOrder.value.slice();
  store.moveWalkOnRow(before[0], 1);
  assert.deepEqual(store.walkOnRowOrder.value, [before[1], before[0], ...before.slice(2)]);
  assert.ok(store.walkOnCustomised.value);
  store.moveWalkOnRow(before[0], -1);
  assert.equal(w.rowSeq, null, 'moving it back is no custom order at all');
  store.setWalkOnRow(3, 'both');
  const rows0 = store.gridRows.value;
  store.setGridRows(2);
  assert.deepEqual(w.perRow, [], 'a shrink drops the directions of rows that no longer exist');
  store.setGridRows(rows0);
  store.resetWalkOnRows();
  store.ui.tab = 'arrange';
  ok('walk-on rows: the general direction is never stored per row, the order moves, a shrink trims');
}

/* ---------- 7. several arrangements in one concert, over one roster ---------- */
{
  const first = store.openArrangementId.value;
  const second = store.addArrangement('Version B', { from: 'working' });
  store.openArrangementById(store.openConcertId.value, second.id);
  store.autoArrange();
  store.saveArrangement();
  const bSeats = names().slice();
  store.openArrangementById(store.openConcertId.value, first);
  assert.deepEqual(names(), seated0, 'going back gets the first plan, not the second');
  // THE SHARED-ROSTER ACCEPTANCE TEST, and the exact case that failed when every plan held its
  // own copy of the roster: rename in plan A,
  // switch to plan B, and the singer is still in their chair and still themselves.
  const jb = store.data.value.find((p) => p.name === 'Julian Barlow');
  const ji2 = store.data.value.indexOf(jb);
  store.applyRosterEdit((r) => { r[ji2].name = 'J. Barlow'; });
  store.openArrangementById(store.openConcertId.value, second.id);
  assert.deepEqual(names(), bSeats.map((n) => (n === 'Julian Barlow' ? 'J. Barlow' : n)), 'plan B sees the rename');
  assert.equal(store.data.value.find((p) => p.id === jb.id).name, 'J. Barlow');
  assert.equal(store.waiting.value.length, 0, 'and nobody fell off either plan');
  store.applyRosterEdit((r) => { r[store.data.value.findIndex((p) => p.id === jb.id)].name = 'Julian Barlow'; });
  store.openArrangementById(store.openConcertId.value, first);
  ok('two arrangements, one roster: a rename in one reaches the other, nobody moves chair');
}

/* ---------- 7b. unsaved changes: the working copy is distinct from the stored record ---------- */
// Through a COMPUTED, not by calling hasUnsavedChanges() directly, because the bug this guards
// against is a reactivity one: the baseline used to be a plain variable, so the Save button went
// on reading "Save changes" after Save had run. A direct call would have passed anyway.
{
  const dirty = computed(() => store.hasUnsavedChanges());
  assert.equal(dirty.value, false, 'a freshly opened plan is clean');
  store.swap(0, 1);
  assert.equal(dirty.value, true, 'a drag is unsaved work');
  store.saveArrangement();
  assert.equal(dirty.value, false, 'and Save is what clears it — reactively');

  // The colour-by split is a way of looking: never unsaved, and it stays across a plan switch.
  const split = store.SCH.value[0];
  store.ui.view = split;
  assert.equal(dirty.value, false, 'colouring by a split is not an unsaved change');
  const c = store.openConcertId.value, here = store.openArrangementId.value;
  const other = store.addArrangement('Colour check', { from: 'working' });
  store.ui.view = A.SECTION_VIEW;
  store.openArrangementById(c, other.id);
  assert.equal(store.ui.view, A.SECTION_VIEW, 'opening a plan keeps the colour-by in use, not the one it was saved with');
  store.ui.view = split;
  store.openArrangementById(c, here);
  assert.equal(store.ui.view, split, 'in both directions');
  store.deleteArrangement(other.id);
  store.ui.view = A.SECTION_VIEW;
}
ok('unsaved changes: a seat edit dirties the plan, Save clears it, and the button follows; colour-by never does');

/* ---------- 7c. the id counter: a deleted singer's id never comes back ---------- */
{
  const num = (id) => Number(id.slice(1));
  const r = store.openRoster.value;
  const top = r.singers.slice().sort((a, b) => num(b.id) - num(a.id)).slice(0, 3);
  const highest = num(top[0].id);
  // Delete the three highest and SAVE, which is the case a derived counter got wrong.
  assert.ok(editRoster(r.id, (list) => list.splice(0, list.length, ...list.filter((p) => !top.includes(p)))));
  const fresh = store.mint(store.ID.singer);
  assert.ok(num(fresh) > highest, `after deleting up to s${highest} and saving, the next singer is ${fresh}, not a reused id`);
  // ...and the counter is saved with the library, so a backup and restore carries it.
  const seq = store.library.value.seq;
  store.backupJSON();
  store.restoreJSON(DOWNLOADED);
  assert.equal(store.library.value.seq, seq, 'the counter survives a backup and restore');
  ok('ids: one counter, never reused after a delete and save, carried by a backup');
}

/* ---------- 8. backup and restore ---------- */
store.backupJSON();
const backup = DOWNLOADED;
const seated = names().slice();
const pins = store.pinnedIds.value.slice();
const concerts = store.library.value.concerts.length;
store.clearAll();
assert.deepEqual(store.library.value.concerts.map((c) => c.name), ["Schnittke's Concerto for Choir", 'Così fan tutte'], 'Clear all goes back to the seed');
assert.equal(store.openConcertName.value, "Schnittke's Concerto for Choir");
assert.deepEqual(store.seats.value, SEEDED, 'as seeded');
assert.deepEqual(store.restoreJSON(backup).ok, true);
assert.deepEqual(names(), seated, 'every chair comes back with the same person in it');
assert.deepEqual(store.pinnedIds.value, pins);
assert.equal(store.library.value.concerts.length, concerts, 'and every concert comes back, not just the open one');
assert.equal(JSON.parse(backup).schema, P.SCHEMA);
assert.ok(JSON.parse(backup).library.rosters.every((r) => r.singers.every((p) => p.id)), 'a backup carries ids, because it is total');
ok('backup and restore: the whole library survives and every plan still resolves');

/* ---------- 8b. a backup from any other version is refused, and changes nothing ---------- */
{
  const before = names().slice();
  for (const schema of [P.SCHEMA - 1, P.SCHEMA + 1]) {
    const res = store.restoreJSON(JSON.stringify({ ...JSON.parse(backup), schema }));
    assert.equal(res.ok, false, `a schema ${schema} backup must be refused`);
    assert.match(res.error, /version/);
  }
  // The beta stamped itself 1 as well; its backups are told apart by carrying no library.
  const beta = store.restoreJSON(JSON.stringify({ schema: P.SCHEMA, splits: [], roster: [{ name: 'Ada', section: 'Alto' }], seats: [], pins: [], prefs: {} }));
  assert.equal(beta.ok, false, 'a beta backup must be refused');
  assert.match(beta.error, /older version/);
  assert.deepEqual(names(), before, 'and the plan on screen is untouched');
  ok('a backup from another version is refused with a reason, and nothing changes');
}

/* ---------- 8c. the tick list and the people who have left ---------- */
/*
 * The tick list and the stale-singer prompt, through the store rather than through the dialog. What a
 * person at a desk cannot check quickly is the thing these assert: that untick is NOT delete,
 * and that a chair is never emptied in a STORED arrangement without somebody agreeing to it.
 */
{
  openCopy();
  const c = store.openConcertId.value;
  const first = store.openArrangementId.value;
  const victim = store.seats.value.find(A.isSinger);
  const victimName = store.byId.value[victim].name;
  const rosterBefore = store.rosterSingers.value.length;
  const rostersHeld = store.library.value.rosters.length;

  // a second concert over the SAME roster, which is the shape the tick list exists for
  const other = store.addConcert('Second half', { rosterId: store.openRoster.value.id });
  assert.equal(other.members.length, rosterBefore, 'a new concert over a roster starts with everyone in');
  assert.equal(store.library.value.rosters.length, rostersHeld, 'and it did NOT make a second roster');

  // tick somebody out of the OPEN concert
  assert.ok(store.commitConcert({ members: members().filter((id) => id !== victim) }));
  assert.equal(store.data.value.length, rosterBefore - 1, 'the concert is one smaller');
  assert.equal(store.rosterSingers.value.length, rosterBefore, 'the CHOIR is not');
  assert.ok(store.rosterSingers.value.some((p) => p.id === victim && !p.in));
  assert.ok(other.members.some((m) => m.singerId === victim), 'and the other concert still has them');
  assert.ok(!names().includes(victimName), 'their chair on the working copy is empty');

  // ...but the STORED arrangement still seats them, which is the stale-singer prompt's whole question
  const stale = store.staleForOpen(c, first);
  assert.deepEqual(stale.map((p) => p.name), [victimName], 'the prompt has a name to show');
  assert.equal(stale[0].inRoster, true, 'and can say they are still in the choir');

  // Cancel changes nothing: the stored record still seats them, so ticking them back in is
  // enough to get their chair back.
  assert.ok(store.commitConcert({ members: [...members(), victim] }));
  assert.deepEqual(store.staleForOpen(c, first), [], 'ticked back in, nothing is stale');
  store.openArrangementById(c, first);
  assert.ok(names().includes(victimName), 'and they are back in their chair');

  // "Remove them and open" writes the consent into the stored arrangement
  store.commitConcert({ members: members().filter((id) => id !== victim) });
  assert.equal(store.dropStale(c, first), 1);
  assert.deepEqual(store.staleForOpen(c, first), []);
  store.openArrangementById(c, first);
  assert.equal(store.hasUnsavedChanges(), false, 'so the stage opens CLEAN, not instantly dirty');
  assert.ok(!names().includes(victimName));

  // out of the choir entirely: every concert over the roster loses them, not just this one
  store.commitConcert({ members: [...members(), victim] });
  assert.ok(editRoster(store.openRoster.value.id, (list) => list.splice(list.findIndex((p) => p.id === victim), 1)));
  assert.equal(store.rosterSingers.value.length, rosterBefore - 1);
  const rosterId = store.openRoster.value.id;
  assert.ok(!store.library.value.concerts.some((x) => x.rosterId === rosterId && x.members.some((m) => m.singerId === victim)), 'gone from every concert');
  assert.ok(!store.pinnedIds.value.includes(victim), 'and their pin went with them');

  // a name is a ROSTER fact, so correcting it is correct in both concerts at once
  const anyone = store.rosterSingers.value[0];
  assert.ok(editRoster(store.openRoster.value.id, (list) => (list.find((p) => p.id === anyone.id).name = 'Renamed Person')));
  store.openArrangementById(other.id, other.arrangements[0].id);
  assert.equal(store.byId.value[anyone.id].name, 'Renamed Person', 'the other concert sees it');
  // a new concert's first plan has no seating yet, so opening it solves one and saves it
  assert.ok(store.gridCols.value > 1, 'a new concert does not open on a one-column stage');
  assert.equal(store.waiting.value.length, 0, 'and nobody is left on the bench');
  assert.equal(store.hasUnsavedChanges(), false, 'and the solved seating is already saved');
  store.openArrangementById(c, first);

  // a new singer joins the choir and THIS concert, and nobody else's
  const added = store.mint(store.ID.singer);
  assert.ok(editRoster(store.openRoster.value.id, (list) => list.push({ id: added, name: 'Brand New', section: 'Alto' })));
  assert.ok(store.data.value.some((p) => p.id === added), 'ticked into the open concert');
  assert.ok(!store.library.value.concerts.find((x) => x.id === other.id).members.some((m) => m.singerId === added), 'rule 3: not into the others');

  ok('membership: untick is not delete, a rename reaches both concerts, and a stale seat is asked about');
}

/* ---------- 8d. previews: other plans, read-only ---------- */
/*
 * The store half. The half that matters most — that a preview grid presents no `[data-gi]` and
 * no `.bench`, so drag and drop cannot see it — is a DOM property and is in the desk pass. What
 * is checkable here: previews are drawn from the LIBRARY, stage edits cannot reach them, several
 * can be open, they may come from another concert and survive opening one, and each goes rather
 * than going stale when what it shows stops existing.
 */
{
  openCopy();
  const c = store.openConcertId.value;
  const first = store.openArrangementId.value;
  const key = (id, concertId = c) => store.previewKey(concertId, id);
  const here = () => store.previewChoices.value.filter((o) => o.current).map((o) => o.name);

  assert.deepEqual(here(), ['Option 2'], 'Schnittke ships a second plan to preview');
  assert.equal(store.addPreview(key(first)), false, 'and a plan cannot preview itself');
  assert.equal(store.addPreview(first), false, 'and a bare plan id is not a preview key');

  const second = store.addArrangement('Version B', { from: 'working' });
  store.openArrangementById(c, second.id);
  store.autoArrange();
  store.saveArrangement();
  const bSeats = names().slice();
  const third = store.addArrangement('Version C', { from: 'working' });
  store.openArrangementById(c, first);

  assert.ok(store.addPreview(key(second.id)));
  assert.ok(store.addPreview(key(third.id)));
  assert.equal(store.addPreview(key(second.id)), false, 'a plan already previewed is not added twice');
  assert.deepEqual(store.previews.value.map((p) => p.name), ['Version B', 'Version C'], 'several at once, in the order added');
  assert.deepEqual(here(), ['Option 2'], 'and only the one not shown is left to add');

  // the picker: this concert's plans loose at the top, every other concert in a group of its own
  const g = store.previewChoiceGroups.value;
  assert.deepEqual(g.current.map((o) => o.name), ['Option 2']);
  assert.ok(g.groups.length > 0 && g.groups.every((x) => x.concertId !== c && x.plans.length), 'other concerts are grouped by name');
  assert.equal(new Set(g.groups.map((x) => x.concertId)).size, g.groups.length, 'one group per concert');

  // drawn from the STORED sibling, not the stage
  const pv = store.previews.value[0];
  assert.deepEqual(A.seatNames(pv.plan.seats, pv.view.byId), bSeats);
  assert.notDeepEqual(names(), bSeats, 'and the two are actually different plans');

  // editing the stage cannot reach it
  const before = pv.plan.seats.slice();
  store.swap(0, 1);
  store.autoArrange();
  assert.deepEqual(store.previews.value[0].plan.seats, before, 'a preview is untouched by every stage edit');

  // the colour-by split is SHARED, so a preview follows it
  const split = store.SCH.value[0];
  store.ui.view = split;
  assert.equal(store.previews.value[0].view.ui.view, split);
  store.ui.view = A.SECTION_VIEW;

  // closing one leaves the other
  store.removePreview(key(third.id));
  assert.deepEqual(store.previews.value.map((p) => p.name), ['Version B']);

  // it never goes stale: opening the plan it was showing hides its preview (a plan is never its
  // own preview), and going back brings it back
  store.openArrangementById(c, second.id);
  assert.ok(!store.previews.value.some((p) => p.id === second.id), 'opening a previewed plan hides its preview');
  store.openArrangementById(c, first);
  assert.deepEqual(store.previews.value.map((p) => p.name), ['Version B'], 'and switching back shows it again');

  // another concert: the preview STAYS, named by its concert, drawn from its own library
  const cName = store.openConcertName.value;
  openExample();
  assert.notEqual(store.openConcertId.value, c);
  const away = store.previews.value;
  assert.deepEqual(away.map((p) => p.label), [`${cName} — Version B`], 'a preview survives opening another concert');
  assert.equal(away[0].current, false);
  assert.deepEqual(A.seatNames(away[0].plan.seats, away[0].view.byId), bSeats, 'and still shows the same plan');
  // and one of Schnittke's plans alongside it, from the open concert
  const exOther = store.previewChoiceGroups.value.current[0];
  assert.ok(store.addPreview(exOther.key));
  assert.deepEqual(store.previews.value.map((p) => p.current), [false, true]);
  store.removePreview(exOther.key);
  store.openArrangementById(c, first);
  assert.equal(store.previews.value[0].current, true, 'back home, it belongs to this concert again');

  // ...and deleting it
  store.deleteArrangement(second.id);
  assert.deepEqual(store.previews.value, [], 'deleting a previewed plan drops its preview');

  // nothing about it is saved
  store.addPreview(key(third.id));
  store.save();
  assert.ok(!JSON.stringify(JSON.parse(localStorage.getItem(P.LS.working))).includes(third.id));
  assert.deepEqual(JSON.parse(localStorage.getItem(P.LS.prefs)), { mode: store.ui.mode }, 'and prefs is still the one global');

  // deleting a concert drops its previews, seen from another concert: a throwaway copy's plan
  // previewed from this one
  store.clearPreviews();
  openCopy();
  const d = store.openConcertId.value;
  const dPlan = store.openArrangementId.value;
  store.openArrangementById(c, first);
  assert.ok(store.addPreview(key(dPlan, d)));
  store.deleteConcert(d);
  assert.deepEqual(store.previews.value, [], 'deleting a concert drops its previews');
  assert.equal(store.openConcertId.value, c, 'and the open concert is left alone');
  store.clearPreviews();
  ok('previews: several at once, across concerts, drawn from the library, immune to stage edits, dropped rather than stale, never saved');
}


/* ---------- 8c2. rosters are edited on their own ---------- */
{
  const openRoster = store.openRoster.value.id;
  const rosterOf = (id) => store.library.value.rosters.find((r) => r.id === id);
  const copy = store.addRoster('Copy', rosterOf(openRoster).singers);
  assert.equal(copy.singers.length, rosterOf(openRoster).singers.length, 'Save as has the same singers');
  const onStage = store.data.value.length;
  const someone = copy.singers[0];
  editRoster(copy.id, (list) => (list[0].name = 'Only In The Copy'));
  assert.notEqual(store.byId.value[someone.id]?.name, 'Only In The Copy', 'editing another roster does not touch the stage');
  editRoster(copy.id, (list) => list.push({ id: store.mint(store.ID.singer), name: 'Copy Singer', section: 'Bass' }));
  assert.equal(store.data.value.length, onStage, 'and a singer added to it does not join the open concert');
  // A concert moved onto another roster restarts on it: everyone in, no categories, reseated.
  const other = store.addRoster('Other choir', [{ id: 's1', name: 'Zed Other', section: 'Bass' }]);
  const cid = store.openConcertId.value;
  assert.ok(store.changeConcertRoster(cid, other.id));
  const moved = store.library.value.concerts.find((c) => c.id === cid);
  assert.equal(moved.rosterId, other.id);
  assert.deepEqual(moved.members.map((m) => m.singerId), ['s1']);
  assert.deepEqual(moved.assign, {});
  assert.deepEqual(store.data.value.map((p) => p.name), ['Zed Other'], 'the stage draws the new roster');
  assert.ok(store.seats.value.includes('s1'), 'and seats it afresh');
  assert.equal(store.changeConcertRoster(cid, other.id), false, 'the same roster again is a no-op');
  assert.ok(store.changeConcertRoster(cid, openRoster), 'and it can go back');
  assert.ok(store.deleteRoster(other.id));
  assert.ok(store.deleteRoster(copy.id), 'an unused roster can be deleted');
  const openC = store.openConcertId.value;
  assert.ok(store.deleteRoster(openRoster), 'and so can one a concert uses');
  assert.ok(!store.library.value.concerts.some((c) => c.id === openC || c.rosterId === openRoster), 'taking its concerts with it');
  assert.notEqual(store.openConcertId.value, openC, 'and the stage moves off the deleted concert');
  for (const c of [...store.library.value.concerts]) store.deleteConcert(c.id);
  assert.equal(store.openConcertId.value, '', 'with every concert gone, nothing is open');
  assert.deepEqual(store.seats.value, []);
  assert.equal(store.hasUnsavedChanges(), false);
  store.clearAll(); // back to the seed for the sections below
  ok('rosters: duplicated, edited and deleted; a used roster takes its concerts with it, and the last concert leaves nothing open');
}

/* ---------- 8d2. colours are global, with named schemes ---------- */
{
  openCopy();
  const first = store.openConcertId.value;
  // the Colours panel's edits: a draft of the active scheme's pair, saved whole
  const edit = (hex) => Pal.withSectionColour({ colours: store.colours.value, splitColours: store.splitColours.value }, 'Alto', hex);
  store.saveSchemeColours(store.palettes.value.active, edit('#123456'));
  assert.equal(store.sectionColours.value.Alto, '#123456');
  openCopy();
  assert.notEqual(store.openConcertId.value, first);
  assert.equal(store.sectionColours.value.Alto, '#123456', 'changing concert does not change the colours');
  assert.equal(store.hasUnsavedChanges(), false, 'and a colour is not an unsaved change to the plan');

  const made = store.addScheme('Venue', edit('#abcdef'));
  assert.equal(store.sectionColours.value.Alto, '#abcdef', 'Save as… starts from the draft it is handed');
  const defaultId = store.palettes.value.schemes[0].id;
  store.selectScheme(defaultId);
  assert.equal(store.sectionColours.value.Alto, '#123456', 'the other scheme kept its own');
  store.selectScheme(made.id);
  assert.equal(store.sectionColours.value.Alto, '#abcdef');
  assert.ok(store.deleteScheme(made.id));
  assert.equal(store.palettes.value.active, defaultId, 'deleting the active scheme falls back');
  assert.equal(store.deleteScheme(defaultId), false, 'and the last scheme cannot go');
  store.saveSchemeColours(store.palettes.value.active, { colours: {}, splitColours: {} });
  // the reference and print draw other plans in the SAME colours as the stage
  const other = store.concertPlans.value.find((p) => !p.open);
  if (other) assert.equal(other.plan.colours, store.colours.value);
  ok('colours: global across concerts, never unsaved plan data, and schemes switch cleanly');
}

/* ---------- 8e. the whole concert ---------- */
/*
 * The pack: every seating plan of the concert, printed and exported together. The one property
 * worth asserting headlessly is the one that is easy to get wrong and invisible when it is —
 * that the OPEN plan comes from the working copy and not from the library, so a pack always
 * matches the screen for the plan the screen is showing.
 */
{
  openCopy();
  const c = store.openConcertId.value;
  const first = store.openArrangementId.value;
  store.addArrangement('Version B', { from: 'working' });
  const [b] = store.concert.value.arrangements.filter((a) => a.id !== first);
  store.openArrangementById(c, b.id);
  store.autoArrange();
  store.saveArrangement();
  store.openArrangementById(c, first);

  const pack = store.concertPlans.value;
  assert.deepEqual(pack.map((p) => p.name), ['Option 1', 'Option 2', 'Version B']);
  assert.deepEqual(pack.map((p) => p.open), [true, false, false]);

  // every entry is a WHOLE plan: a sheet built from one cannot be missing a field
  for (const entry of pack) for (const f of PLAN_FIELDS) assert.ok(f in entry.plan, `${entry.name} has no ${f}`);

  // the open one follows the stage, saved or not — the point of the whole section
  store.swap(0, 1);
  assert.deepEqual(store.concertPlans.value[0].plan.seats, store.seats.value, 'the open plan IS the working copy');
  assert.notDeepEqual(store.concertPlans.value[1].plan.seats, store.seats.value, 'the others stay as they were saved');

  // ...and the export writes both, with no id in it
  store.exportConcertSeatingCSV();
  assert.ok(DOWNLOADED.includes('Option 1'), 'the first plan is in the file');
  assert.ok(DOWNLOADED.includes('Version B'), 'and so is the second');
  assert.ok(!/(^|,)s\d+(,|$)/m.test(DOWNLOADED), 'and no id reaches it');
  assert.ok(DOWNLOADED.split('\n').length > 10);

  ok('the concert pack: every plan, the open one live off the stage, and both in one CSV');
}

/* ---------- 9. what save() actually writes ---------- */
openCopy();
store.save();
assert.equal(Number(localStorage.getItem(P.LS.schema)), P.SCHEMA);
{
  const lib = JSON.parse(localStorage.getItem(P.LS.library));
  const saved = lib.rosters.find((r) => r.id === store.openRoster.value.id);
  assert.ok(saved.singers[0].id, 'the saved roster carries ids');
  assert.deepEqual(Object.keys(saved.singers[0]).sort(), ['id', 'name', 'section'], 'and nothing else');
  const open = JSON.parse(localStorage.getItem(P.LS.open));
  assert.equal(open.concertId, store.openConcertId.value);
  const working = JSON.parse(localStorage.getItem(P.LS.working));
  assert.equal(working.id, store.openArrangementId.value);
  for (const k of ['seats', 'pins', 'rows', 'cols', 'sectionOrder', 'labels', 'audienceAt', 'walkOn', 'view'])
    assert.ok(k in working, `the working copy must carry ${k}`);
  for (const k of ['colours', 'splitColours']) assert.ok(!(k in working), `colours are global, not in the working copy (${k})`);
  const palettes = JSON.parse(localStorage.getItem(P.LS.palettes));
  assert.equal(palettes.schemes.find((s) => s.id === palettes.active).name, 'Default', 'and the colour schemes are saved beside it');
  assert.deepEqual(JSON.parse(localStorage.getItem(P.LS.prefs)), { mode: store.ui.mode }, 'and prefs is down to the one true global');
  ok(`save() writes the library, what is open, and the working copy (${Object.keys(working).length} fields)`);
}

/* ---------- 10. the seat edits ---------- */
openCopy();
const [a0, a1] = [store.seats.value[0], store.seats.value[1]];
store.swap(0, 1);
assert.equal(store.seats.value[0], a1);
store.placeAt(a0, 0);
assert.equal(store.seats.value[0], a0);
store.unseat(a0);
assert.equal(store.seats.value[0], A.EMPTY);
assert.ok(store.waiting.value.includes(a0), 'and they are on the bench, by id');
assert.equal(store.waitingNames.value[0], store.byId.value[a0].name);
store.placeAt(a0, 0);
store.insertRowBlock(4);
assert.ok(store.seats.value.includes(A.BLOCKED));
store.removeRowBlock(4);
store.insertRowSpace(4);
store.removeRowSpace(4);
// Block and Space can push the row's last singer to the bench when there is no empty chair to
// absorb the shift, which is the tool working as designed. What must hold is that nobody is
// LOST: everyone is in a chair or on the bench, never in neither and never in both.
const onStage = store.seats.value.filter(A.isSinger);
assert.equal(onStage.length + store.waiting.value.length, 75);
assert.equal(new Set(onStage).size, onStage.length);
store.waiting.value.forEach((id) => assert.ok(store.byId.value[id], 'a bench entry must resolve'));
ok('swap / place / unseat / block / space all still work, keyed by id');

/* ---------- a newer version's store is not written over (last: it stops the store saving) ---------- */
await new Promise((r) => setTimeout(r, 300)); // let the debounced save land
assert.equal(LSMAP.get(P.LS.schema), String(P.SCHEMA));
assert.equal(store.storedIsNewer.value, false);
// A newer copy of the tool, open on the same storage, writes its own shape.
LSMAP.set(P.LS.schema, String(P.SCHEMA + 1));
LSMAP.set(P.LS.library, '{"theirs":true}');
store.swap(0, 1);
store.saveArrangement();
await new Promise((r) => setTimeout(r, 300));
assert.equal(store.storedIsNewer.value, true);
assert.equal(LSMAP.get(P.LS.schema), String(P.SCHEMA + 1), 'the stamp is theirs still');
assert.equal(LSMAP.get(P.LS.library), '{"theirs":true}', 'and so is the library');
store.discardStoredWork();
assert.ok(Object.values(P.LS).every((k) => !LSMAP.has(k)), 'the way out removes every key');
ok('a store stamped with a newer SCHEMA is not written over, and can be discarded');

console.log('\nall store smoke checks passed');
