import { ref, computed, reactive, watch, toRaw, effectScope } from 'vue';
import {
  SECTIONS,
  STAGE_ORDER,
  SECTION_VIEW,
  SECTION_KEY,
  DEFAULT_ROWS,
  EMPTY,
  BLOCKED,
  isBlocked,
  isSinger,
  gridCols as colsFor,
  BASIC_SPLITS,
  EXAMPLE_CONCERTS,
  EXAMPLE_ROSTER,
  LIMITS,
  cloneSplits,
  cloneRoster,
  deriveSplitGlobals,
  makeEngine,
  normaliseColours,
  normaliseSplitColours,
  resolveSectionColours,
  resolveSplitFrames,
  WALKON_DEFAULTS,
  WALKON_OPTIONS,
  walkRowSequence,
  blockedColumns,
  rosterById,
  seatNames
} from '../utils/arranger.js';
import {
  COLS_MIN,
  clampRows,
  clampCols,
  LS,
  SCHEMA,
  backupVersionProblem,
  readSnapshot,
  storedByNewerVersion,
  migrateSnapshot,
  limitProblem,
  AUDIENCE_DEFAULT,
  validAudienceAt
} from '../utils/persistence.js';
import { LABEL_DEFAULTS, LABEL_OPTIONS, colLabelAt, seatLabelFor } from '../utils/labels.js';
import { ARRANGEMENT_FIELDS, buildPlan } from '../utils/plan.js';
import { activeScheme, defaultPalettes, makeScheme, normalisePalettes } from '../utils/palettes.js';
import { makePlanView } from './usePlanView.js';
import {
  assignmentsFrom,
  concertPlan,
  concertSingerIds,
  concertSingers,
  emptyLibrary,
  findArrangement,
  findConcert,
  findRoster,
  ID,
  importPlan,
  isMember,
  makeArrangement,
  makeConcert,
  makeRoster,
  mintId,
  moveGuestToRoster,
  normaliseArrangement,
  normaliseLibrary,
  staleSeated,
  withMember,
  seedLibrary,
  withoutSingers
} from '../utils/library.js';
import { walkOnFor, walkOnRows, walkOnText } from '../utils/walkOnList.js';
import {
  buildImport,
  classifyColumns,
  csvText,
  headerProblem,
  matchRosterByName,
  normaliseRows,
  parseCSV,
  rosterTemplateCSV,
  sniffFormat,
  templateCSV
} from '../utils/spreadsheet.js';
import { concertSeatingRows, exportFilename, seatingRows, seatingTitle, slugify } from '../utils/exportCsv.js';

/*
 * useChoirArranger — single shared store for the Choir Seating Tool.
 *
 * Holds all reactive state (the library, what is open, the working copy of it, ui) and every action.
 * The pure solver lives in utils/arranger.js; this composable threads the current reactive
 * state into it.
 *
 * Seating is ONE grid: `seats` is a single array of singer IDS (and the EMPTY / BLOCKED
 * sentinels). A singer's section is a property on their roster record (in `data`), never a
 * function of where they sit; sections are a derived overlay. So a swap only exchanges two
 * cells and can never change anyone's section.
 *
 * THE KEY INTO A PERSON IS THEIR `id`, NEVER THEIR NAME. `seats`, the
 * pins, the bench and every list the solver returns hold ids; `byId` resolves one to a record;
 * and a NAME is produced at the last moment, by whoever is about to show it to somebody. That
 * is what makes a rename in the roster reach the stage, the pins and the splits at once with
 * no fan-out to forget a path of — and it is what concerts need in order to share one
 * roster between several plans. Everything the user receives is still names: the CSV exports,
 * the printed sheet and the walk-on list all resolve through seatNames() / `byId` first.
 *
 * THE STORE HOLDS A LIBRARY, NOT A PLAN. `library` is every roster and
 * every concert the user has; `openConcertId` and `openArrangementId` say which one is on
 * screen. Two things follow, and they are why so much of this file reads differently:
 *
 *   - `data` and `splits` are DERIVED, not stored. The singers on screen are the open concert's
 *     membership joined to its roster and its split assignments (`concertSingers`), and the
 *     splits are the concert's. The setup dialog edits DRAFTS of the roster, the concert and the
 *     assignments, and commits each on Save (commitRoster, commitConcert); a committed roster
 *     edit reaches every concert over that roster at once — which is the point of a shared roster.
 *   - A new user's library starts as the SEED (seedLibrary): the example choir and its concerts,
 *     as ordinary records they can edit or delete. Clear everything goes back to it.
 *   - EVERYTHING ELSE ON SCREEN IS A WORKING COPY of the open arrangement: the seating, the
 *     pins, the grid, the section order and every view setting. It is deliberately NOT the
 *     stored record: switching arrangements with unsaved edits has to be able to
 *     warn, with Cancel / Save then load / Load, and a warning needs something to warn about.
 *     There is no undo anywhere in this module, so a silent write on an accidental switch would
 *     be unrecoverable.
 *
 * The store is a module-level singleton so every component shares one instance. Storage is
 * first read by init(), which ChoirArranger calls in onMounted.
 */


let store = null;

