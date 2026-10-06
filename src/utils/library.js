/*
 * library — the roster / concert / arrangement model.
 * The pure half: plain functions over plain data, no Vue and no localStorage,
 * so `node --test` reaches all of it. See test/library.test.js.
 *
 * WHY THE SHAPE CHANGED. Until now a "preset" was a complete, self-contained plan carrying its
 * own full copy of the roster (`RosterDialog.savePreset`). Two plans for one choir therefore
 * drifted apart with nothing on screen to say so: correcting a name in one left every other
 * holding the old one, and the next load of those quietly emptied that chair. Jordan's
 * specification is three layers instead:
 *
 *   roster       every singer the choir has: { id, name, section }. Entered once, edited in
 *                one place, REUSED by every concert over it.
 *   concert      a reference to one roster, a tick list of which of its singers are in this
 *                concert, exactly ONE splits list, the per-singer categories for those splits,
 *                and an ordered set of arrangements.
 *   arrangement  one seating over that concert: seats, pins, the grid, and every setting that
 *                travels with a plan.
 *
 * FIVE RULES that this module enforces or encodes:
 *
 *  1. A concert has exactly one splits list. Two halves needing different splits are two
 *     concerts over one roster — a naming rule, not a limitation.
 *  2. A concert holds several arrangements, and siblings are GUARANTEED COMPARABLE because they
 *     share a roster and a splits list.
 *  3. Membership is a tick list, everyone in by default. A singer added to the roster later does
 *     NOT silently join existing concerts; they become available to tick in. A concert may also
 *     have GUESTS: singers who belong to that concert alone and never appear on the roster.
 *  4. Singers have stable ids. This module works in ids throughout and
 *     never in names — a concert references singers it does not own.
 *  5. Settings are arrangement data, except the colours, which are global (utils/palettes.js).
 *     utils/plan.js derives ARRANGEMENT_FIELDS from PLAN_FIELDS, so a new plan-level setting
 *     becomes part of an arrangement by being declared once.
 *
 * WHERE THE CATEGORIES LIVE, and why it is not on the singer. A roster record is
 * `{ id, name, section }` and nothing else: a singer's category in a split is a fact about ONE
 * CONCERT, and the old shape — the category as a property of the roster record — is exactly what
 * made a shared roster impossible (loading a plan whose
 * splits differ discarded the other plan's assignments). So a concert holds
 * `assign[singerId][splitId]`, and `concertSingers()` joins the two back into the flat record the
 * solver and every component already take. Stored normalised, worked denormalised.
 */
import {
  EMPTY,
  LIMITS,
  SECTIONS,
  STAGE_ORDER,
  isSinger,
  normaliseWalkOn
} from './arranger.js';
import { normaliseLabels } from './labels.js';
import { ARRANGEMENT_FIELDS, planOf } from './plan.js';
import {
  clampCols,
  clampRows,
  normaliseAudienceAt,
  validSectionOrder,
  validSplit
} from './planFields.js';

/* ---------- ids ---------- */
// One prefix per record kind, so a stray id is obviously of the wrong sort when it turns up in
// the wrong field. Guests take their own prefix so a guest id can never be a roster singer's
// (`s<n>`) as well.
export const ID = Object.freeze({ roster: 'r', concert: 'c', arrangement: 'a', split: 'split', guest: 'g', singer: 's' });

/*
 * THE COUNTER. Every id minted into a user's library — roster, singer, concert, arrangement,
 * split, guest — takes its number from ONE counter, `library.seq`, which only ever goes up. It
 * used to be derived (one past the highest id still present), which reused an id as soon as its
 * holder was deleted: delete the last singer, save, add somebody, and the newcomer inherited the
 * old singer's chair and pin in every seating plan that still named them.
 *
 * The counter is stored in the library, so it is saved, backed up and restored with it. It is
 * SEEDED — raised to one past the highest number any id in the library carries, references
 * included — wherever ids arrive from outside it: a load or a restore (both via normaliseLibrary).
 * So a library written before the counter
 * existed, or a hand-edited backup, can never have the counter mint an id it already uses.
 */
