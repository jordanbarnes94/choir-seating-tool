// The plan-field validators live in utils/planFields.js; they are re-exported here because most
// importers name this module.
export * from './planFields.js';

/*
 * persistence — the pure half of the Choir Seating Tool store's save/load path.
 *
 * Plain functions over plain data: no Vue reactivity, no localStorage, no DOM, so `node --test`
 * reaches all of it. useChoirArranger.js keeps everything that touches Vue or localStorage.
 * (Note the explicit `.js` on imports in these utils: Vite resolves an extensionless specifier
 * and plain Node does not.)
 */

export const LS = {
  // The library: every roster and every concert, with their arrangements. One key, written whole.
  library: 'choir.library',
  // Which concert and which arrangement are open, and the working copy of that arrangement. The
  // working copy is kept apart from the stored record so that switching plans with unsaved edits
  // can warn first (Cancel / Save then load / Load).
  open: 'choir.open',
  working: 'choir.working',
  // The colour schemes. Global, not per concert: changing concert never changes the colours.
  palettes: 'choir.palettes',
  // The view mode.
  prefs: 'choir.prefs',
  schema: 'choir.schema'
};

// The version of the persisted / backup shape. Stored data or a backup stamped with any other
// number is NOT read: the tool starts empty, and a restore is refused with a message.
//
// Version 1 is the concert-model release: the library of rosters, concerts and seating plans,
// with the one id counter (`library.seq`, see utils/library.js).
//
// The beta that was live before it ALSO stamped `choir.schema` as 1, but it stored everything
// else under different keys (`choir.roster.v1`, `choir.presets.v1`, …), so a beta user's store
// reads here as a library never written and the tool starts on the seed library. Its backups carry
// the same stamp and no `library`; backupVersionProblem() tells them apart by shape. Nothing the
// beta wrote is read, deliberately — the shape changed too far for migrating to be worth its
// weight. From here on, a shape change bumps SCHEMA and adds the step to MIGRATIONS that carries
// the shape before it forward.
export const SCHEMA = 1;

/**
 * One step for each SCHEMA bump: `MIGRATIONS[n]` takes a snapshot as SCHEMA n wrote it
 * (`{ library, open, working, palettes, prefs }`, the stored keys and a backup file alike) and
 * returns it as SCHEMA n + 1 reads it. Somebody's work written by any older version is carried
 * forward one step at a time, so a step is never edited or removed once it has shipped.
 *
 * Empty while SCHEMA is 1: nothing older is read (see SCHEMA). The tests fail if a bump arrives
 * without its step.
 */
export const MIGRATIONS = {};

/**
 * A snapshot written under an older SCHEMA, brought up to this one, or the same snapshot if it is
 * this one's already. Null when there is no way from its stamp to here: a newer stamp, one that
 * is not a version, or a step that is missing.
 *
 * `to` and `steps` are parameters for the tests.
 */
export function migrateSnapshot(snap, to = SCHEMA, steps = MIGRATIONS) {
  let v = Number(snap && snap.schema);
  if (!Number.isInteger(v) || v < 1 || v > to) return null;
  for (; v < to; v++) {
    if (typeof steps[v] !== 'function') return null;
    snap = { ...steps[v](snap), schema: v + 1 };
  }
  return snap;
}

/**
 * Read the stored snapshot out of localStorage, migrated to this SCHEMA if an older version wrote
 * it, or null when there is nothing this build can use: a store never written, one written by a
 * NEWER version (see storedByNewerVersion), or one with no readable library (the beta's, or a
 * corrupt one).
 *
 * Takes `read` rather than touching localStorage itself so a plain `node` test can drive it.
 *
 * @param {(key: string) => (string|null)} read
 * @returns {object|null} `{ schema, library, open, working, palettes, prefs }`
 */
export function readSnapshot(read) {
  const json = (key) => {
    try {
      return JSON.parse(read(key));
    } catch {
      return null;
    }
  };
  // The stamp alone is not enough: the beta stamped 1 too, with no `choir.library`. Without a
  // library there is nothing to adopt, and normaliseLibrary(null) would open on an EMPTY library
  // rather than the seed.
  const library = json(LS.library);
  if (!library || typeof library !== 'object') return null;
  return migrateSnapshot({
    schema: Number(read(LS.schema)),
    library,
    open: json(LS.open),
    working: json(LS.working),
    palettes: json(LS.palettes),
    prefs: json(LS.prefs)
  });
}

/**
 * Whether what is stored was written under a newer SCHEMA than this build's: somebody's work, in
 * a shape this build cannot read. It happens to a person with two copies of the desktop app, or
 * one who went back to an older download. The store then neither reads it nor WRITES: saving
 * over it would swap their choirs for the example. The way forward is the newer version.
 *
 * The other direction is not a problem to report: older work is migrated (MIGRATIONS).
 *
 * @param {(key: string) => (string|null)} read
 */
export function storedByNewerVersion(read) {
  return Number(read(LS.schema)) > SCHEMA;
}

/**
 * Why a parsed backup file cannot be restored, or null if it can: it is this version's, or an
 * older one's that migrateSnapshot() brings forward. Its contents are validated record by record
 * afterwards; this checks the stamp, and the one thing the stamp cannot say: a beta backup is
 * stamped 1 too, and is told apart by having no `library` (see SCHEMA).
 */
export function backupVersionProblem(snap) {
  if (!snap || typeof snap !== 'object' || !('schema' in snap))
    return "That file isn't a backup this tool wrote.";
  const older = 'That backup was saved by an older version of this tool, which this version cannot read. Nothing has been changed.';
  if (Number(snap.schema) > SCHEMA) return 'That backup was saved by a newer version of this tool. Update the tool to restore it. Nothing has been changed.';
  if (!snap.library || typeof snap.library !== 'object') return older;
  return migrateSnapshot(snap) ? null : older;
}