function createStore() {
  /* ---------- the library ---------- */
  // Every roster and every concert the user has. `ref` rather than `reactive` so the whole thing
  // can be replaced on a restore; Vue's ref is deeply reactive, so an in-place edit to a singer's
  // name reaches every concert drawing them without the object being rebuilt.
  const library = ref(emptyLibrary());
  const openConcertId = ref('');
  const openArrangementId = ref('');
  const concert = computed(() => findConcert(library.value, openConcertId.value));
  const openRoster = computed(() => (concert.value ? findRoster(library.value, concert.value.rosterId) : null));
  // The stored record the working copy below belongs to. Null while nothing is open, and while
  // the open arrangement has been deleted from under us.
  const openArrangement = computed(() => findArrangement(concert.value, openArrangementId.value));

  /* ---------- derived from the library: who is on stage, and how they divide ---------- */
  // Neither is a `ref` that anything writes to. They
  // are projections: the open concert's membership joined to its roster and its assignments,
  // and the open concert's own splits list. Writing to either means writing to the library, which
  // is what makes one roster reach several concerts.
  const data = computed(() => concertSingers(library.value, concert.value));
  const splits = computed(() => (concert.value ? concert.value.splits : []));

  /* ---------- the working copy of the open arrangement ---------- */
  const seats = ref([]); // the fixed grid: a rows*cols rectangle of [id | EMPTY | BLOCKED]
  const gridRows = ref(DEFAULT_ROWS); // fixed stage depth
  const gridCols = ref(COLS_MIN); // fixed stage width (chairs across)
  const pinnedIds = ref([]); // pinned singer ids (a pin follows the singer, rename and all)
  // `tab` is the top-level tab: 'arrange' (the stage, the controls, the neighbour check) or
  // 'walkon' (the walk-on order, over a read-only stage that numbers every seat with its walk-on
  // position). `report` is whether the neighbour check under the stage is open. Ways of looking
  // at the plan, not part of it: never saved with the plan (ChoirArranger.vue remembers them per
  // browser).
  // `highlight` is the set of singer ids the neighbour check is pointing at while one of its
  // entries is hovered, or null. The stage rings them and fades everyone else. Never saved.
  // `peekView` is the column (a split id, or SECTION_VIEW) of the entry being pointed at, or null.
  // While set, the live stage colours and marks by it instead of `view`, so the frames and arrows
  // on show belong to the split being reviewed. Never saved.
  // `marked` is the neighbour check entry pinned by a click, as { sec, split, fid }, or null, and
  // `markedText` names it for the pill over the stage that unpins it. The report keeps both up to
  // date. Never saved.
  // `headings` is the "Seat labels" tick box over the stage, which the previews under it follow.
  // A view affordance, not plan data: never saved either.
  const ui = reactive({ mode: 'stage', view: SECTION_VIEW, peekView: null, report: true, tab: 'arrange', highlight: null, marked: null, markedText: null, headings: true });
  // The colour-by the live stage is drawn with: the pointed-at column, else the chosen one.
  const stageView = computed(() => ui.peekView ?? ui.view);
  // Seat labelling. PLAN data, not a user preference: a labelling scheme describes a
  // venue, and the venue belongs to the plan, so these four fields are saved with the plan, ride
  // in every preset and travel in a backup. `ui` above is the global view blob and is the wrong
  // home for them. Purely cosmetic: nothing here is ever read by the solver, by drag and drop or
  // by anything that writes `seats`.
  const labels = reactive({ ...LABEL_DEFAULTS });
  // Which side of the plan the audience is on. Plan data for the same reason the
  // labelling is: it says how this plan is meant to be read. Purely a rendering setting, like
  // the labels: `seats` is never written back reversed, so the solver, the Block/Space tools and
  // every drop still see one unrotated grid.
  const audienceAt = ref(AUDIENCE_DEFAULT);
  // The colour schemes. GLOBAL, not plan data: changing concert or seating plan never
  // changes the colours. `colours` and `splitColours` are the ACTIVE scheme's sparse override
  // maps — a section or frame that is absent is painted from the app's default at read time, so a
  // later retune of a default reaches every scheme that never chose its own. Write them by
  // replacing the object (saveSchemeColours below), never by mutating it in place.
  const palettes = ref(defaultPalettes());
  const scheme = computed(() => activeScheme(palettes.value));
  const colours = computed(() => scheme.value.colours);
  const splitColours = computed(() => scheme.value.splitColours);
  // What everything actually paints with: the four sections, overrides resolved.
  const sectionColours = computed(() => resolveSectionColours(colours.value));
  // What the cells draw their borders in: every section's run of category positions, keyed by
  // section NAME and category POSITION, overrides resolved against splitFrame().
  const splitFrames = computed(() => resolveSplitFrames(sectionColours.value, splitColours.value));
  // The walk-on configuration. Plan data on the same reasoning as the two above: it
  // describes a venue's risers and its wings, and the venue belongs to the plan. `perRow` is
  // indexed FRONT-FIRST, matching the internal row index, never the labelling's cosmetic `rowFirst`.
  const walkOn = reactive({ ...WALKON_DEFAULTS, perRow: [] });
  const sectionOrder = ref([...STAGE_ORDER]); // left-to-right section precedence on the stage
  const rosterOpen = ref(false);
  // Which face the dialog opens with: 'setup' (Choir setup's tabs) or 'settings' (the cogwheel).
  const setupScreen = ref('setup');
  // The library a new user starts with, and Clear everything returns to.
  const seed = () => seedLibrary({ roster: EXAMPLE_ROSTER, concerts: EXAMPLE_CONCERTS });
  // Cross-grid drop highlights during a pointer drag session. Written by useDragDrop,
  // read by SeatGrid / WaitingArea so every instance reacts.
  const dragOverGi = ref(null); // absolute grid index (gi) under the pointer, or null
  const dragOverBench = ref(false); // true while a seated singer hovers the bench

  const busy = reactive({ open: false, text: '' });
  const toast = reactive({ show: false, text: '', nochange: false });

  /* ---------- derived globals ---------- */
  const derived = computed(() => deriveSplitGlobals(splits.value));
  const SCH = computed(() => derived.value.SCH);
  const SCH_LABEL = computed(() => derived.value.SCH_LABEL);
  const SPLIT_OPTIONS = computed(() => derived.value.SPLIT_OPTIONS);
  const CAT_INDEX = computed(() => derived.value.CAT_INDEX);
  // THE lookup. Every component that draws a seat, a chip or a report row resolves through this
  // and takes `.name` off the record; nothing downstream of `seats` reads a name out of the grid.
  const byId = computed(() => rosterById(data.value));
  const pinnedSet = computed(() => new Set(pinnedIds.value));

  // placement-derived state. `placed` = singers currently in a seat; `waiting` = roster members
  // who aren't (the bench), in a stable section-then-name order. `capacity` = seats that could
  // hold a singer (everything that isn't BLOCKED).
  const placedSet = computed(() => new Set(seats.value.filter(isSinger)));
  // ids, like everything else here that names a person. Ordered by section and then by NAME,
  // because the bench is read by a human: the ORDER is presentation even though the list is not.
  // Array.prototype.sort is stable, so two singers who share a name keep their roster order.
  const waiting = computed(() => {
    const placed = placedSet.value, bn = byId.value;
    return data.value
      .map((p) => p.id)
      .filter((id) => !placed.has(id))
      .sort((a, b) => {
        const sa = SECTIONS.indexOf(bn[a].section), sb = SECTIONS.indexOf(bn[b].section);
        return sa !== sb ? sa - sb : bn[a].name.localeCompare(bn[b].name);
      });
  });
  // ...and the same bench as NAMES, for everything that shows it to somebody: the chips, the
  // seating CSV's "Not seated" block and the walk-on sheet's. One conversion in one order, so
  // the three cannot list the bench differently.
  const waitingNames = computed(() => waiting.value.map((id) => byId.value[id].name));
  const capacity = computed(() => seats.value.reduce((c, n) => c + (isBlocked(n) ? 0 : 1), 0));
  const gridTotal = () => gridRows.value * gridCols.value;

  // a fresh engine bound to the current state (cheap to rebuild on demand).
  const engine = () =>
    makeEngine({
      DATA: data.value,
      byId: byId.value,
      SCH: SCH.value,
      seats: seats.value,
      pinned: pinnedSet.value,
      order: sectionOrder.value
    });

  // the global "alone" set, shared by both views so badges always agree: anyone isolated
  // from their section, plus anyone isolated in the current colour-by split.
  const stageStranded = computed(() => {
    if (!seats.value.length) return new Set();
    const eng = engine();
    const seq = seats.value, r = gridRows.value;
    const set = new Set(eng.evaluate2D(seq, r, SECTION_KEY).stranded);
    if (stageView.value !== SECTION_VIEW) eng.evaluate2D(seq, r, stageView.value).stranded.forEach((n) => set.add(n));
    return set;
  });
  // The milder mark beside it, over the same two keys: singers with a group-mate only in front or
  // behind, nobody beside them. Each key's list excludes that key's stranded singers already;
  // anyone stranded under the OTHER key is dropped too, so a chair shows one mark, the worse.
  // A Map from id to the keys it is lateral under, so the grid can point its arrow at the
  // group-mates that key counts: SeatGrid looks for them in the chairs above and below.
  const stageLateral = computed(() => {
    const map = new Map();
    if (!seats.value.length) return map;
    const eng = engine();
    const seq = seats.value, r = gridRows.value;
    const keys = stageView.value !== SECTION_VIEW ? [SECTION_KEY, stageView.value] : [SECTION_KEY];
    keys.forEach((key) => eng.lateralIsolated2D(seq, r, key).forEach((n) => map.set(n, [...(map.get(n) || []), key])));
    stageStranded.value.forEach((n) => map.delete(n));
    return map;
  });
  // The neighbour check in one line, for its header while it is collapsed: how many singers are
  // alone in their section or in ANY split, and how many groups are split across the grid. The
  // same two defects the report's table lists, counted over every column it has.
  const neighbourSummary = computed(() => {
    if (!seats.value.length) return { alone: 0, broken: 0 };
    const eng = engine();
    const seq = seats.value, r = gridRows.value;
    const alone = new Set();
    let broken = 0;
    for (const key of [SECTION_KEY, ...SCH.value]) {
      const e = eng.evaluate2D(seq, r, key);
      e.stranded.forEach((id) => alone.add(id));
      broken += e.broken.length;
    }
    return { alone: alone.size, broken };
  });

  /* ---------- validators ---------- */
  // There is no withinLimits() wrapper here any more. It used to alert() from inside and
  // return a boolean, which meant the caller could report the failure only by not reporting
  // it: the reason lived in browser chrome and never reached the panel. The whole
  // io panel is off alert(), so the bulk-input paths (import and restore) now call the pure
  // limitProblem() in utils/persistence.js directly and hand the reason back to the caller,
  // which is the same thing the silent preset-restore path has always done with it.

  /* ---------- writing the roster back ---------- */
  // Take a FLAT roster — `{ id, name, section, <splitId>: cat }`, the shape every screen and the
  // solver work in — and file each half where it belongs: the identity in the
  // roster record, the categories in the concert. `data` then recomputes from the library, so
  // the caller does not write it and cannot get the two halves out of step.
  //
  // It is also where a roster is GUARANTEED to have ids. Every roster entering the store comes
  // through here, and each of those paths already mints them (normaliseLibrary(),
  // importAsConcert, addSinger). The mint below is the backstop for input none of them produced:
  // it assigns a fresh id, which strands whatever chair referred to that person and leaves
  // reconcileSeats to empty it. That is the right failure — one empty chair, not a roster that
  // cannot be keyed.
  //
  // MEMBERSHIP FOLLOWS THE LIST IT IS GIVEN, which is right while the roster table shows one
  // concert's singers: adding a row adds a singer AND ticks them in, deleting removes them from
  // both. The tick list that separates the two is the concert screen, and it edits `members`
  // directly rather than going through here.
  function writeRoster(rows) {
    const c = concert.value;
    if (!c) return;
    const roster = findRoster(library.value, c.rosterId);
    if (!roster) return;
    const all = [];
    for (const r of rows) {
      all.push({ ...r, id: typeof r.id === 'string' && r.id ? r.id : mintId(library.value, ID.singer) });
    }
    // A guest's row edits the guest; it never reaches the roster.
    const guestIds = new Set(c.guests.map((p) => p.id));
    const byGuest = new Map(all.filter((r) => guestIds.has(r.id)).map((r) => [r.id, r]));
    c.guests = c.guests.filter((p) => byGuest.has(p.id)).map((p) => ({ id: p.id, name: byGuest.get(p.id).name, section: byGuest.get(p.id).section }));
    const keyed = all.filter((r) => !guestIds.has(r.id));
    // Singers the roster has but this concert does not are left alone: another concert may hold
    // them, and editing one concert must never delete somebody out of a roster it shares.
    const inRows = new Map(keyed.map((r) => [r.id, r]));
    const wasMember = new Set(c.members.map((m) => m.singerId));
    roster.singers = roster.singers
      .filter((p) => !wasMember.has(p.id) || inRows.has(p.id))
      .map((p) => (inRows.has(p.id) ? { id: p.id, name: inRows.get(p.id).name, section: inRows.get(p.id).section } : p));
    const known = new Set(roster.singers.map((p) => p.id));
    for (const r of keyed) if (!known.has(r.id)) roster.singers.push({ id: r.id, name: r.name, section: r.section });
    c.members = keyed.map((r) => ({ singerId: r.id }));
    c.assign = assignmentsFrom(all, SCH.value);
  }
  // Kept under its old name because every caller reads better for it: "rebuild the live state
  // from this roster" is still exactly what it does.
  const rebuildFromRoster = writeRoster;
  function prunePins() {
    const ids = new Set(data.value.map((p) => p.id));
    pinnedIds.value = pinnedIds.value.filter((id) => ids.has(id));
  }

  /* ---------- the roster layer ---------- */
  /*
   * The setup dialog edits a DRAFT of a roster and hands the whole list back on Save, so the
   * library only ever holds saved rosters. commitRoster is where a saved edit fans out: a singer
   * gone from the roster leaves every concert over it, and a singer new to it joins the OPEN
   * concert when that concert uses it — added to the choir but silently missing from the stage
   * you are looking at would be a trap. Rule 3 still holds for every other concert.
   */
  // Every singer on the open concert's roster, each with whether this concert has ticked them in.
  const rosterSingers = computed(() => {
    const r = openRoster.value;
    if (!r) return [];
    const c = concert.value;
    return r.singers.map((p) => ({ id: p.id, name: p.name, section: p.section, in: isMember(c, p.id) }));
  });
  const rosterOptions = computed(() => library.value.rosters.map((r) => ({ id: r.id, name: r.name, singers: r.singers.length })));
  const openRosterName = computed(() => (openRoster.value ? openRoster.value.name : ''));
  // Which concerts draw on a roster.
  const concertsUsingRoster = (rosterId) => library.value.concerts.filter((c) => c.rosterId === rosterId);

  function commitRoster(rosterId, singers) {
    const r = findRoster(library.value, rosterId);
    if (!r) return false;
    const had = new Set(r.singers.map((p) => p.id));
    r.singers = singers.slice(0, LIMITS.singers).map((p) => ({ id: p.id, name: p.name, section: SECTIONS.includes(p.section) ? p.section : SECTIONS[0] }));
    const keep = new Set(r.singers.map((p) => p.id));
    for (const c of concertsUsingRoster(r.id)) {
      c.members = c.members.filter((m) => keep.has(m.singerId));
      const guests = new Set(c.guests.map((p) => p.id));
      const assign = {};
      for (const id of Object.keys(c.assign)) if (keep.has(id) || guests.has(id)) assign[id] = c.assign[id];
      c.assign = assign;
    }
    const open = concert.value;
    if (open && open.rosterId === r.id) {
      // ...but never past the limit a restore holds a concert to.
      let singing = concertSingerIds(open).length;
      for (const p of r.singers)
        if (!had.has(p.id) && singing < LIMITS.singers) {
          open.members = withMember(library.value, open, p.id, true);
          singing++;
        }
    }
    prunePins();
    reconcileSeats();
    return true;
  }
  // A new roster holding these singers: empty for New, the draft on screen for Save as. Singer
  // ids are kept, which is safe because an id is unique within its roster only.
  function addRoster(name, singers = []) {
    const r = makeRoster(library.value, name, singers);
    library.value.rosters.push(r);
    return r;
  }
  function renameRoster(rosterId, name) {
    const r = findRoster(library.value, rosterId);
    if (!r || !name) return false;
    r.name = name;
    return true;
  }
  // Every concert over the roster goes with it, since a concert with no roster has nobody to
  // draw. The dialog names those concerts before it asks.
  function deleteRoster(rosterId) {
    if (!findRoster(library.value, rosterId)) return false;
    const gone = new Set(concertsUsingRoster(rosterId).map((c) => c.id));
    library.value.concerts = library.value.concerts.filter((c) => !gone.has(c.id));
    library.value.rosters = library.value.rosters.filter((r) => r.id !== rosterId);
    if (gone.has(openConcertId.value)) openFirstConcert();
    return true;
  }

  /* ---------- the concert layer ---------- */
  // Who is singing, the splits, and each singer's categories, from the dialog's drafts. Any of
  // the three may be given. Ticking somebody out can strand their chair, so the working seating
  // is reconciled and their pin pruned — the same repair loading an arrangement makes.
  function applyConcertDraft(c, { members, guests, splits: nextSplits, assign } = {}) {
    if (members) {
      const on = new Set(members);
      c.members = findRoster(library.value, c.rosterId).singers.filter((p) => on.has(p.id)).map((p) => ({ singerId: p.id }));
    }
    if (guests) c.guests = guests.map((p) => ({ id: p.id, name: p.name, section: SECTIONS.includes(p.section) ? p.section : SECTIONS[0] }));
    if (nextSplits) {
      c.splits = nextSplits.map((sp) => ({ id: sp.id, name: sp.name, cats: sp.cats.slice() }));
      // A plan coloured by a split that has gone falls back to section colour, so a split made
      // later can never inherit it.
      const ids = new Set(c.splits.map((sp) => sp.id));
      for (const a of c.arrangements) if (a.view && !ids.has(a.view)) a.view = '';
    }
    if (assign) c.assign = JSON.parse(JSON.stringify(assign)); // not structuredClone: it throws on a reactive proxy
    // a removed guest's categories go with them
    if (guests) {
      const keep = new Set([...findRoster(library.value, c.rosterId).singers.map((p) => p.id), ...c.guests.map((p) => p.id)]);
      for (const id of Object.keys(c.assign)) if (!keep.has(id)) delete c.assign[id];
    }
  }
  // A guest joins the concert's roster, keeping their seats and categories in every plan of it.
  function moveGuestToChoir(guestId) {
    const c = concert.value;
    const r = openRoster.value;
    if (!c || !r || r.singers.length >= LIMITS.singers) return null;
    const wasClean = !hasUnsavedChanges();
    const newId = moveGuestToRoster(library.value, c, guestId, mintId(library.value, ID.singer));
    if (!newId) return null;
    const swap = (id) => (id === guestId ? newId : id);
    seats.value = seats.value.map(swap);
    pinnedIds.value = pinnedIds.value.map(swap);
    if (wasClean) markClean();
    return newId;
  }
  function commitConcert(draft) {
    const c = concert.value;
    if (!c) return false;
    applyConcertDraft(c, draft);
    if (ui.view !== SECTION_VIEW && !SCH.value.includes(ui.view)) ui.view = SCH.value[0] || SECTION_VIEW;
    prunePins();
    reconcileSeats();
    return true;
  }

  /* ---------- the whole concert ---------- */
  /*
   * Every seating plan of the open concert, each as a plain plan object, for the two things
   * done with them: printing them all and exporting them all.
   *
   * THE OPEN ONE COMES FROM THE WORKING COPY, not from the library, and that is the only
   * subtle thing here. What is on the stage is what the user is looking at; printing the stored
   * version of it because they have not pressed Save yet would hand them a sheet that does not
   * match the screen, which is the one thing a printed plan must never do. Every OTHER plan
   * comes from the library, because that is all there is of it. So the pack is always "what you
   * can see, plus what you have saved".
   *
   * One renderer and one exporter, on one shared path: a whole-concert print
   * is `PlanSheet` repeated, and a whole-concert export is `seatingRows()` repeated. Neither is
   * a second implementation of anything.
   */
  const concertPlans = computed(() => {
    const c = concert.value;
    if (!c) return [];
    return c.arrangements.map((a) => ({
      id: a.id,
      name: a.name,
      open: a.id === openArrangementId.value,
      plan: a.id === openArrangementId.value ? livePlan.value : concertPlan(library.value, c, a, scheme.value)
    }));
  });

  // Every plan of the concert as one CSV. `waiting` is each plan's OWN bench — who that plan
  // leaves standing, which may differ from plan to plan and is half of what distinguishes them.
  function exportConcertSeatingCSV() {
    const c = concert.value;
    if (!c) return false;
    const plans = concertPlans.value.map(({ name, plan }) => {
      const view = makePlanView(plan, ui.view);
      const placed = new Set((plan.seats || []).filter(isSinger));
      return {
        name,
        seats: seatNames(plan.seats, view.byId),
        rows: plan.rows,
        cols: plan.cols,
        labels: plan.labels,
        audienceAt: plan.audienceAt,
        waiting: (plan.roster || []).filter((p) => !placed.has(p.id)).map((p) => p.name),
        // The colour-by split is a VIEW setting and is shared across the concert, so every
        // block says the same thing — but it is still said per block, because a block is meant
        // to be readable on its own after somebody has cut it out of the file.
        colourBy: ui.view === SECTION_VIEW ? 'section' : SCH_LABEL.value[ui.view] || 'section'
      };
    });
    downloadFile(
      exportFilename(openConcertName.value, 'all-seatings', 'csv'),
      csvText(concertSeatingRows({ concertName: openConcertName.value, plans })),
      'text/csv'
    );
    return true;
  }

  /* ---------- previews: other plans shown read-only beside this one ---------- */
  /*
   * ONE editable plan and any number of read-only PREVIEWS of its sibling arrangements, drawn
   * under the stage (or beside each section block). A preview needs no second store, no autosave,
   * no press session and no bench, so the ways a second editable plan could corrupt the first do
   * not exist rather than being guarded against.
   *
   * A preview may come from ANOTHER concert, and stays when a different concert is opened: "can
   * I compare two plans from different concerts" is a fair question. Such a plan brings its own
   * roster and splits with it (see makePlanView), so it is drawn correctly, just about different
   * people; its heading names the concert so that is never a surprise.
   *
   * NOTHING HERE IS SAVED: previews are a way of looking at the plan, not part of it.
   */
  // A preview is named by concert AND plan.
  const previewKey = (concertId, arrangementId) => concertId + '|' + arrangementId;
  // The keys asked for, in the order they were added. What the rest of the app reads is DERIVED
  // from it, so a preview whose plan stops existing — the plan or its concert deleted, or the plan
  // itself opened on the stage — disappears in the same tick rather than leaving a frame in which
  // it draws a plan nothing can name.
  const previewRaw = ref([]);
  // Every plan that could be previewed: all of them except the one on the stage, the open
  // concert's first so the pickers can list them at the top.
  const referenceOptions = computed(() => {
    const open = concert.value;
    const all = library.value.concerts;
    const ordered = open ? [open, ...all.filter((c) => c.id !== open.id)] : all;
    return ordered.flatMap((c) =>
      c.arrangements
        .filter((a) => !(c.id === openConcertId.value && a.id === openArrangementId.value))
        .map((a) => {
          const current = c.id === openConcertId.value;
          // `label` is how a preview is named once shown: the concert too, when it is not this one
          const label = current ? a.name : `${c.name} — ${a.name}`;
          return { key: previewKey(c.id, a.id), id: a.id, name: a.name, label, concertId: c.id, concertName: c.name, current };
        })
    );
  });
  // Each preview as `{ key, id, name, label, concertId, concertName, current, plan, view }`. The plan is
  // the STORED arrangement, never the working copy, and the view is coloured by the same split as
  // the stage when the plan has it: two plans coloured by different splits is a comparison that
  // misleads. (A plan from another concert without that split falls back to sections.)
  const previews = computed(() => {
    const byKey = new Map(referenceOptions.value.map((o) => [o.key, o]));
    return previewRaw.value
      .filter((k) => byKey.has(k))
      .map((k) => {
        const o = byKey.get(k);
        const c = findConcert(library.value, o.concertId);
        const plan = concertPlan(library.value, c, findArrangement(c, o.id), scheme.value);
        return { ...o, plan, view: makePlanView(plan, ui.view) };
      });
  });
  // The plans not already previewed, for the "Add a preview" pickers.
  const previewChoices = computed(() => {
    const shown = new Set(previews.value.map((p) => p.key));
    return referenceOptions.value.filter((o) => !shown.has(o.key));
  });
  // The same, grouped for a <select>: the open concert's plans loose at the top, every other
  // concert's in an <optgroup> under its name.
  const previewChoiceGroups = computed(() => {
    const current = previewChoices.value.filter((o) => o.current);
    const groups = [];
    for (const o of previewChoices.value) {
      if (o.current) continue;
      let g = groups[groups.length - 1];
      if (!g || g.concertId !== o.concertId) groups.push((g = { concertId: o.concertId, name: o.concertName, plans: [] }));
      g.plans.push(o);
    }
    return { current, groups };
  });
  function addPreview(key) {
    if (!previewChoices.value.some((o) => o.key === key)) return false;
    previewRaw.value = [...previewRaw.value.filter((x) => previews.value.some((p) => p.key === x)), key];
    return true;
  }
  const removePreview = (key) => (previewRaw.value = previewRaw.value.filter((x) => x !== key));
  const clearPreviews = () => (previewRaw.value = []);

  /* ---------- an arrangement that seats somebody who has left ---------- */
  /*
   * "An arrangement seating singers who are no longer in the concert stops and names them,
   * offering Cancel or 'Remove them and open'." The check has to happen against the STORED
   * record, before the working copy is filled, because filling it runs reconcileSeats() and
   * that empties the chair silently — the exact loss this check exists to stop.
   *
   * These two are the store's half; the asking is the dialog's, because only it can ask.
   */
  function staleForOpen(concertId, arrangementId) {
    const c = findConcert(library.value, concertId);
    const a = findArrangement(c, arrangementId) || (c && c.arrangements[0]) || null;
    return c && a ? staleSeated(library.value, c, a) : [];
  }
  // The consent, written into the STORED arrangement rather than only into the working copy.
  // Opening it would empty those chairs on screen either way; writing it back is what makes the
  // stage open CLEAN instead of instantly dirty, and it is what the user just agreed to.
  function dropStale(concertId, arrangementId) {
    const c = findConcert(library.value, concertId);
    const a = findArrangement(c, arrangementId) || (c && c.arrangements[0]) || null;
    if (!c || !a) return 0;
    const ids = staleSeated(library.value, c, a).map((p) => p.id);
    if (!ids.length) return 0;
    const next = withoutSingers(a, ids);
    a.seats = next.seats;
    a.pins = next.pins;
    return ids.length;
  }

  /* ---------- seating ---------- */
  // force `seats` to be exactly a gridRows*gridCols rectangle: trim overflow, pad with EMPTY.
  // Column-major, so padding/trimming only ever adds or drops whole trailing columns.
  function ensureGrid() {
    const t = gridTotal();
    const a = seats.value.slice(0, t);
    while (a.length < t) a.push(EMPTY);
    seats.value = a;
  }
  // build a fresh grid from the roster: size the width to fit everyone at the current depth,
  // then auto-arrange the whole roster (all on the bench) into it.
  function freshSeats() {
    gridCols.value = clampCols(colsFor(data.value.length, gridRows.value));
    seats.value = new Array(gridTotal()).fill(EMPTY);
    const res = engine().arrangeAll(gridRows.value, gridCols.value, waiting.value);
    seats.value = res.seats;
  }
  // restore a saved grid: adopt its rows/cols (falling back to a width that fits the array),
  // coerce it to a clean rectangle, then reconcile ids against the current roster. Returns
  // false if the array is missing, malformed or empty — a new arrangement has no seats yet, and
  // the caller solves a fresh seating for it.
  function loadSavedSeats(saved, rows, cols) {
    if (!Array.isArray(saved) || !saved.length || !saved.every((n) => typeof n === 'string')) {
      // The plan's own depth still holds, so it is solved at that and not at the last plan's.
      gridRows.value = clampRows(rows || DEFAULT_ROWS);
      return false;
    }
    gridRows.value = clampRows(rows || gridRows.value);
    gridCols.value = clampCols(cols || colsFor(saved.length, gridRows.value));
    seats.value = saved.slice();
    ensureGrid();
    reconcileSeats();
    return true;
  }
  // keep `seats` consistent with the roster without moving anyone: drop ids that are no longer
  // in the roster (or duplicated) by vacating their cell to EMPTY; EMPTY and BLOCKED cells are
  // left untouched. Singers new to the roster simply stay on the bench until placed. Always
  // leaves `seats` a clean rectangle.
  //
  // Keyed by id, and that one word is the whole point of singers having ids: correcting
  // "Helen Mar" to "Helen Marr" used to make this function decide she was no longer in the
  // roster and empty her chair. Her id does not change when her name does, so now it does
  // nothing at all.
  function reconcileSeats() {
    ensureGrid();
    const present = new Set(data.value.map((p) => p.id));
    const seen = new Set();
    seats.value = seats.value.map((id) => {
      if (!isSinger(id)) return id;
      if (!present.has(id) || seen.has(id)) return EMPTY;
      seen.add(id);
      return id;
    });
  }

  /* ---------- the plan, and the working copy it is half of ---------- */
  // THE plan object, and the one place the live state is listed as one. Everything that draws,
  // saves or compares a whole plan goes through here: PlanSheet via ChoirArranger, save(),
  // backupJSON(), and the working copy the library is saved from.
  //
  // utils/plan.js explains why it is a builder and not an object literal. The short version is
  // that an object literal lost this list a field at a time — the sheet printed the default
  // palette for a fortnight because `colours` was missing from it — and buildPlan() throws on a
  // field of PLAN_FIELDS with no source here, so the next omission is a crash on the first call
  // rather than a wrong colour on somebody's printed handout.
  //
  // Getters, not values: the computed re-reads them on every invalidation, so the plan is always
  // the live one. The reactive blocks (`labels`, `walkOn`) are handed over as themselves rather
  // than copied — a plan is a view of the state, and both are snapshotted at the two places that
  // actually need a detached copy (save() stringifies, planSnapshot() stringifies).
  const livePlan = computed(() =>
    buildPlan({
      roster: () => data.value,
      splits: () => splits.value,
      seats: () => seats.value,
      rows: () => gridRows.value,
      cols: () => gridCols.value,
      pins: () => pinnedIds.value,
      sectionOrder: () => sectionOrder.value,
      labels: () => labels,
      audienceAt: () => audienceAt.value,
      colours: () => colours.value,
      splitColours: () => splitColours.value,
      walkOn: () => walkOn
    })
  );
  // THE WORKING COPY, as an arrangement record: every field of the plan that belongs to one
  // arrangement, detached, plus the id and name of the record it is a copy OF.
  //
  // Derived from `livePlan` rather than listed again, so a new plan-level field is saved into
  // the arrangement, backed up, and compared for unsaved changes by being declared in
  // PLAN_FIELDS and nowhere else. ARRANGEMENT_FIELDS is PLAN_FIELDS minus the roster and the
  // splits, which belong to the layers above.
  function workingArrangement() {
    const p = livePlan.value;
    const out = { id: openArrangementId.value, name: openArrangement.value ? openArrangement.value.name : 'Plan 1', view: ui.view };
    for (const f of ARRANGEMENT_FIELDS) out[f] = snapPlanField(f, p[f]);
    return out;
  }
  // ...and the reverse: adopt a stored arrangement as the working copy. Every field is read
  // through normaliseArrangement first, so a hand-edited backup arrives complete and legal
  // rather than blanking half the stage.
  // `keepView` is for opening a plan: the colour-by split is a way of LOOKING, like Full stage
  // or By section, so it stays as it is across a switch (while the concert still has that split)
  // rather than jumping to whatever the plan was last saved with. A restore — a reload, a backup —
  // takes the stored one, which is how the choice survives a reload at all.
  function adoptArrangement(raw, { keepView = false } = {}) {
    const a = normaliseArrangement({ ...raw, id: raw && raw.id ? raw.id : 'a1' });
    sectionOrder.value = a.sectionOrder.slice();
    Object.assign(labels, a.labels);
    audienceAt.value = a.audienceAt;
    Object.assign(walkOn, a.walkOn);
    pinnedIds.value = a.pins.slice();
    prunePins();
    // `view` names a split id, and split ids belong to the concert, so an arrangement can name
    // one its concert has not got — a restored file, or a split deleted since. Falls back to
    // section colour, which is what restoreJSON has always done with it.
    const want = keepView ? ui.view : a.view;
    ui.view = want && SCH.value.includes(want) ? want : SECTION_VIEW;
    // seats last: loadSavedSeats reconciles against the roster, which the two lines above settle.
    if (loadSavedSeats(a.seats, a.rows, a.cols)) return false;
    freshSeats();
    return true;
  }
  // The only true global left. Everything that used to be in `prefs` — the grid, the section
  // order, the labelling, the palette, the walk-on block — is arrangement data and now lives in
  // the arrangement, which is what ends the double
  // storage: they were a user preference AND inside every preset, and loading one silently
  // changed the other.
  const prefsBlob = () => ({ mode: ui.mode });
  // A DETACHED copy of one plan field, on its way into localStorage or into a backup. The
  // generic clause covers a flat array or a flat map; the two named ones are nested, where a
  // shallow copy would hand the file the live inner objects and a later edit would mutate what
  // was supposed to be a snapshot.
  function snapPlanField(field, v) {
    if (field === 'walkOn') return snapWalkOn();
    if (Array.isArray(v)) return v.slice();
    return v && typeof v === 'object' ? { ...v } : v;
  }

  /* ---------- persistence ---------- */
  // Adopt a stored snapshot: the library, what was open, and the working copy on top of it.
  // Shared by the localStorage load and the backup restore, so a returning user and a restored
  // file land in exactly the same state.
  function adoptSnapshot(snap) {
    previewRaw.value = [];
    library.value = normaliseLibrary(snap.library);
    palettes.value = normalisePalettes(snap.palettes);
    if (snap.prefs && ['bysection', 'stage'].includes(snap.prefs.mode)) ui.mode = snap.prefs.mode;
    const open = snap.open && typeof snap.open === 'object' ? snap.open : {};
    const c = findConcert(library.value, open.concertId);
    if (!c) {
      openFirstConcert();
    } else {
      openConcertId.value = c.id;
      const a = findArrangement(c, open.arrangementId) || c.arrangements[0] || null;
      openArrangementId.value = a ? a.id : '';
      if (a) adoptArrangement(a);
      else freshSeats();
    }
    // The working copy, if there was one and it still belongs to the arrangement that is open.
    // An orphan — its arrangement deleted, or a different one opened since — is DROPPED rather
    // than applied to whatever happens to be open now, which would silently move somebody
    // else's seating onto this plan.
    const w = snap.working;
    // `open` and `working` are always written together, so a matching id is the same arrangement.
    if (c && w && typeof w === 'object' && w.id === openArrangementId.value) adoptArrangement(w);
    markCleanAgainstStored();
  }
  // True when what is stored was written by a newer version of the tool, in a shape this one
  // cannot read. The arranger then shows that and nothing else (ChoirArranger.vue), and save()
  // writes nothing: the seed below is only what is in memory behind the message.
  const storedIsNewer = ref(false);
  function loadFromStorage() {
    storedIsNewer.value = storedByNewerVersion((k) => localStorage.getItem(k));
    // `null` is a store never written, or one this build cannot read: either way the tool starts
    // on the seed. An older version's store comes back migrated.
    const snap = readSnapshot((k) => localStorage.getItem(k));
    if (!snap) {
      library.value = seed();
      openFirstConcert();
      markCleanAgainstStored();
      return;
    }
    adoptSnapshot(snap);
  }
  // `all` false writes only the small keys: the library and the palettes are rewritten only when
  // they changed. Stringified off the raw object, since walking the reactive proxy is ~7x slower.
  function save(all = true) {
    try {
      // Asked every time, not only at startup: a newer copy of the tool can be open on the same
      // storage and write its own shape while this one is running.
      if (storedByNewerVersion((k) => localStorage.getItem(k))) {
        storedIsNewer.value = true;
        return;
      }
      localStorage.setItem(LS.schema, String(SCHEMA));
      if (all) localStorage.setItem(LS.library, JSON.stringify(toRaw(library.value)));
      localStorage.setItem(LS.open, JSON.stringify({ concertId: openConcertId.value, arrangementId: openArrangementId.value }));
      // The working copy is stored SEPARATELY from the record it is a copy of, which is what
      // lets a reload come back to the unsaved seating a user was in the middle of — and what
      // lets Save still mean something afterwards.
      localStorage.setItem(LS.working, JSON.stringify(workingArrangement()));
      if (all) localStorage.setItem(LS.palettes, JSON.stringify(toRaw(palettes.value)));
      localStorage.setItem(LS.prefs, JSON.stringify(prefsBlob()));
    } catch { /* quota / private mode */ }
  }

  // The way out of newer work that the user chooses instead of updating: everything the tool has stored goes, and the
  // caller reloads the page, which then opens on the example as a first visit does.
  function discardStoredWork() {
    for (const key of Object.values(LS)) localStorage.removeItem(key);
  }

  /* ---------- roster edits ---------- */
  function applyRosterEdit(mutate) {
    const roster = cloneRoster(data.value, SCH.value);
    mutate(roster);
    rebuildFromRoster(roster);
    prunePins();
    reconcileSeats();
  }
  function uniqueCat(s) {
    let n = 1, c;
    do {
      c = 'Part ' + n++;
    } while (s.cats.includes(c));
    return c;
  }
  // Every new id comes off the library's one counter (utils/library.js), so it is never one that
  // anything has held before: a split deleted in a draft cannot hand its id to a new one, nor a
  // deleted singer their chairs. The dialogs mint through these for records still in a draft.
  const mint = (prefix) => mintId(library.value, prefix);
  const newSplitId = () => mint(ID.split);

  /* ---------- concerts and arrangements ---------- */
  // What the pickers list. Concerts in library order, each with its arrangements. Read-only
  // shape: the actions below are the only writers.
  const concertOptions = computed(() =>
    library.value.concerts.map((c) => ({ id: c.id, name: c.name, arrangements: c.arrangements.map((a) => ({ id: a.id, name: a.name })) }))
  );

  // The concert's own singers, named for the screen that shows them: the roster table edits
  // these, and the concert's membership is what decides who is in the list.
  const openConcertName = computed(() => (concert.value ? concert.value.name : ''));
  const openArrangementName = computed(() => (openArrangement.value ? openArrangement.value.name : ''));

  // Put an arrangement on screen. This is the ONLY way the working copy is filled, so there is
  // one path from a stored record to the stage and it cannot drift from the one save() writes.
  // The caller has already dealt with unsaved changes — see the three ways out, which
  // live in the dialog because only it can ask.
  function openArrangementById(concertId, arrangementId, after) {
    const c = findConcert(library.value, concertId);
    if (!c) return false;
    const a = findArrangement(c, arrangementId) || c.arrangements[0] || null;
    // Commit the concert AND the seats in one synchronous step so `data` / `byId` and `seats`
    // never disagree across a reactive flush. (If the concert were swapped first and the seats
    // deferred — e.g. behind the busy RAF — the stage would briefly hold the OLD arrangement's
    // ids against the NEW roster, and the byId lookups in StageView/SeatGrid would throw.)
    const step = () => {
      // Anybody the stored plan seats who has left is emptied from the stage by the adopt; that
      // is an unsaved change, never the saved state, so it is compared to the store.
      const stale = a ? staleSeated(library.value, c, a).length : 0;
      openConcertId.value = c.id;
      openArrangementId.value = a ? a.id : '';
      // An arrangement with no seating yet (a new concert's first plan) is solved on open, and
      // the solve is saved straight back so the plan does not open already "unsaved".
      if (a) {
        if (adoptArrangement(a, { keepView: true })) saveArrangement();
      } else {
        pinnedIds.value = [];
        freshSeats();
      }
      if (stale) markCleanAgainstStored();
      else markClean();
    };
    runBusySteps('Loading…', [step], () => { if (after) after(); }, c.members.length);
    return true;
  }

  // Save the working copy into the arrangement it is a copy of. "Save" is the only
  // thing that writes the stage back into the library.
  function saveArrangement() {
    const c = concert.value, a = openArrangement.value;
    if (!c || !a) return false;
    const w = workingArrangement();
    for (const f of ARRANGEMENT_FIELDS) a[f] = w[f];
    a.view = w.view;
    markClean();
    return true;
  }

  /* ---------- library edits ---------- */
  function addConcert(name, { rosterId = null, singers = null, rosterName = null } = {}) {
    let roster = rosterId ? findRoster(library.value, rosterId) : null;
    if (!roster) {
      roster = makeRoster(library.value, rosterName || name, singers || []);
      library.value.rosters.push(roster);
    }
    const c = makeConcert(library.value, name, roster, { splits: cloneSplits(BASIC_SPLITS) });
    c.arrangements.push(makeArrangement(library.value, 'Plan 1', {}));
    library.value.concerts.push(c);
    return c;
  }
  // Put a concert over another roster. Its seats, pins and categories name the OLD roster's
  // singer ids, which mean nothing (or someone else) in the new one, so the concert restarts:
  // everyone on the new roster ticked in, categories cleared, and every seating plan emptied so
  // it is solved afresh when it opens. The splits and the guests are kept.
  function changeConcertRoster(concertId, rosterId) {
    const c = findConcert(library.value, concertId);
    const r = findRoster(library.value, rosterId);
    if (!c || !r || c.rosterId === r.id) return false;
    c.rosterId = r.id;
    c.members = r.singers.slice(0, Math.max(0, LIMITS.singers - c.guests.length)).map((p) => ({ singerId: p.id }));
    c.assign = {};
    // Every plan is solved afresh at its own depth now, not only the one that is opened next: the
    // others are printed, exported and previewed as stored.
    const people = concertSingers(library.value, c);
    const bn = rosterById(people);
    const sch = deriveSplitGlobals(c.splits).SCH;
    for (const a of c.arrangements) {
      const rows = clampRows(a.rows || DEFAULT_ROWS), cols = clampCols(colsFor(people.length, rows));
      const eng = makeEngine({ DATA: people, byId: bn, SCH: sch, seats: [], pinned: new Set(), order: a.sectionOrder });
      a.rows = rows;
      a.cols = cols;
      a.seats = eng.arrangeAll(rows, cols, people.map((p) => p.id)).seats;
      a.pins = [];
    }
    if (openConcertId.value === c.id) openArrangementById(c.id, openArrangementId.value);
    return true;
  }
  function renameConcert(id, name) {
    const c = findConcert(library.value, id);
    if (c && name) c.name = name;
  }
  function deleteConcert(id) {
    const c = findConcert(library.value, id);
    if (!c) return;
    library.value.concerts = library.value.concerts.filter((x) => x.id !== id);
    // Its previews go with it: a preview of a plan that no longer exists has nothing to draw.
    previewRaw.value = previewRaw.value.filter((x) => !x.startsWith(id + '|'));
    // The roster stays: rosters stand on their own, and one is deleted from the Roster tab.
    if (openConcertId.value === id) openFirstConcert();
  }
  function addArrangement(name, { from = null } = {}) {
    const c = concert.value;
    if (!c) return null;
    // A duplicate copies the WORKING COPY, not the stored record: "make me another one like
    // this" means like the one I am looking at.
    const a = makeArrangement(library.value, name, from === 'working' ? workingArrangement() : {});
    c.arrangements.push(a);
    return a;
  }
  function renameArrangement(id, name) {
    const a = findArrangement(concert.value, id);
    if (a && name) a.name = name;
  }
  function deleteArrangement(id) {
    const c = concert.value;
    if (!c || c.arrangements.length < 2) return false; // a concert always keeps one
    c.arrangements = c.arrangements.filter((a) => a.id !== id);
    // A preview of it has nothing left to draw.
    previewRaw.value = previewRaw.value.filter((x) => x !== previewKey(c.id, id));
    if (openArrangementId.value === id) openArrangementById(c.id, c.arrangements[0].id);
    return true;
  }
  /*
   * Save the open concert as a new one, sharing its roster, and open it. `draft` is the dialog's
   * unsaved concert edits, which land in the copy rather than in the original. The open plan's
   * working copy moves to the copy's plan too, so nothing on the stage is lost by saving it
   * elsewhere.
   */
  function saveConcertAs(name, draft = null, after = null) {
    const c = concert.value;
    if (!c) return null;
    const copy = makeConcert(library.value, name, openRoster.value, {
      splits: c.splits,
      assign: JSON.parse(JSON.stringify(c.assign)),
      memberIds: c.members.map((m) => m.singerId),
      guests: c.guests
    });
    for (const a of c.arrangements) copy.arrangements.push(makeArrangement(library.value, a.name, a));
    library.value.concerts.push(copy);
    const idx = Math.max(0, c.arrangements.findIndex((a) => a.id === openArrangementId.value));
    const target = copy.arrangements[idx];
    const w = workingArrangement();
    for (const f of ARRANGEMENT_FIELDS) target[f] = w[f];
    target.view = w.view;
    // Into the copy BEFORE it opens: opening may be deferred a frame for a large concert.
    if (draft) applyConcertDraft(copy, draft);
    openArrangementById(copy.id, target.id, after);
    return copy;
  }
  // Open the first concert, or, with none left, nothing: the stage then says how to start.
  function openFirstConcert() {
    const c = library.value.concerts[0];
    if (c) return openArrangementById(c.id, c.arrangements[0] ? c.arrangements[0].id : '');
    openConcertId.value = '';
    openArrangementId.value = '';
    pinnedIds.value = [];
    seats.value = [];
    markCleanAgainstStored();
    return false;
  }

  // The name of the plan ACTUALLY on screen, for a filename: the concert's, which is what a
  // director calls the thing they are printing. '' when nothing is open, which exportFilename
  // turns into `choir`.
  const loadedPlanName = () => openConcertName.value || '';
  // Why a name cannot be a concert's, or null. `exceptId` is the concert being renamed, which
  // may keep its own name.
  function concertNameProblem(name, exceptId = null) {
    name = String(name || '').trim();
    if (!name) return 'Enter a name.';
    if (!slugify(name)) return 'Use at least one letter or number.';
    // By slug, which is what the export filenames address a concert by.
    if (library.value.concerts.some((c) => c.id !== exceptId && slugify(c.name) === slugify(name)))
      return `You already have a concert named "${name}".`;
    return null;
  }

  /* ---------- unsaved changes ---------- */
  // Whether the working copy on stage differs from the arrangement it is a copy of, which is
  // exactly what the unsaved-changes warning has to know before it replaces the stage.
  //
  // IT COVERS THE ARRANGEMENT AND NOTHING ELSE: the roster and
  // the splits are library records, edited in place and saved immediately, so they are never
  // "unsaved". What Save writes, and therefore what can be lost, is the seating, the pins, the
  // grid, the section order and the labelling — the arrangement's own fields. NOT the colour-by
  // split: it is saved with the plan so a reload keeps it, but it is a way of looking and never
  // an unsaved change (see adoptArrangement's `keepView`).
  //
  // Compared through normaliseArrangement on both sides so that a field left absent in the stored
  // record compares equal to a working copy that has it on its default.
  const arrangementSnapshot = (a) => {
    const rec = normaliseArrangement({ ...a, id: 'x', name: 'x' });
    return JSON.stringify(ARRANGEMENT_FIELDS.map((f) => rec[f]));
  };
  const workingSnapshot = () => arrangementSnapshot(workingArrangement());
  // A REF, not a plain variable. The Save button is a computed over hasUnsavedChanges(), so the
  // baseline has to be reactive or pressing Save leaves the button still reading "Save changes"
  // until something unrelated happens to invalidate it.
  const cleanSnapshot = ref(null);
  function markClean() {
    cleanSnapshot.value = workingSnapshot();
  }
  // On startup the working copy comes off disk and may legitimately differ from the stored
  // arrangement — that IS the unsaved work the warning exists to protect. So the baseline is the
  // STORED record, and a restored working copy that differs from it reads as dirty, which is
  // the side to err on.
  function markCleanAgainstStored() {
    cleanSnapshot.value = openArrangement.value ? arrangementSnapshot(openArrangement.value) : null;
  }
  const hasUnsavedChanges = () => cleanSnapshot.value !== null && workingSnapshot() !== cleanSnapshot.value;

  /* ---------- clear all ---------- */
  // Everything: the whole library, not just the plan on screen. It goes back to the seed, as for a
  // new user.
  function clearAll() {
    previewRaw.value = [];
    library.value = seed();
    ui.view = SECTION_VIEW;
    ui.mode = 'stage';
    openConcertId.value = '';
    openArrangementId.value = '';
    openFirstConcert();
  }

  /* ---------- import / export ---------- */
  function downloadFile(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }
  // Decode a picked file without ever asking the user about encodings. Excel's "CSV UTF-8"
  // and anything from Google Sheets is UTF-8 and decodes strictly; Excel's plain "CSV
  // (Comma delimited)" on Windows is Windows-1252 with no BOM, which throws under
  // { fatal: true } and is re-decoded rather than importing silently corrupted.
  function decodeFile(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder('windows-1252').decode(buf);
    }
  }
  // The shared half of the two pickers: a detached one-shot <input type=file> that hands its
  // file back as an ArrayBuffer. Always a buffer, never text, because an .xlsx is a ZIP and
  // reading one as text produces garbage — the caller decides what the bytes are.
  function openPicker(accept, onFile) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.addEventListener('change', () => {
      const f = inp.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => onFile(rd.result, f);
      rd.readAsArrayBuffer(f);
    });
    inp.click();
  }
  // The text picker, for the JSON backup path: decoded on the way out, so its callers never
  // see bytes at all.
  function pickFile(accept, cb) {
    openPicker(accept, (buf) => cb(decodeFile(buf)));
  }
  // The spreadsheet picker. Both formats the tool accepts, and both of the ways a user might
  // have got there: `.xlsx` because that is what they actually have, `.csv` because that is
  // what Excel and Google Sheets export.
  const IMPORT_ACCEPT = '.csv,.xlsx,text/csv';
  function pickSpreadsheet(cb) {
    openPicker(IMPORT_ACCEPT, cb);
  }
  // Singers sorted as the tool lists them: by section, then by name.
  const bySectionThenName = (a, b) => {
    const sa = SECTIONS.indexOf(a.section), sb = SECTIONS.indexOf(b.section);
    return sa !== sb ? sa - sb : a.name.localeCompare(b.name);
  };
  // A roster as a spreadsheet the importer reads back: names and sections, and never a split,
  // whatever concert is open — splits belong to a concert, and the concert has its own export.
  function exportRosterCSV(rosterId = null) {
    const r = rosterId ? findAnyRoster(rosterId) : openRoster.value;
    if (!r) return;
    const rows = [['Name', 'Section']];
    r.singers.slice().sort(bySectionThenName).forEach((p) => rows.push([p.name, p.section]));
    downloadFile(exportFilename(r.name, 'roster', 'csv'), csvText(rows), 'text/csv');
  }
  // The open concert, as saved, as a spreadsheet its importer reads back: everybody singing in
  // it (guests included) with their category in each of its splits. concertSingers has already
  // resolved a missing category to the split's first, exactly as the stage reads it.
  function exportConcertCSV() {
    const c = concert.value;
    if (!c) return;
    const rows = [['Name', 'Section'].concat(c.splits.map((s) => s.name))];
    concertSingers(library.value, c)
      .sort(bySectionThenName)
      .forEach((p) => rows.push([p.name, p.section].concat(c.splits.map((s) => p[s.id]))));
    downloadFile(exportFilename(c.name, 'concert', 'csv'), csvText(rows), 'text/csv');
  }
  // The seating, as a grid that looks like the stage. Everything but the download is
  // in utils/exportCsv.js: the decomposition, the cells, the caption and the filename are pure
  // arithmetic over pure data and belong somewhere `node --test` can reach them.
  //
  // The caption names the split being coloured by, which is a view preference and so is read
  // off `ui` rather than off the plan. SECTION_VIEW is the no-split mode, drawn in section
  // colour, and the chip calls it "No split" — which would read as nonsense in a sentence
  // about what the plan is coloured by, so it is named for what it actually colours.
  function exportSeatingCSV() {
    const colourBy = ui.view === SECTION_VIEW ? 'section' : SCH_LABEL.value[ui.view] || 'section';
    const rows = seatingRows({
      // NAMES, resolved here: a CSV is a list of people, and no id ever leaves the store.
      // seatNames keeps the sentinels, so "[blocked]" still prints.
      seats: seatNames(seats.value, byId.value),
      rows: gridRows.value,
      cols: gridCols.value,
      labels,
      audienceAt: audienceAt.value,
      waiting: waitingNames.value,
      title: seatingTitle({ planName: loadedPlanName(), audienceAt: audienceAt.value, colourBy })
    });
    downloadFile(exportFilename(loadedPlanName(), 'seating', 'csv'), csvText(rows), 'text/csv');
  }
  // The blank template, offered beside the import button and again in the same breath as every
  // refusal — a user who has just been told their file is wrong is exactly the user who needs
  // the shape it should have been. CSV rather than .xlsx: writing a workbook needs a writer
  // library, which read-excel-file is not, and Excel opens a .csv on double-click anyway.
  // One per tab: the Concert tab's teaches a split column, the Roster tab's has none.
  function downloadTemplate(kind = 'concert') {
    if (kind === 'roster') downloadFile('choir-roster-template.csv', rosterTemplateCSV(), 'text/csv');
    else downloadFile('choir-concert-template.csv', templateCSV(), 'text/csv');
  }
  /* ---------- import ---------- */
  // Reading a picked spreadsheet is two steps with a user decision in between, so it is two
  // functions and not one. readSpreadsheet() turns bytes into the shared rows array, or into
  // the sentence explaining why it cannot; the column picker then runs over those rows; and
  // importAsConcert() commits what the user ticked. Nothing is mutated until that second step, so
  // every refusal on the way leaves the existing roster, splits and seating exactly as they
  // were. Both formats converge on the one rows array, so the picker is not a second parser
  // and the two paths cannot drift apart.
  //
  // read-excel-file is imported DYNAMICALLY and from its `/browser` subpath. Dynamic so its
  // chunk (measured at 51 KB raw, 15.9 KB gzipped) is fetched only when somebody actually
  // picks a workbook, and never by a visitor who just looks at the stage. Keep it dynamic: a
  // static import here would fold the whole of it into the choir bundle, which is most of the
  // reason this library was chosen over SheetJS in the first place.
  // `/browser` because v9 publishes no root export at all (its
  // `exports` map has only ./universal, ./browser, ./node and ./web-worker), and because the
  // node entry would drag graceful-fs and node-int64 into a bundle that has no business
  // holding them.
  async function readSpreadsheet(buffer) {
    const kind = sniffFormat(buffer);
    if (kind === 'ole2')
      return {
        ok: false,
        error: 'This is an older Excel file (.xls). Open it in Excel, re-save it as .xlsx or CSV, and try again.'
      };
    if (kind === 'zip') {
      try {
        // `readSheet`, NOT the default export: v9's default export returns every sheet as
        // `[{ sheet, data }]`, which normaliseRows quietly flattens to nothing and reports as
        // an empty file. readSheet is the one that hands back rows.
        const { readSheet } = await import('read-excel-file/browser');
        // The FIRST sheet, always (Jordan, 2026-09-02), which is readSheet's
        // default. A sheet picker is a dialog for a case the template makes rare, and
        // headerProblem() names the rule in the failure message, so a user with their singers
        // on sheet 2 is told why it did not work.
        const rows = await readSheet(buffer);
        return describeRows(normaliseRows(rows));
      } catch {
        // An .ods, or a ZIP that is not a workbook at all. read-excel-file throws a handful of
        // different errors here and none of them is worth showing: the user's problem, and
        // their fix, is the same in every case.
        return {
          ok: false,
          error: 'That file is not a spreadsheet this tool can read. Save it as .xlsx or CSV from your spreadsheet program and try again.'
        };
      }
    }
    return describeRows(normaliseRows(parseCSV(decodeFile(buffer))));
  }
  // Everything the picker needs about a rows array, decided in one place so the CSV and the
  // .xlsx routes cannot describe the same file differently: the header check, the column
  // classification, and how many singers the file appears to hold.
  function describeRows(rows) {
    const problem = headerProblem(rows);
    if (problem) return { ok: false, error: problem };
    return {
      ok: true,
      rows,
      columns: classifyColumns(rows),
      found: rows.slice(1).filter((r) => (r[0] || '') !== '').length
    };
  }
  // Commit the rows as a NEW concert, using the split columns the user ticked, and open it. An
  // import never writes into an existing concert; what it replaces is only the plan on stage,
  // and the picker has already warned if that held unsaved work. Returns a result — never an
  // alert — so the overlay can report the outcome, success included.
  // `names` is `{ roster, concert }`: the file becomes a new roster, and a new concert over it
  // that carries the splits.
  function importAsConcert(rows, pickedIndexes, names) {
    const rosterName = String((names && names.roster) || '').trim();
    const concertName = String((names && names.concert) || '').trim();
    if (!rosterName) return { ok: false, error: 'Enter a name for the roster.' };
    const nameProblem = concertNameProblem(concertName);
    if (nameProblem) return { ok: false, error: nameProblem };
    const built = buildImport(rows, pickedIndexes);
    if (!built.ok) return built;
    // Measured BEFORE anything is mutated, so an over-limit file aborts cleanly with no
    // partial import and nothing to undo.
    const problem = limitProblem(built.roster, built.splits);
    if (problem)
      return { ok: false, error: problem + ' Nothing has been changed.', skipped: built.skipped, unknownSections: built.unknownSections };
    // A fresh id off the counter for every singer and every split the import creates. A
    // spreadsheet has no ids in it, so there is nothing to preserve; buildImport keys the splits
    // by their column heading, which is swapped here for a minted id so a heading can never
    // meet an id the counter hands out later.
    const splitIds = built.splits.map(() => newSplitId());
    const theSplits = built.splits.map((sp, i) => ({ ...sp, id: splitIds[i] }));
    const keyed = built.roster.map((row) => {
      const out = { id: mint(ID.singer), name: row.name, section: row.section };
      built.splits.forEach((sp, i) => (out[splitIds[i]] = row[sp.id]));
      return out;
    });
    const made = importPlan(library.value, { roster: rosterName, concert: concertName }, { roster: keyed, splits: theSplits }, 'Plan 1');
    openConcertId.value = made.concertId;
    openArrangementId.value = made.arrangementId;
    ui.view = SECTION_VIEW;
    pinnedIds.value = [];
    // The import has a roster but no seating, so solve one and save it straight into the new
    // arrangement: a concert that opened to an empty stage would look like a failed import.
    freshSeats();
    saveArrangement();
    return {
      ok: true,
      roster: rosterName,
      concert: concertName,
      imported: built.roster.length,
      splitCount: built.splits.length,
      skipped: built.skipped,
      unknownSections: built.unknownSections
    };
  }
  // The Roster tab's import: names and sections only, and any other column ignored. A new roster
  // of its own, which is committed straight away; nothing else changes, so nothing is at risk.
  function importAsRoster(rows, name) {
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Enter a name for the roster.' };
    const built = buildImport(rows, []);
    if (!built.ok) return built;
    const problem = limitProblem(built.roster, []);
    if (problem) return { ok: false, error: problem + ' Nothing has been changed.', skipped: built.skipped, unknownSections: built.unknownSections };
    const r = addRoster(name, built.roster.map((row) => ({ id: mint(ID.singer), name: row.name, section: row.section })));
    return { ok: true, rosterId: r.id, roster: name, imported: r.singers.length, skipped: built.skipped, unknownSections: built.unknownSections };
  }
  // ...or the file as a replacement for one of the user's rosters, matched by name so everybody
  // it still names keeps their id and so their chairs, categories and pins. NOTHING is committed:
  // the singers come back for the Roster tab to load as its unsaved draft, so the user sees the
  // result and Save asks before anybody leaves a concert.
  function rosterReplacement(rows, rosterId) {
    const r = findRoster(library.value, rosterId);
    if (!r) return { ok: false, error: "That roster can't be replaced." };
    const built = buildImport(rows, []);
    if (!built.ok) return built;
    const problem = limitProblem(built.roster, []);
    if (problem) return { ok: false, error: problem + ' Nothing has been changed.', skipped: built.skipped, unknownSections: built.unknownSections };
    return { ok: true, rosterId: r.id, roster: r.name, ...matchRosterByName(r.singers, built.roster, () => mint(ID.singer)), skipped: built.skipped, unknownSections: built.unknownSections };
  }
  // A TOTAL backup: every key in LS, so a restore on a new device reproduces the whole tool and
  // not merely the plan on screen. That is the LIBRARY — every roster, every
  // concert, every arrangement — plus what was open, the working copy of it, and the one true
  // global left. If you ever add a persisted key, it belongs here as well.
  function backupJSON() {
    const snap = {
      schema: SCHEMA,
      library: library.value,
      open: { concertId: openConcertId.value, arrangementId: openArrangementId.value },
      // The very things save() writes, so "total" is a property of one set of functions rather
      // than of two lists agreeing — `selectedPresetId` was missing here once for exactly that
      // reason, before the lists were derived.
      working: workingArrangement(),
      palettes: palettes.value,
      prefs: prefsBlob()
    };
    downloadFile(exportFilename(loadedPlanName(), 'backup', 'json'), JSON.stringify(snap, null, 2), 'application/json');
  }
  // Returns { ok, error } rather than alerting, for the same reason importCSV became
  // importAsConcert: every message in the io panel is now reported in the page, where it can be
  // read, scrolled and copied, instead of in browser chrome.
  //
  // A restore REPLACES the library (the confirm in RosterDialog warns before we get here).
  // Individual records are held to the same standard normaliseLibrary applies everywhere else,
  // and a bad one is dropped, never fatal.
  function restoreJSON(text) {
    let snap;
    try {
      snap = JSON.parse(text);
    } catch {
      return { ok: false, error: "That file isn't valid JSON, so it is not a backup this tool wrote." };
    }
    const versionProblem = backupVersionProblem(snap);
    if (versionProblem) return { ok: false, error: versionProblem };
    // An older version's backup, carried forward as its stored work would be.
    snap = migrateSnapshot(snap);
    const library_ = snap && normaliseLibrary(snap.library);
    if (!library_ || !library_.concerts.length)
      return { ok: false, error: 'That backup has nothing in it this tool can read. Nothing has been changed.' };
    // Measured before anything is mutated, so an over-limit file aborts cleanly. A concert that
    // is over the solver-blowup limits is dropped rather than taking the file with it.
    snap.library = {
      seq: library_.seq,
      rosters: library_.rosters,
      concerts: library_.concerts.filter((c) => !limitProblem(concertSingerIds(c), c.splits))
    };
    if (!snap.library.concerts.length)
      return { ok: false, error: limitProblem(concertSingerIds(library_.concerts[0]), library_.concerts[0].splits) + ' Nothing has been changed.' };
    // Past this point nothing *rejects* the file. That is not the same as "cannot fail": the
    // localStorage write on the next debounced save() can still hit the origin quota, and it
    // swallows that exception. Nothing here can honestly promise atomicity.
    adoptSnapshot(snap);
    const singers = snap.library.rosters.reduce((n, r) => n + r.singers.length, 0);
    return { ok: true, imported: singers, concerts: snap.library.concerts.length };
  }

  /* ---------- drag/drop + pins ---------- */
  // swap two seats by their grid index. Section rides along with each singer, so a swap can
  // never move anyone into another section.
  function swap(i, j) {
    if (i === j) return;
    const a = seats.value;
    if (i < 0 || j < 0 || i >= a.length || j >= a.length) return;
    const next = a.slice();
    [next[i], next[j]] = [next[j], next[i]];
    seats.value = next;
  }
  function togglePin(id) {
    if (!isSinger(id)) return;
    const set = new Set(pinnedIds.value);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    pinnedIds.value = [...set];
  }

  /* ---------- placement (grid ↔ bench) ---------- */
  // Place the singer `id` into cell `idx`. If they were already seated, the move swaps the two
  // cells (whatever was at `idx` — a singer or EMPTY — goes to the old seat). If they came from
  // the bench and `idx` held someone, that someone is bumped back to the bench. Blocked targets
  // are refused. Cell count never changes, so the grid stays a clean rectangle.
  function placeAt(id, idx) {
    const a = seats.value;
    if (!isSinger(id) || !byId.value[id]) return;
    if (idx < 0 || idx >= a.length || isBlocked(a[idx])) return;
    const next = a.slice();
    const from = next.indexOf(id);
    const occupant = next[idx];
    next[idx] = id;
    if (from >= 0) next[from] = occupant; // seated → seated: swap (occupant may be EMPTY)
    // from < 0 (came off the bench): occupant, if a singer, is simply no longer seated → bench.
    seats.value = next;
  }
  // Remove a singer from the grid back to the bench (their seat becomes EMPTY).
  function unseat(id) {
    const a = seats.value;
    const i = a.indexOf(id);
    if (i < 0) return;
    const next = a.slice();
    next[i] = EMPTY;
    seats.value = next;
  }
  // Open a gap at cell `idx`: the cell becomes EMPTY and the rest of that row, from here to the
  // right, shifts one seat over. Blocked seats never move — the shift jumps over them. If the
  // row's last movable seat was a singer (no empty chair to absorb the shift), they're pushed
  // off to the bench. The grid size is unchanged.
  function insertRowSpace(idx) {
    const rows = gridRows.value, cols = gridCols.value;
    if (idx < 0 || idx >= rows * cols || isBlocked(seats.value[idx])) return;
    const r = idx % rows, c0 = Math.floor(idx / rows);
    const next = seats.value.slice();
    const cells = []; // movable (non-blocked) cell indices in this row at columns >= c0
    for (let c = c0; c < cols; c++) {
      const i = c * rows + r;
      if (!isBlocked(next[i])) cells.push(i);
    }
    for (let k = cells.length - 1; k > 0; k--) next[cells[k]] = next[cells[k - 1]];
    next[cells[0]] = EMPTY;
    seats.value = next;
  }
  // Drop the Block tool on a seat to wall it off. An already-empty cell is simply converted to
  // BLOCKED in place (nobody to move). Over a singer it behaves like insertRowSpace: the rest of
  // that row shifts one seat to the right (blocked seats are jumped over; the row's last movable
  // singer goes to the bench if there's no empty chair to absorb the shift). No-op if `idx` is
  // already blocked.
  function insertRowBlock(idx) {
    const rows = gridRows.value, cols = gridCols.value;
    if (idx < 0 || idx >= rows * cols || isBlocked(seats.value[idx])) return;
    if (seats.value[idx] === EMPTY) {
      const next = seats.value.slice();
      next[idx] = BLOCKED;
      seats.value = next;
      return;
    }
    const r = idx % rows, c0 = Math.floor(idx / rows);
    const next = seats.value.slice();
    const cells = []; // movable (non-blocked) cell indices in this row at columns >= c0
    for (let c = c0; c < cols; c++) {
      const i = c * rows + r;
      if (!isBlocked(next[i])) cells.push(i);
    }
    for (let k = cells.length - 1; k > 0; k--) next[cells[k]] = next[cells[k - 1]];
    next[cells[0]] = BLOCKED;
    seats.value = next;
  }
  // Close the empty gap at cell `idx`: the rest of that row, from here to the right, shifts one
  // seat to the LEFT to fill it (blocked seats stay put, the shift jumps over them) and the row's
  // last movable seat becomes EMPTY. The inverse of insertRowSpace. No-op unless `idx` is EMPTY.
  function removeRowSpace(idx) {
    const rows = gridRows.value, cols = gridCols.value;
    if (idx < 0 || idx >= rows * cols || seats.value[idx] !== EMPTY) return;
    const r = idx % rows, c0 = Math.floor(idx / rows);
    const next = seats.value.slice();
    const cells = [];
    for (let c = c0; c < cols; c++) {
      const i = c * rows + r;
      if (!isBlocked(next[i])) cells.push(i);
    }
    for (let k = 0; k < cells.length - 1; k++) next[cells[k]] = next[cells[k + 1]];
    next[cells[cells.length - 1]] = EMPTY;
    seats.value = next;
  }
  // Remove a blocked seat at cell `idx`: unblock it and close the gap, the rest of that row
  // shifting one seat to the LEFT (the inverse of dropping Block on a singer). No-op unless `idx`
  // is blocked. Equivalent to unblocking then removeRowSpace, in one step.
  function removeRowBlock(idx) {
    const rows = gridRows.value, cols = gridCols.value;
    if (idx < 0 || idx >= rows * cols || !isBlocked(seats.value[idx])) return;
    const r = idx % rows, c0 = Math.floor(idx / rows);
    const next = seats.value.slice();
    next[idx] = EMPTY; // unblock first, so it becomes the movable gap to close
    const cells = [];
    for (let c = c0; c < cols; c++) {
      const i = c * rows + r;
      if (!isBlocked(next[i])) cells.push(i);
    }
    for (let k = 0; k < cells.length - 1; k++) next[cells[k]] = next[cells[k + 1]];
    next[cells[cells.length - 1]] = EMPTY;
    seats.value = next;
  }

  /* ---------- grid size ---------- */
  // Resize the fixed grid to rows×cols. Singers keep their (row, col): a cell still inside the
  // new bounds is carried over to its new column-major index; a cell that falls outside sends
  // its singer to the bench (blocked seats outside are just dropped). New cells are EMPTY.
  function resizeGrid(rows, cols) {
    rows = clampRows(rows);
    cols = clampCols(cols);
    if (rows === gridRows.value && cols === gridCols.value) return;
    const oldRows = gridRows.value, old = seats.value;
    const next = new Array(rows * cols).fill(EMPTY);
    let evicted = 0;
    old.forEach((n, idx) => {
      const r = idx % oldRows, c = Math.floor(idx / oldRows);
      if (r < rows && c < cols) next[c * rows + r] = n;
      else if (isSinger(n)) evicted++;
    });
    gridRows.value = rows;
    gridCols.value = cols;
    seats.value = next;
    // The per-row walk-on settings follow the rows that still exist, so none is kept that the
    // walk-on panel cannot show. The aisle is clamped, and said so, because an aisle off the
    // right-hand edge puts the entire choir in one queue and this gets printed.
    walkOn.perRow = walkOn.perRow.slice(0, rows);
    while (walkOn.perRow.length && walkOn.perRow[walkOn.perRow.length - 1] == null) walkOn.perRow.pop();
    if (walkOn.rowSeq) {
      const kept = walkOn.rowSeq.filter((r) => r < rows);
      walkOn.rowSeq = kept.length ? kept : null;
    }
    const notes = [];
    if (evicted) notes.push(`${evicted} singer${evicted === 1 ? '' : 's'} moved to the bench`);
    if (walkOn.splitCol != null && walkOn.splitCol > Math.max(0, cols - 2)) {
      walkOn.splitCol = Math.max(0, cols - 2);
      notes.push(`the walk-on aisle moved to column ${colLabelAt(walkOn.splitCol, cols, labels, audienceAt.value)}`);
    }
    if (notes.length) showToast(`Grid shrunk — ${notes.join(', and ')}`);
  }
  const setGridRows = (rows) => resizeGrid(rows, gridCols.value);
  const setGridCols = (cols) => resizeGrid(gridRows.value, cols);
  // Re-pack every seated singer toward the front-left, preserving their reading order and
  // leaving blocked seats exactly where they are. This is the on-demand "flow everyone around"
  // that the old auto-derived grid did for free.
  function compact() {
    const before = snapSeats();
    const a = seats.value.slice();
    const singers = a.filter(isSinger);
    let k = 0;
    for (let i = 0; i < a.length; i++) {
      if (isBlocked(a[i])) continue;
      a[i] = k < singers.length ? singers[k++] : EMPTY;
    }
    seats.value = a;
    moversToast('Compacted', countSeatChanges(before));
  }

  /* ---------- section order ---------- */
  // move a section one place left (dir -1) or right (dir +1) in the stage order.
  function moveSection(sec, dir) {
    const arr = sectionOrder.value.slice();
    const i = arr.indexOf(sec), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    sectionOrder.value = arr;
  }

  /* ---------- seat labelling ---------- */
  // Set one of the four labelling fields. Guarded so a stray value can never reach the saved
  // plan; the controls only ever offer legal ones. Since 2026-09-11 this is only ever the user's
  // own edit: the viewpoint no longer writes `rowFirst` and `colOrder` behind their back.
  function setLabel(field, value) {
    if (!Object.prototype.hasOwnProperty.call(LABEL_OPTIONS, field)) return;
    if (!LABEL_OPTIONS[field].includes(value)) return;
    labels[field] = value;
  }
  // THE seat name, for every consumer. The stage, the seating spreadsheet, the printed plan and
  // the walk-on list call this rather than formatting a label of their own. `i` is an
  // index into the column-major `seats` array, so a caller passes the seat's real index and
  // never a display position. The viewpoint goes in because the COLUMN half of a name is
  // measured on the drawing: see rule 2 in utils/labels.js.
  function seatLabel(i) {
    return seatLabelFor(i, gridRows.value, gridCols.value, labels, audienceAt.value);
  }

  /* ---------- walk-on order ---------- */
  // The live list, the live preview, and the order they both come from, in one computed so the
  // three can never disagree. Everything downstream consumes this: the on-screen list, the Copy
  // action, and the printed sheet.
  //
  // It is DERIVED, always. The cost is that a wrong order is fixed by changing a rule rather
  // than by dragging a name, and the generic plus per-row rules are expressive enough for both
  // of the cases the request named.
  //
  // A second reason used to be given — that the data model had no identity for a person that
  // survived both Auto-arrange and resizeGrid — and SINGER IDS HAVE REMOVED IT: `id` is exactly
  // that identity. The decision stands as it is, because the first reason was the one that
  // carried it and a per-person order is a new stored field with its own schema step. But it is
  // no longer impossible, so it is a live option rather than a closed one. Do not
  // repeat the old reasoning as if it were still true.
  const walkOnPlan = computed(() =>
    walkOnFor(seats.value, gridRows.value, gridCols.value, walkOn, labels, audienceAt.value, byId.value)
  );
  // The badge map, keyed by seat index, for the Walk-on order tab's stage. It is the fourth
  // consumer of one generator, and null on the Arrange tab, which draws no seat numbers.
  const walkOnBadgeMap = computed(() => (ui.tab === 'walkon' ? walkOnPlan.value.badges : null));
  // The one-click aisle suggestion: the columns the user has genuinely blocked front to back.
  // A convenience on top of a manual field, never the source of truth for it.
  const walkOnAisles = computed(() => blockedColumns(seats.value, gridRows.value, gridCols.value));
  // The clipboard text: clean plain text that has to survive a paste into Word or an email.
  const walkOnCopyText = () =>
    walkOnText(walkOnPlan.value.list, waitingNames.value, loadedPlanName());
  // The same list as its own CSV download, a flat table rather than the grouped text.
  function exportWalkOnCSV() {
    const rows = walkOnRows(walkOnPlan.value.list, waitingNames.value, loadedPlanName());
    downloadFile(exportFilename(loadedPlanName(), 'walk-on', 'csv'), csvText(rows), 'text/csv');
  }
  // Set one general field. Guarded so a stray value can never reach the saved plan, exactly as
  // setLabel is.
  function setWalkOn(field, value) {
    if (field === 'splitCol') {
      walkOn.splitCol = value == null ? null : Math.max(0, Math.min(gridCols.value - 2, Math.round(value) || 0));
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(WALKON_OPTIONS, field)) return;
    if (!WALKON_OPTIONS[field].includes(value)) return;
    walkOn[field] = value;
    // Choosing which row goes first replaces a custom row order.
    if (field === 'rowFrom') walkOn.rowSeq = null;
    // A row set to what is now the general direction no longer differs from it.
    if (field === 'enterFrom') setPerRow(walkOn.perRow.map((v) => (v === value ? null : v)));
  }
  function setPerRow(a) {
    const next = a.slice();
    while (next.length && next[next.length - 1] == null) next.pop();
    walkOn.perRow = next;
  }
  // One row's direction. `r` is the INTERNAL row index, front-first. Choosing the general
  // direction stores no override, so the row goes on following it.
  function setWalkOnRow(r, value) {
    if (!Number.isInteger(r) || r < 0 || r >= gridRows.value) return;
    if (value != null && !WALKON_OPTIONS.enterFrom.includes(value)) return;
    const a = walkOn.perRow.slice();
    while (a.length <= r) a.push(null);
    a[r] = value === walkOn.enterFrom ? null : value;
    setPerRow(a);
  }
  // The rows in the order they are walked, and a row moved one place earlier (-1) or later (+1).
  // An order that matches "First row on" again is stored as no custom order.
  const walkOnRowOrder = computed(() => walkRowSequence(walkOn, gridRows.value));
  function moveWalkOnRow(r, dir) {
    const seq = walkOnRowOrder.value.slice();
    const i = seq.indexOf(r), j = i + dir;
    if (i < 0 || j < 0 || j >= seq.length) return;
    [seq[i], seq[j]] = [seq[j], seq[i]];
    const base = walkRowSequence({ ...walkOn, rowSeq: null }, gridRows.value);
    walkOn.rowSeq = seq.every((x, k) => x === base[k]) ? null : seq;
  }
  // Back to the general settings: no per-row directions and no custom row order.
  function resetWalkOnRows() {
    walkOn.perRow = [];
    walkOn.rowSeq = null;
  }
  const walkOnCustomised = computed(() => walkOn.perRow.some((v) => v != null) || walkOn.rowSeq != null);
  // what save() and backupJSON() write: a plain, detached copy of the reactive block.
  const snapWalkOn = () => ({ ...walkOn, perRow: walkOn.perRow.slice(), rowSeq: walkOn.rowSeq ? walkOn.rowSeq.slice() : null });

  /* ---------- viewpoint ---------- */
  // Move the audience to the other side of the plan, which rotates the drawing 180 degrees. The
  // rotation is at render time only (StageView.vue): `seats` is never written back reversed, so
  // changing a display setting can never cost the user the arrangement they built.
  //
  // It writes NOTHING ELSE. Until 2026-09-11 it also flipped `rowFirst` and `colOrder` to their
  // opposites, on the reasoning that rotating the stage reverses the labelling. Jordan reversed
  // that: *"the seat labels should not be coupled"*. Two reasons it had to go:
  //   - it overwrote a setting the user had deliberately chosen, every time they looked at the
  //     plan from the other side;
  //   - it was only needed because "left to right" used to mean stage-left. It no longer does.
  //     `colOrder` is measured on the DRAWING (utils/labels.js rule 2), so left to right stays
  //     left to right without anything being rewritten.
  // The no-op guard stays: it is now merely cheap rather than load-bearing.
  function setAudienceAt(v) {
    if (!validAudienceAt(v) || v === audienceAt.value) return;
    audienceAt.value = v;
  }

  /* ---------- colour schemes ---------- */
  function selectScheme(id) {
    if (palettes.value.schemes.some((s) => s.id === id)) palettes.value.active = id;
  }
  // A new scheme, made active. `from` is the `{ colours, splitColours }` pair to start it on
  // ("Save as…"); without it the scheme starts on the app's defaults.
  function addScheme(name, from = null) {
    const made = makeScheme(palettes.value, name, from);
    palettes.value.schemes.push(made);
    palettes.value.active = made.id;
    return made;
  }
  // The Colours panel edits a draft of the pair (utils/palettes.js) and saves it whole here.
  function saveSchemeColours(id, pair) {
    const s = palettes.value.schemes.find((x) => x.id === id);
    if (!s) return;
    s.colours = normaliseColours(pair.colours);
    s.splitColours = normaliseSplitColours(pair.splitColours);
  }
  function renameScheme(id, name) {
    const s = palettes.value.schemes.find((x) => x.id === id);
    if (s && name && name.trim()) s.name = name.trim();
  }
  // There is always one scheme to paint with, so the last cannot go.
  function deleteScheme(id) {
    const p = palettes.value;
    if (p.schemes.length < 2) return false;
    p.schemes = p.schemes.filter((s) => s.id !== id);
    if (!p.schemes.some((s) => s.id === p.active)) p.active = p.schemes[0].id;
    return true;
  }
  function schemeNameProblem(name, exceptId = null) {
    name = String(name || '').trim();
    if (!name) return 'Enter a name.';
    if (palettes.value.schemes.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === name.toLowerCase()))
      return `You already have a colour scheme named "${name}".`;
    return null;
  }

  /* ---------- busy overlay + toast ---------- */
  const BUSY_WEIGHT_MIN = 16;
  function runBusySteps(text, steps, done, weight = Infinity) {
    const finish = () => {
      try {
        steps.forEach((s) => s());
        if (done) done();
      } finally {
        busy.open = false;
      }
    };
    if (weight < BUSY_WEIGHT_MIN) {
      steps.forEach((s) => s());
      if (done) done();
      return;
    }
    busy.text = text || 'Working…';
    busy.open = true;
    requestAnimationFrame(() => requestAnimationFrame(finish));
  }
  let toastTimer = null;
  function showToast(msg, nochange) {
    toast.text = msg;
    toast.nochange = !!nochange;
    toast.show = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.show = false), 2600);
  }
  function snapSeats() {
    return seats.value.slice();
  }
  function countSeatChanges(before) {
    const b = seats.value, n = Math.max(before.length, b.length);
    let moved = 0;
    for (let i = 0; i < n; i++) if (before[i] !== b[i]) moved++;
    return moved;
  }
  function moversToast(prefix, moved) {
    if (moved) showToast(`${prefix} — ${moved} singer${moved === 1 ? '' : 's'} moved`);
    else showToast(`${prefix} — already arranged, no changes`, true);
  }

  /* ---------- arrange actions ---------- */
  function autoArrange() {
    const before = snapSeats();
    let overflow = 0;
    runBusySteps(
      'Arranging the choir…',
      [() => {
        const res = engine().arrangeAll(gridRows.value, gridCols.value, waiting.value);
        seats.value = res.seats;
        overflow = res.overflow.length;
      }],
      () => {
        if (overflow) showToast(`Arranged — ${overflow} singer${overflow === 1 ? '' : 's'} won't fit, left on the bench`);
        else moversToast('Arranged', countSeatChanges(before));
      },
      data.value.length
    );
  }
  function autoSeat(sec) {
    const before = snapSeats();
    runBusySteps(
      'Seating ' + sec + '…',
      [() => { seats.value = engine().arrangeSection(gridRows.value, sec); }],
      () => moversToast(sec, countSeatChanges(before)),
      data.value.length
    );
  }

  /* ---------- init ---------- */
  let started = false;
  function init() {
    if (started) return;
    started = true;
    loadFromStorage();
  }

  // persist on any state change (deep), debounced. Registered in a DETACHED effect
  // scope so it is not torn down when the component that first created the store
  // unmounts (the store is a singleton that must keep saving across navigation).
  let saveTimer = null, libraryDirty = false;
  const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const all = libraryDirty;
      libraryDirty = false;
      save(all);
    }, 150);
  };
  const scope = effectScope(true);
  scope.run(() => {
    // Two watchers, so a stage edit never walks the whole library: the deep one over the library
    // only runs when the library itself changes. `ui.report` and `ui.walkOn` are never saved, so neither is watched.
    watch([library, palettes], () => {
      libraryDirty = true;
      queueSave();
    }, { deep: true });
    watch(
      [openConcertId, openArrangementId, pinnedIds, () => ui.view, () => ui.mode, () => ({ ...labels }), audienceAt, walkOn, gridRows, gridCols, sectionOrder, seats],
      queueSave,
      { deep: true }
    );
  });

  return {
    // state
    splits, data, seats, gridRows, gridCols, pinnedIds, ui, labels, audienceAt, colours, splitColours, palettes, walkOn, sectionOrder, rosterOpen, setupScreen, dragOverGi, dragOverBench,
    library, openConcertId, openArrangementId, concert, openRoster, openArrangement,
    busy, toast, storedIsNewer, discardStoredWork,
    // derived
    SCH, SCH_LABEL, SPLIT_OPTIONS, CAT_INDEX, byId, pinnedSet, stageView, stageStranded, stageLateral, neighbourSummary, placedSet, waiting, waitingNames, capacity,
    walkOnPlan, walkOnAisles, walkOnBadgeMap, walkOnRowOrder, walkOnCustomised, livePlan,
    // helpers
    engine, slugify, uniqueCat, newSplitId, mint, ID,
    concertOptions, openConcertName, openArrangementName, concertNameProblem,
    rosterSingers, rosterOptions, openRosterName, concertsUsingRoster,
    previews, previewChoices, previewChoiceGroups, referenceOptions, previewKey, concertPlans,
    // actions
    init, save, rebuildFromRoster, reconcileSeats, freshSeats,
    applyRosterEdit, commitRoster, commitConcert, moveGuestToChoir, renameRoster, addRoster, deleteRoster, changeConcertRoster,
    staleForOpen, dropStale, addPreview, removePreview, clearPreviews,
    openArrangementById, saveArrangement, saveConcertAs, openFirstConcert,
    addConcert, renameConcert, deleteConcert, addArrangement, renameArrangement, deleteArrangement,
    markClean, hasUnsavedChanges, clearAll, LIMITS,
    exportRosterCSV, exportConcertCSV, exportSeatingCSV, exportConcertSeatingCSV, downloadTemplate, readSpreadsheet, importAsConcert, importAsRoster, rosterReplacement, backupJSON, restoreJSON, pickFile, pickSpreadsheet,
    swap, togglePin, placeAt, unseat, insertRowBlock, removeRowBlock, insertRowSpace, removeRowSpace,
    resizeGrid, setGridRows, setGridCols, compact,
    moveSection, setLabel, seatLabel, setAudienceAt, autoArrange, autoSeat, showToast, moversToast,
    sectionColours, splitFrames,
    selectScheme, addScheme, saveSchemeColours, renameScheme, deleteScheme, schemeNameProblem,
    setWalkOn, setWalkOnRow, moveWalkOnRow, resetWalkOnRows, walkOnCopyText, exportWalkOnCSV
  };
}

export function useChoirArranger() {
  if (!store) store = createStore();
  return store;
}