const ID_NUMBER = /^[A-Za-z]+(\d+)$/;
function highestIdNumber(library) {
  let max = 0;
  const see = (id) => {
    const m = typeof id === 'string' ? ID_NUMBER.exec(id) : null;
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const r of library.rosters || []) {
    see(r.id);
    for (const p of r.singers || []) see(p.id);
  }
  for (const c of library.concerts || []) {
    see(c.id);
    for (const m of c.members || []) see(m.singerId);
    for (const p of c.guests || []) see(p.id);
    for (const sp of c.splits || []) see(sp.id);
    for (const id of Object.keys(c.assign || {})) see(id);
    for (const a of c.arrangements || []) {
      see(a.id);
      for (const id of a.seats || []) see(id);
      for (const id of a.pins || []) see(id);
    }
  }
  return max;
}
/** Raise the counter past every id the library holds. Returns the library. */
export function seedCounter(library) {
  const seq = Number(library.seq);
  library.seq = Math.max(Number.isSafeInteger(seq) && seq > 0 ? seq : 1, highestIdNumber(library) + 1);
  return library;
}
/** The next id of a kind (`ID.roster`, …), taken from the library's counter. */
export function mintId(library, prefix) {
  if (!Number.isSafeInteger(library.seq) || library.seq < 1) seedCounter(library);
  return prefix + library.seq++;
}

/* ---------- validators ---------- */
// A roster singer is now { id, name, section } and NOTHING else. The old shape carried a
// category per split; those have moved to the concert (see the header).
export const validSinger = (p) =>
  p && typeof p.id === 'string' && p.id !== '' && typeof p.name === 'string' && isSinger(p.name) && SECTIONS.includes(p.section);

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Normalise a list of records, keeping the first of any duplicated id.
 *
 * ONE PASS, and that is the whole reason this is a function rather than
 * `.map(fn).filter(seen)`: map runs to completion before filter runs at all, so the seen-set is
 * still empty while the records are being normalised and every duplicate survives. It read
 * correctly and it did nothing. Keep the loop.
 */
function keepFirstById(list, normalise) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const rec = normalise(raw, seen);
    if (!rec || seen.has(rec.id)) continue;
    seen.add(rec.id);
    out.push(rec);
  }
  return out;
}

/* ---------- normalisation ---------- */
/*
 * Anything malformed is DROPPED rather than thrown on, so one corrupt record in a restored backup can never take the
 * rest with it, and survivors come out COMPLETE so no consumer has to guard a field. The
 * difference is that a library has referential integrity to keep as well — a concert naming a
 * roster that is not here has nothing to draw — so a dangling reference is dropped too.
 */

/**
 * One roster. Singer ids are made unique (first wins): the whole model addresses a singer by
 * id, so a second record under a seen id is unreachable and a delete would take both.
 */
export function normaliseRoster(raw, seenIds) {
  if (!raw || typeof raw !== 'object' || !nonEmpty(raw.id) || !Array.isArray(raw.singers)) return null;
  if (seenIds && seenIds.has(raw.id)) return null;
  const seen = new Set();
  const singers = raw.singers.filter((p) => validSinger(p) && !seen.has(p.id) && seen.add(p.id)).map((p) => ({ id: p.id, name: p.name, section: p.section }));
  if (singers.length > LIMITS.singers) singers.length = LIMITS.singers;
  return { id: raw.id, name: nonEmpty(raw.name) ? raw.name : 'Roster', singers };
}

/** One arrangement, with every plan field completed. */
export function normaliseArrangement(raw, seenIds) {
  if (!raw || typeof raw !== 'object' || !nonEmpty(raw.id)) return null;
  if (seenIds && seenIds.has(raw.id)) return null;
  const out = { id: raw.id, name: nonEmpty(raw.name) ? raw.name : 'Arrangement' };
  out.seats = Array.isArray(raw.seats) ? raw.seats.filter((c) => typeof c === 'string') : [];
  out.pins = Array.isArray(raw.pins) ? raw.pins.filter((c) => typeof c === 'string') : [];
  out.rows = Number.isFinite(raw.rows) ? clampRows(raw.rows) : undefined;
  out.cols = Number.isFinite(raw.cols) ? clampCols(raw.cols) : undefined;
  out.sectionOrder = validSectionOrder(raw.sectionOrder) ? raw.sectionOrder.slice() : [...STAGE_ORDER];
  out.labels = normaliseLabels(raw.labels);
  out.audienceAt = normaliseAudienceAt(raw.audienceAt);
  out.walkOn = normaliseWalkOn(raw.walkOn);
  // The colour-by split is the one genuinely ambiguous field: it names a
  // split id, split ids are per concert, so the VALUE cannot be global even though the
  // preference feels it. It is stored per arrangement and resolved against the concert's splits
  // when the arrangement is opened — which is what restoreJSON has always done with it.
  out.view = nonEmpty(raw.view) ? raw.view : '';
  // Every field of PLAN_FIELDS that belongs to an arrangement must be set above, or a plan built
  // from this record loses it silently — the exact failure utils/plan.js exists to prevent.
  for (const f of ARRANGEMENT_FIELDS) if (!(f in out)) throw new Error(`normaliseArrangement: no value for arrangement field "${f}"`);
  return out;
}

