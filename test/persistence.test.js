/*
 * Tests for the Choir Seating Tool persistence primitives: the stored keys, the version stamp, the
 * localStorage read, the backup version check, and the frozen backup fixture.
 *
 * Run: npm test    (plain `node --test`, no dependency and no config)
 *
 * The fixture rule: ONE frozen backup per schema version in test/fixtures, never edited after it
 * lands — it is the record of what that version actually wrote.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  SCHEMA,
  LS,
  readSnapshot,
  storedByNewerVersion,
  migrateSnapshot,
  MIGRATIONS,
  backupVersionProblem,
  clampRows,
  clampCols,
  AUDIENCE_DEFAULT
} from '../src/utils/persistence.js';
import { STAGE_ORDER } from '../src/utils/arranger.js';
import { LABEL_DEFAULTS } from '../src/utils/labels.js';
import { normaliseArrangement, normaliseLibrary } from '../src/utils/library.js';
import { normalisePalettes } from '../src/utils/palettes.js';

const fixture = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8'));

const reader = (stored) => (k) => (k in stored ? stored[k] : null);

/* ---------- the stamp and the keys ---------- */

test('SCHEMA is a positive integer', () => {
  assert.ok(Number.isInteger(SCHEMA) && SCHEMA >= 1);
});

test('the localStorage key names are stable', () => {
  // Renaming a key orphans the data behind it.
  assert.deepEqual(LS, {
    library: 'choir.library',
    open: 'choir.open',
    working: 'choir.working',
    palettes: 'choir.palettes',
    prefs: 'choir.prefs',
    schema: 'choir.schema'
  });
});

test('there is a frozen backup fixture for the current schema version', () => {
  assert.equal(fixture(`backup-v${SCHEMA}`).schema, SCHEMA);
});

test('the frozen fixture reads back exactly as it was written', () => {
  // Normalising what this version wrote must change nothing: a field renamed, dropped or given
  // a new default shows up here as a difference.
  const v1 = fixture('backup-v1');
  assert.equal(backupVersionProblem(v1), null);
  assert.deepEqual(normaliseLibrary(v1.library), v1.library, 'the id counter included');
  assert.deepEqual(normalisePalettes(v1.palettes), v1.palettes);
  assert.deepEqual(normaliseArrangement(v1.working), v1.working);
});

test('a backup from the beta, which stamped itself 1 too, is refused as older by its shape', () => {
  const beta = { schema: 1, splits: [], roster: [{ name: 'Ada', section: 'Alto' }], seats: [], pins: [], prefs: {} };
  assert.match(backupVersionProblem(beta), /older version/);
});

test('a beta store, stamped 1 under its own .v1 keys, reads as a store never written', () => {
  // Not a snapshot at all, so the store starts on the seed rather than adopting an empty library.
  const snap = readSnapshot(reader({ [LS.schema]: '1', 'choir.roster.v1': '[{"name":"Ada","section":"Alto"}]', 'choir.presets.v1': '[]' }));
  assert.equal(snap, null);
});

/* ---------- readSnapshot ---------- */

test('readSnapshot reads every key when the stamp is the current SCHEMA', () => {
  const library = { rosters: [], concerts: [] };
  const snap = readSnapshot(
    reader({
      [LS.schema]: String(SCHEMA),
      [LS.library]: JSON.stringify(library),
      [LS.open]: JSON.stringify({ concertId: 'c1', arrangementId: 'a1' }),
      [LS.prefs]: JSON.stringify({ mode: 'stage' })
    })
  );
  assert.equal(snap.schema, SCHEMA);
  assert.deepEqual(snap.library, library);
  assert.deepEqual(snap.open, { concertId: 'c1', arrangementId: 'a1' });
  assert.equal(snap.working, null, 'an absent key reads as null');
  assert.deepEqual(snap.prefs, { mode: 'stage' });
});

test('only a store stamped with a NEWER schema is somebody else’s to leave alone', () => {
  assert.equal(storedByNewerVersion(reader({ [LS.schema]: String(SCHEMA + 1) })), true);
  for (const stamp of [String(SCHEMA), String(SCHEMA - 1), 'nonsense']) {
    assert.equal(storedByNewerVersion(reader({ [LS.schema]: stamp })), false, stamp);
  }
  assert.equal(storedByNewerVersion(() => null), false, 'never written');
});

/* ---------- migrations ---------- */

test('every schema before this one has its migration step', () => {
  for (let v = 1; v < SCHEMA; v++) assert.equal(typeof MIGRATIONS[v], 'function', `MIGRATIONS[${v}] is missing`);
});