/** One split of a concert. */
export function normaliseSplit(raw) {
  if (!validSplit(raw)) return null;
  return { id: raw.id, name: raw.name, cats: raw.cats.slice(0, LIMITS.cats) };
}

/**
 * One concert. `rosters` is the already-normalised roster list: a concert naming a roster that
 * is not in it is DROPPED, because there is no honest way to draw it — it has singers it cannot
 * resolve. Membership is then narrowed to singers the roster actually has, which is the same
 * repair reconcileSeats makes to a seating and for the same reason.
 */
export function normaliseConcert(raw, rosters, seenIds) {
  if (!raw || typeof raw !== 'object' || !nonEmpty(raw.id)) return null;
  if (seenIds && seenIds.has(raw.id)) return null;
  const roster = (rosters || []).find((r) => r.id === raw.rosterId);
  if (!roster) return null;

  const onRoster = new Set(roster.singers.map((p) => p.id));
  // A guest whose id is also a roster singer's could not be told apart in a seat, so it is dropped.
  const seenGuests = new Set();
  const guests = (Array.isArray(raw.guests) ? raw.guests : [])
    .filter((p) => validSinger(p) && !onRoster.has(p.id) && !seenGuests.has(p.id) && seenGuests.add(p.id))
    .map((p) => ({ id: p.id, name: p.name, section: p.section }));
  const have = onRoster;
  const seenMembers = new Set();
  const members = (Array.isArray(raw.members) ? raw.members : [])
    .map((m) => (typeof m === 'string' ? { singerId: m } : m))
    .filter((m) => m && have.has(m.singerId) && !seenMembers.has(m.singerId) && seenMembers.add(m.singerId))
    .map((m) => ({ singerId: m.singerId }));

  const splits = keepFirstById(raw.splits, normaliseSplit).slice(0, LIMITS.splits);

  // assign is sparse and is NOT completed here: `concertSingers()` snaps a missing or stale
  // category to the split's first at read time. Completing it in storage would write an answer
  // for a question the user has not been asked.
  const splitIds = new Set(splits.map((s) => s.id));
  const assign = {};
  const rawAssign = raw.assign && typeof raw.assign === 'object' ? raw.assign : {};
  // Kept for everyone on the ROSTER, not just the members: a singer ticked out keeps their
  // categories in case they are ticked back in. And for every guest.
  for (const singerId of Object.keys(rawAssign)) {
    if (!have.has(singerId) && !seenGuests.has(singerId)) continue;
    const row = rawAssign[singerId];
    if (!row || typeof row !== 'object') continue;
    const kept = {};
    for (const splitId of Object.keys(row)) if (splitIds.has(splitId) && typeof row[splitId] === 'string') kept[splitId] = row[splitId];
    if (Object.keys(kept).length) assign[singerId] = kept;
  }

  const arrangements = keepFirstById(raw.arrangements, normaliseArrangement);

  return {
    id: raw.id,
    name: nonEmpty(raw.name) ? raw.name : 'Concert',
    rosterId: roster.id,
    members,
    guests,
    splits,
    assign,
    arrangements
  };
}

/**
 * The whole library: `{ rosters, concerts }`. Rosters first, because a concert is validated
 * against them.
 */
export function normaliseLibrary(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const rosters = keepFirstById(src.rosters, normaliseRoster);
  const concerts = keepFirstById(src.concerts, (c, seen) => normaliseConcert(c, rosters, seen));
  return seedCounter({ seq: src.seq, rosters, concerts });
}

export const emptyLibrary = () => ({ seq: 1, rosters: [], concerts: [] });

/* ---------- reading ---------- */

export const findRoster = (library, id) => (library && library.rosters ? library.rosters.find((r) => r.id === id) : undefined) || null;
export const findConcert = (library, id) => (library && library.concerts ? library.concerts.find((c) => c.id === id) : undefined) || null;
export const findArrangement = (concert, id) => (concert && concert.arrangements ? concert.arrangements.find((a) => a.id === id) : undefined) || null;

/**
 * THE JOIN, and the function everything downstream of the model depends on.
 *
 * A concert's singers as the FLAT record the solver, `byId` and every component already take —
 * `{ id, name, section, <splitId>: cat }` — built from the roster's singers, the concert's
 * membership and the concert's assignments. Stored normalised, worked denormalised.
 *
 * It is also where the category snapping lives, moved here verbatim from `rebuildFromRoster`:
 * a category that is missing, or that names a value the split no longer offers, becomes the
 * split's first. That is what makes deleting a category safe, and it is why `assign` may be
 * sparse in storage.
 *
 * Order is the ROSTER's, not the membership list's, so the bench and the roster table read in a
 * stable order that ticking somebody in and out again cannot shuffle. The concert's guests follow,
 * in the order they were added, each carrying `guest: true`.
 *
 * @returns {object[]} the concert's singers, in roster order, then its guests
 */
export function concertSingers(library, concert) {
  if (!concert) return [];
  const roster = findRoster(library, concert.rosterId);
  if (!roster) return [];
  const inConcert = new Set(concert.members.map((m) => m.singerId));
  const assign = concert.assign || {};
  const flat = (p, extra) => {
    const out = { id: p.id, name: p.name, section: p.section, ...extra };
    const row = assign[p.id] || {};
    for (const s of concert.splits) out[s.id] = s.cats.includes(row[s.id]) ? row[s.id] : s.cats[0];
    return out;
  };
  return [
    ...roster.singers.filter((p) => inConcert.has(p.id)).map((p) => flat(p)),
    ...(concert.guests || []).map((p) => flat(p, { guest: true }))
  ];
}

/** Everyone singing a concert, by id: its ticked members and its guests. */
export const concertSingerIds = (concert) =>
  concert ? [...concert.members.map((m) => m.singerId), ...(concert.guests || []).map((p) => p.id)] : [];

/**
 * One arrangement, as the PLAN that `makePlanView()` and `PlanSheet` take. The three layers are
 * joined by `planOf()` in utils/plan.js, which derives what an arrangement owns from PLAN_FIELDS,
 * so a plan built here cannot be missing a field the sheet reads.
 *
 * A stored arrangement can still seat or pin somebody who has since left the concert — only the
 * open one is reconciled, and the dialog asks before that happens. Here their chair is drawn
 * EMPTY and their pin dropped, because every consumer resolves a seated id through the singers
 * and an unknown one would throw. The stored record is not touched.
 */
export function concertPlan(library, concert, arrangement, scheme) {
  const singers = concertSingers(library, concert);
  const plan = planOf(singers, concert ? concert.splits : [], arrangement, scheme);
  const have = new Set(singers.map((p) => p.id));
  if (plan.seats) plan.seats = plan.seats.map((id) => (isSinger(id) && !have.has(id) ? EMPTY : id));
  if (plan.pins) plan.pins = plan.pins.filter((id) => have.has(id));
  return plan;
}

/**
 * The inverse of the join: the flat records back into a sparse `assign` map, for writing an edit
 * to a singer's category back into the concert. Only the splits in `SCH` are written, so a split
 * the concert no longer has drops out rather than accumulating.
 */
export function assignmentsFrom(rows, SCH) {
  const out = {};
  for (const p of rows || []) {
    if (!p || typeof p.id !== 'string') continue;
    const kept = {};
    for (const id of SCH || []) if (typeof p[id] === 'string') kept[id] = p[id];
    if (Object.keys(kept).length) out[p.id] = kept;
  }
  return out;
}

/* ---------- constructors ---------- */

/** A roster from a list of singers that already carry ids. */
export function makeRoster(library, name, singers) {
  return {
    id: mintId(library, ID.roster),
    name: nonEmpty(name) ? name : 'Roster',
    singers: (singers || []).map((p) => ({ id: p.id, name: p.name, section: p.section }))
  };
}

/**
 * A concert over a roster. Rule 3: EVERYONE IS IN BY DEFAULT and you untick whoever is skipping,
 * which is the way round that matches how a concert is actually assembled.
 */
export function makeConcert(library, name, roster, { splits = [], assign = {}, arrangements = [], memberIds = null, guests = [] } = {}) {
  const ids = memberIds ? new Set(memberIds) : null;
  return {
    id: mintId(library, ID.concert),
    name: nonEmpty(name) ? name : 'Concert',
    rosterId: roster.id,
    members: roster.singers.filter((p) => !ids || ids.has(p.id)).map((p) => ({ singerId: p.id })),
    guests: guests.map((p) => ({ id: p.id, name: p.name, section: p.section })),
    splits: splits.map((s) => normaliseSplit(s)).filter(Boolean),
    assign,
    arrangements
  };
}