test('an older snapshot is carried forward one step at a time, and stamped as it goes', () => {
  const steps = {
    1: (s) => ({ ...s, library: { ...s.library, two: true } }),
    2: (s) => ({ ...s, library: { ...s.library, three: s.library.two } })
  };
  const out = migrateSnapshot({ schema: 1, library: { one: true }, prefs: { mode: 'stage' } }, 3, steps);
  assert.deepEqual(out, { schema: 3, library: { one: true, two: true, three: true }, prefs: { mode: 'stage' } });
  assert.deepEqual(migrateSnapshot({ schema: 2, library: { two: 'x' } }, 3, steps).library, { two: 'x', three: 'x' });
});

test('a snapshot of this schema is returned as it is, and there is no way back from a newer one', () => {
  const snap = { schema: SCHEMA, library: {} };
  assert.equal(migrateSnapshot(snap), snap);
  assert.equal(migrateSnapshot({ schema: SCHEMA + 1, library: {} }), null);
});

test('a stamp that is not a version, or a missing step, migrates to nothing', () => {
  for (const schema of [0, -1, 1.5, 'nonsense', null]) assert.equal(migrateSnapshot({ schema, library: {} }, 3, { 1: (s) => s, 2: (s) => s }), null);
  assert.equal(migrateSnapshot({ schema: 1, library: {} }, 3, { 1: (s) => s }), null, 'no step from 2');
  assert.equal(migrateSnapshot(null), null);
});

test('a store that has never been written is not a snapshot', () => {
  assert.equal(readSnapshot(() => null), null);
});

test('a store under a newer SCHEMA, or one with no way here, is not read at all', () => {
  for (const v of [SCHEMA - 1, SCHEMA + 1, 8, 'nonsense']) {
    const snap = readSnapshot(reader({ [LS.schema]: String(v), [LS.library]: JSON.stringify({ rosters: [], concerts: [] }) }));
    assert.equal(snap, null, `schema ${v}`);
  }
});

test('a key holding unparseable JSON reads as null rather than throwing', () => {
  const snap = readSnapshot(
    reader({ [LS.schema]: String(SCHEMA), [LS.library]: JSON.stringify({ rosters: [], concerts: [] }), [LS.open]: '{not json' })
  );
  assert.equal(snap.open, null);
});

test('an unreadable library is not a snapshot, so the store starts on the seed', () => {
  assert.equal(readSnapshot(reader({ [LS.schema]: String(SCHEMA), [LS.library]: '{not json' })), null);
});

/* ---------- backupVersionProblem ---------- */

test('a backup at the current SCHEMA has no version problem', () => {
  assert.equal(backupVersionProblem({ schema: SCHEMA, library: { rosters: [], concerts: [] } }), null);
});

test('an older, newer or unstamped backup is refused with a reason', () => {
  assert.match(backupVersionProblem({ schema: SCHEMA - 1 }), /older version/);
  assert.match(backupVersionProblem({ schema: SCHEMA + 1 }), /newer version/);
  assert.match(backupVersionProblem({ schema: SCHEMA }), /older version/, 'current stamp, no library: the beta');
  for (const bad of [null, 'text', 7, {}]) assert.match(backupVersionProblem(bad), /isn't a backup/);
});

/* ---------- a stored arrangement is completed field by field ---------- */

test('an arrangement with only an id comes out complete, so consumers need not guard a field', () => {
  const a = normaliseArrangement({ id: 'a1' });
  assert.deepEqual(a.seats, []);
  assert.deepEqual(a.pins, []);
  assert.equal(a.rows, undefined);
  assert.equal(a.cols, undefined);
  assert.deepEqual(a.sectionOrder, [...STAGE_ORDER]);
  assert.deepEqual(a.labels, { ...LABEL_DEFAULTS });
  assert.equal(a.audienceAt, AUDIENCE_DEFAULT);
});

test('an invalid section order falls back to the stage default', () => {
  assert.deepEqual(normaliseArrangement({ id: 'a1', sectionOrder: ['Soprano', 'Soprano', 'Alto', 'Bass'] }).sectionOrder, [...STAGE_ORDER]);
});

test('a half-written labelling scheme is completed, not dropped', () => {
  const a = normaliseArrangement({ id: 'a1', labels: { colOrder: 'rtl', rowFirst: 'upside-down' } });
  assert.deepEqual(a.labels, { ...LABEL_DEFAULTS, colOrder: 'rtl' });
});

test('out-of-range grid dimensions are clamped, not rejected', () => {
  const a = normaliseArrangement({ id: 'a1', rows: 99, cols: 0 });
  assert.equal(a.rows, clampRows(99));
  assert.equal(a.cols, clampCols(0));
});

test('normalising an arrangement does not mutate its input', () => {
  const input = { id: 'a1', seats: ['s1'], labels: { colOrder: 'rtl' } };
  const before = structuredClone(input);
  normaliseArrangement(input);
  assert.deepEqual(input, before);
});