/** An arrangement from a plan-shaped object, completed through normaliseArrangement. */
export function makeArrangement(library, name, plan = {}) {
  const raw = { id: mintId(library, ID.arrangement), name };
  for (const f of ARRANGEMENT_FIELDS) raw[f] = plan[f];
  raw.view = plan.view;
  return normaliseArrangement(raw);
}

/**
 * A flat plan (`{ roster, splits, ...arrangement fields }`, the roster rows carrying their
 * categories) into the library, as a roster + a concert over it + its single arrangement, each
 * named from `names = { roster, concert }`. The imported spreadsheet path uses it.
 */
export function importPlan(library, names, plan, arrangementName = 'Plan 1') {
  const rows = Array.isArray(plan && plan.roster) ? plan.roster : [];
  const splits = Array.isArray(plan && plan.splits) ? plan.splits : [];
  // Only rows that are already keyed can make a singer: mint them with mintId(library, ID.singer).
  const keyed = rows.filter(validSinger);
  const roster = makeRoster(library, names.roster, keyed);
  library.rosters.push(roster);

  const concert = makeConcert(library, names.concert, roster, {
    // the assignments lifted OFF the roster records, which is where they used to live and the
    // single reason a shared roster was impossible before this
    splits,
    assign: assignmentsFrom(keyed, splits.map((s) => s.id))
  });
  const arrangement = makeArrangement(library, arrangementName, plan);
  concert.arrangements.push(arrangement);
  library.concerts.push(concert);
  seedCounter(library);
  return { concertId: concert.id, arrangementId: arrangement.id };
}

/** Everything a concert draws, in one call: its singers, its splits, and one arrangement's plan. */
export function openView(library, concertId, arrangementId, scheme) {
  const concert = findConcert(library, concertId);
  const arrangement = findArrangement(concert, arrangementId) || (concert && concert.arrangements[0]) || null;
  return { concert, arrangement, plan: concert && arrangement ? concertPlan(library, concert, arrangement, scheme) : null };
}

/* ---------- the seed ---------- */

/**
 * The library a new user starts with, and what Clear everything goes back to: ONE roster
 * ("Example Choir") and several concerts over it, each with two or more seating plans that pass
 * the neighbour check. The Schnittke is sung by the whole roster; "Così fan tutte" by sixteen of
 * it, showing a concert that ticks only some of its roster's singers. Ordinary records off the
 * library's own counter, so the user can edit or delete them like anything they made. Built fresh
 * on each call, so it shares no structure with the constants.
 *
 * @param {{ roster: object[], concerts: Array<{ name: string, splits: object[], members?: string[],
 *           guests?: object[], plans: Array<{ name: string, rows: number, cols: number, seats: string[],
 *           walkOn?: object }> }> }} seed  Guests carry their categories as the roster rows do.
 */
export function seedLibrary(seed) {
  const { roster: singers, concerts } = seed;
  const lib = emptyLibrary();
  const roster = makeRoster(lib, 'Example Choir', singers);
  lib.rosters.push(roster);
  for (const c of concerts) {
    const guests = c.guests || [];
    const concert = makeConcert(lib, c.name, roster, {
      splits: c.splits,
      assign: assignmentsFrom([...singers, ...guests], c.splits.map((s) => s.id)),
      memberIds: c.members || null,
      guests
    });
    for (const p of c.plans) concert.arrangements.push(makeArrangement(lib, p.name, p));
    lib.concerts.push(concert);
  }
  // The singer and split ids come from the constants, not the counter: raise it past them.
  return seedCounter(lib);
}

/* ---------- membership: the tick list and the people who have left ---------- */
/*
 * The model's `members` tick list once had no screen: the roster table
 * edited the OPEN CONCERT's singers, so adding a row added to the roster and ticked in, and
 * deleting a row removed from both. That is fine while a roster has exactly one concert over it
 * and wrong the moment it has two — which is the shape the seed library ships in. These are
 * the pure half of the two screens that close it:
 *
 *   - the tick list: `withMember()` and `isMember()`, membership edited without touching the
 *     roster, so a singer sitting out one concert is still in the choir;
 *   - the stale-singer prompt: `staleSeated()` names the people an arrangement seats who are no
 *     longer in the concert, and `withoutSingers()` is the "Remove them and open" it offers.
 */

/** Is this singer ticked into the concert? */
export const isMember = (concert, singerId) => !!concert && concert.members.some((m) => m.singerId === singerId);

/**
 * The concert's membership with one singer ticked in or out.
 *
 * Rebuilt in ROSTER ORDER rather than appended to, so ticking somebody out and back in leaves
 * the stored file in the order a person reading it expects. `concertSingers()` already orders by
 * the roster, so nothing on screen depends on this — it is the file that benefits.
 *
 * @returns {object[]} the new members array; the concert is NOT mutated
 */
export function withMember(library, concert, singerId, on) {
  const roster = findRoster(library, concert.rosterId);
  if (!roster || !roster.singers.some((p) => p.id === singerId)) return concert.members.slice();
  const by = new Map(concert.members.map((m) => [m.singerId, m]));
  if (on) by.set(singerId, by.get(singerId) || { singerId });
  else by.delete(singerId);
  return roster.singers.filter((p) => by.has(p.id)).map((p) => ({ ...by.get(p.id) }));
}

/**
 * The stale-singer question: which singers does this arrangement seat or pin that the
 * concert no longer has?
 *
 * It is asked of a STORED arrangement before it reaches the stage, because the stage repairs
 * itself — `reconcileSeats()` empties an unknown chair the moment the working copy is filled,
 * which is exactly the silent loss this exists to stop. Ids only; see `staleSeated()`
 * for the names.
 */
export function staleSeatedIds(concert, arrangement) {
  if (!concert || !arrangement) return [];
  const have = new Set(concertSingerIds(concert));
  const out = [];
  const seen = new Set();
  for (const id of [...(arrangement.seats || []), ...(arrangement.pins || [])]) {
    if (!isSinger(id) || have.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The same, with names, which is what the prompt has to say: "nothing changes without consent"
 * is worth nothing if the consent is to a number.
 *
 * TWO KINDS OF STALE, and the caller may want to say them differently. `inRoster` is true for
 * somebody the choir still has who is simply not in this concert — tick them back in and the
 * chair is theirs again — and false for somebody deleted from the roster outright, whose name
 * is only recoverable from a backup (a guest who was removed from the concert reads the same way).
 *
 * @returns {{ id: string, name: string, inRoster: boolean }[]}
 */
export function staleSeated(library, concert, arrangement) {
  const roster = findRoster(library, concert ? concert.rosterId : '');
  const by = new Map((roster ? roster.singers : []).map((p) => [p.id, p]));
  return staleSeatedIds(concert, arrangement).map((id) => ({
    id,
    name: by.has(id) ? by.get(id).name : 'a singer who has left the choir',
    inRoster: by.has(id)
  }));
}

/**
 * A guest joins the choir: added to the concert's roster under a fresh roster id, ticked in, and
 * given their categories, chairs and pins under that id in every seating plan of the concert.
 * Other concerts over the roster do not gain them (rule 3).
 *
 * @returns {string|null} the new roster id, or null if there is no such guest
 */
export function moveGuestToRoster(library, concert, guestId, newId) {
  const roster = findRoster(library, concert && concert.rosterId);
  const guest = roster && (concert.guests || []).find((p) => p.id === guestId);
  if (!guest) return null;
  roster.singers.push({ id: newId, name: guest.name, section: guest.section });
  concert.guests = concert.guests.filter((p) => p.id !== guestId);
  concert.members = withMember(library, concert, newId, true);
  if (concert.assign[guestId]) {
    concert.assign[newId] = concert.assign[guestId];
    delete concert.assign[guestId];
  }
  const swap = (id) => (id === guestId ? newId : id);
  for (const a of concert.arrangements) {
    a.seats = (a.seats || []).map(swap);
    a.pins = (a.pins || []).map(swap);
  }
  return newId;
}

/**
 * The stale-singer answer: the arrangement with those people taken out of it. Their chairs
 * become EMPTY rather than closing up, because a seating is a physical layout and shuffling
 * everyone along one chair is not what "remove them" means to the person who is about to print
 * it.
 *
 * @returns {object} a NEW arrangement record; the original is untouched
 */
export function withoutSingers(arrangement, ids) {
  const drop = new Set(ids);
  return {
    ...arrangement,
    seats: (arrangement.seats || []).map((id) => (drop.has(id) ? EMPTY : id)),
    pins: (arrangement.pins || []).filter((id) => !drop.has(id))
  };
}
