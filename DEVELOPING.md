# Choir Seating Tool — developer guide

Choir Seating Tool seats a choir on a fixed grid of chairs so that every singer has a neighbour
(beside, in front or behind) from each group they belong to, across several ways of dividing the
choir at once. It runs entirely in the browser. There is no server, and everything is saved to
`localStorage`. It is a Vue 3 app built by Vite into static files, with a service worker so that
it installs and works offline.

This file maps the code: what each file does, how data moves between them, and which rules are
easy to break by accident. It describes the code as it stands, not how it got here.

---

## Contents

1. [Where it lives](#where-it-lives)
2. [The layers](#the-layers)
3. [The data model](#the-data-model)
4. [The store (`useChoirArranger.js`)](#the-store)
5. [Persistence, backup and restore](#persistence-backup-and-restore)
6. [The solver](#the-solver)
7. [Drawing a plan](#drawing-a-plan)
8. [Drag and drop](#drag-and-drop)
9. [Seat labels and the viewpoint](#seat-labels-and-the-viewpoint)
10. [Colours](#colours)
11. [Walk-on order](#walk-on-order)
12. [Printing](#printing)
13. [Import and export](#import-and-export)
14. [Previews (comparing plans)](#previews-comparing-plans)
15. [The Choir setup dialog](#the-choir-setup-dialog)
16. [Rules not to break](#rules-not-to-break)
17. [Recipes](#recipes)
18. [The shell, the manual and the service worker](#the-shell-the-manual-and-the-service-worker)
19. [Tests and tools](#tests-and-tools)

---

## Where it lives

```
index.html             the static <head> (title, description, icons); mounts #app
src/
  main.js              createApp(App), and the service worker's registration
  App.vue              the page shell: top bar (Install app, the "new version" notice), dark
                       canvas, footer, and the page-shell half of the print CSS
  base.css             the global CSS the components are written against: a reset and the
                       page's defaults (see The shell, the manual and the service worker)
  components/          Vue SFCs (below)
  composables/
    useChoirArranger.js   THE store: a module-level singleton holding all state and actions
    usePlanView.js        makePlanView(): the store's derived values for a plan that isn't live
    useDragDrop.js        usePress(): one Pointer Events drag system for mouse, touch and pen
  utils/               pure modules: no Vue, no DOM, no localStorage (so `node --test` loads them)
    arranger.js           constants, sentinels, singer ids, the example data, colour maths,
                          grid helpers, the walk-on ORDER generator, and the solver (makeEngine)
    library.js            the roster / concert / arrangement model: normalise, join, mint ids
    plan.js               PLAN_FIELDS: the one list of what a "plan" is, and buildPlan()/planOf()
    planFields.js         validators and clamps for individual plan fields (rows, cols, …)
    persistence.js        localStorage keys, SCHEMA, readSnapshot(), backup version check
    palettes.js           named colour schemes (global, not per plan)
    labels.js             THE seat-naming function: seatLabelFor(), rowLabelAt(), colLabelAt()
    stageLayout.js        geometry of a drawn stage: rotation, section bands, heading strips, crops
    seatPreview.js        layout of the mini plan in Settings (LabelPreview.vue)
    walkOnList.js         presentation of the walk-on order: groups, badges, text, CSV rows
    printPlan.js          print arithmetic: pages, cell sizes, name fitting, short names, titles
    exportCsv.js          the seating CSV grid, concert pack CSV, filenames, slugify()
    spreadsheet.js        CSV writing/parsing, format sniffing, the import column picker, buildImport()

manual/                the user manual: one Markdown page per part of the app, the screenshots
                       they show (all taken by tools/manual-shots.mjs), and the page template
                       and stylesheet tools/vite-manual.mjs renders them with
test/                  the tests for utils/ (`npm test`), and their fixtures
tools/                 node scripts, not tests and not bundled: store-smoke, lateral-check,
                       manual-shots, icons, and the Vite plugins for the manual and the
                       third-party notices (see Tests and tools)
public/                the icons: two SVG sources and the PNGs tools/icons.mjs draws from them
src-tauri/             the desktop app: a Rust shell that shows the build in a window of its own
                       (see The desktop app)
.github/workflows/     ci.yml (every push) and release.yml (a version tag)

README.md              for people who use or host the app
CLAUDE.md              short working notes for Claude Code: commands, checks and the release
DEVELOPING.md          this file
```

### Components

| Component | Role | Reads the store? |
|---|---|---|
| `ChoirArranger.vue` | Top-level shell: one `.workspace` surface whose regions sit under each other with a rule between them. Header (title, `PlanBar`, Choir setup, Settings, help), tab strip (Arrange | Walk-on order, with Print and Download spreadsheet), and on the Arrange tab the tool strip (grid size, Block/Space tools, Auto-arrange, Compact, section order), the view line (View, Colour by split, Seat labels), the stage, the bench and the neighbour check fold; on the Walk-on order tab, `WalkOnPanel`. Its unscoped style block holds the main window's shared controls (see below). Also the Getting started dialog (which links to the manual), the busy overlay, the toast, the tooltip layer, and the hidden print root. Owns print state and the `beforeprint`/`afterprint` handling. Calls `store.init()` on mount. | yes |
| `PlanBar.vue` | The plan, in the header: the concert's name, the picker for its arrangements, Save changes, a More menu (Duplicate, Rename, Delete), and Compare, which adds or removes previews. Asks the unsaved-changes and stale-singers questions before switching. | yes |
| `StageView.vue` | Full-stage view of the live plan: section bands, row and column headings, the grid, the AUDIENCE bar, and under them the section key. | yes |
| `SectionBlock.vue` | One section in "By section" mode: the section's bounding-box crop, a status line, Auto-seat, and the same section cropped from each preview beside it. | yes |
| `SeatGrid.vue` | Draws cells. It is the one renderer, used for the live stage, crops, previews and print. Takes an optional `plan` prop (the live store by default) and a `readonly` flag. Owns the per-cell menu (Lock, Remove). | defaults to the store |
| `WaitingArea.vue` | The bench: roster members with no seat, shown as draggable chips. | yes |
| `NeighbourReport.vue` | Table of section × split with a chip per finding: ✓ (fine), alone, split (a broken group), ↕ (laterally isolated), and a key under it. On the live report, hovering or keyboard-focusing a chip sets `ui.highlight` to its singers, which the stage rings, and clicking one pins it there (`ui.marked`) until it is clicked again, unpinned from `MarkedPill`, or the finding goes away. A ↕ chip also rings each singer's group-mates in front or behind. Accepts a `plan` prop so the printed sheet can show a non-live plan, where the names are written out instead. | defaults to the store |
| `MarkedPill.vue` | The "Marked: …" pill on the view line, naming the pinned neighbour check entry (`ui.markedText`), with a × that unpins it. | yes |
| `TipLayer.vue` | The one tooltip. Any element with `data-tip="…"` gets it on mouse hover or keyboard focus; an empty `data-tip` means none. Used instead of `title`, which is slow and unstyled. Mounted once, in `ChoirArranger.vue`. | no |
| `WalkOnPanel.vue` | The Walk-on order tab: its controls (first row on, enter from, aisle, per-row overrides and row order), a read-only `StageView walk-on` numbered with them, and the list with Copy, CSV and Print. | yes |
| `WalkOnList.vue` | Draws a walk-on list. Props only. | no |
| `WalkOnSheet.vue` | Walk-on list as a portrait printed page. Props only. | no |
| `PlanSheet.vue` | The printed seating plan for ONE plan passed as a prop: pages, optional neighbour report, optional walk-on sheet. | no (props only) |
| `ReferencePane.vue` | A read-only preview of another plan below the stage (Full-stage mode). Its own seats, grid and colours, but drawn from the OPEN plan's viewpoint and seat labelling, with headings following the stage's "Seat labels" tick box (`ui.headings`), so the two compare chair for chair. | for the grid size comparison only |
| `RosterDialog.vue` | "Choir setup" (Roster, Concert and Splits tabs) and "Settings" (colours, labelling and viewpoint, backup/restore, clear all). About 2,600 lines; see [below](#the-choir-setup-dialog). | yes |
| `ImportDialog.vue` | Spreadsheet import overlay: intro, column picker or roster choice, result. Presentational; RosterDialog drives it. | no |
| `LabelPreview.vue` | Mini plan in Settings. The audience bars are buttons. | no |
| `ChoirModal.vue` | The one in-page modal, a native `<dialog>` so it stacks above RosterDialog's top-layer dialog. | no |

**The main window's controls** are five global classes in `ChoirArranger.vue`'s unscoped style
block, each under `.choir-app`: `.cbtn` (with `.primary`, `.on` and `.sm`), `.csel`, `.clabel`,
`.ccheck`, and `.cmenu` with its `.cmenuitem`s. Every component of the main window uses them rather
than styling its own button or picker, and they match the dialogs' `.pbtn` and `.presetsel`. A
choice between a few values is a `<select>`; there is no segmented button. A component's own
override of one needs both classes (`.csel.rowdir`) to outrank the global rule.

Components import their siblings and the store by relative path. `App.vue` mounts
`ChoirArranger`, which calls `store.init()` from `onMounted`; that is where `localStorage` and
`location` are first read.

---

## The layers

```
               ┌──────────────────────────────────────────────────────────────┐
  components   │ ChoirArranger ─ PlanBar ─ StageView/SectionBlock ─ SeatGrid   │
               │ RosterDialog ─ ImportDialog ─ WalkOnPanel ─ PlanSheet …       │
               └───────────────┬──────────────────────────────┬───────────────┘
                               │ useChoirArranger()           │ props: a plain PLAN
               ┌───────────────▼───────────────┐   ┌──────────▼───────────────┐
  composables  │ the store (singleton)         │   │ makePlanView(plan, view) │
               │ library + working copy + ui   │   │ (pure, no reactivity)    │
               └───────────────┬───────────────┘   └──────────┬───────────────┘
                               │ plain data in, plain data out│
               ┌───────────────▼──────────────────────────────▼───────────────┐
  utils (pure) │ library · plan · arranger(engine) · stageLayout · labels ·    │
               │ walkOnList · printPlan · exportCsv · spreadsheet · palettes … │
               └──────────────────────────────────────────────────────────────┘
```

* **`utils/` is pure.** Its files hold plain functions over plain data and nothing touches Vue, the DOM or
  storage. Every decision that can be made without a browser is made there and covered by
  `npm test`. Imports inside `utils/` and in the store use explicit `.js` extensions so bare Node
  can resolve them; components import without extensions, which Vite resolves.
* **The store** holds reactive state and passes it into the pure functions. It is the only place
  that writes state.
* **Components** draw what they are given. Anything that has to draw a plan *other than* the live
  one (previews, print, the concert pack) takes a **plan object** as a prop and never reads the
  store for plan data. `SeatGrid` and `NeighbourReport` default to the store and accept a
  `plan` override. `PlanSheet`, `WalkOnList`, `WalkOnSheet` and `LabelPreview` take props only.

---

## The data model

### The grid: `seats`

A seating is **one flat array**, `seats`, laid out **column-major** over `rows`, filling a
**fixed** `rows × cols` rectangle, so `seats.length === rows * cols`, always.

```
index i  →  row = i % rows      (row 0 is the FRONT, nearest the audience)
            col = ⌊i / rows⌋    (col 0 is the stage's left AS STORED)
cell (r, c) → i = c * rows + r
```

Each cell holds exactly one of:

| Value | Meaning |
|---|---|
| a singer **id** (e.g. `s12`, `g3`) | that singer sits here |
| `EMPTY` (`'__EMPTY__'`) | a free chair; the solver and drops may fill it |
| `BLOCKED` (`'__BLOCKED__'`) | not a chair (an aisle, pillar or gap); never filled and never moved by the solver |

`isSinger(v)` tells a person from the two sentinels. A singer can never be *named* after a sentinel
(the validators reject it).

**A singer's section is a property of their record, never of where they sit.** "Sections" on the
stage are a derived overlay (colour, bands and neighbour grouping), not containers. Swapping two cells
therefore can never change anyone's section, and singers of different sections can be swapped
freely.

**Anyone in the concert who is not in `seats` is on the bench** (the waiting area). The bench is
never stored; it is `data − placed`.

### Ids, never names

Every key into a person (seats, pins, the bench, the solver's output) is the person's `id`. The
**name** is resolved at the last moment by whatever is displaying it, through `byId` (the
`rosterById(roster)` map). That is why renaming a singer updates every chair, and why two singers
can share a name.

`seatNames(seats, byId)` in `arranger.js` converts a grid of ids to a grid of names and is the one
place that does so. Every export, the printed sheet and the walk-on list go through it (or through `byId`).
**No id should ever reach a file or a sheet of paper the user sees.**

Id prefixes (`ID` in `library.js`): roster `r`, singer `s`, concert `c`, arrangement `a`, split
`split`, guest `g`. Colour schemes use `p` from their own `nextId()`, because the palettes live
outside the library.

**One counter.** Every id minted into the user's library comes from `library.seq` via
`mintId(library, prefix)`. The counter only increases, so a deleted singer's id is never reissued to
someone new (which would give the newcomer their chair and pin). The counter is stored with the
library and is **seeded** (raised past the highest number any id already carries, references
included) whenever ids arrive from outside it: `normaliseLibrary()` on load or restore,
`importPlan()` and `seedLibrary()`.

### The library: roster → concert → arrangement

```js
library = {
  seq: 42,                       // the id counter
  rosters: [{
    id: 'r1', name: 'Chamber Choir',
    singers: [{ id: 's2', name: 'Ann Lee', section: 'Alto' }, …]   // identity ONLY
  }],
  concerts: [{
    id: 'c5', name: 'Spring', rosterId: 'r1',
    members: [{ singerId: 's2' }, …],   // tick list: which roster singers sing this concert
    guests:  [{ id: 'g9', name, section }],  // sing this concert only; never on the roster
    splits:  [{ id: 'split6', name: '2-way', cats: ['1', '2'] }, …],   // exactly ONE list
    assign:  { s2: { split6: '1' }, g9: { split6: '2' } },   // sparse categories
    arrangements: [{ id: 'a7', name: 'Plan 1', view: 'split6', ...ARRANGEMENT_FIELDS }]
  }]
}
```

* **Roster**: every singer the choir has, as `{ id, name, section }` and nothing else. Several
  concerts can share one roster, so a correction to a name made once reaches all of them.
* **Concert**: a roster, a tick list of who sings it (everyone is ticked in when the concert is
  created), optional guests, **one** splits list, each singer's category in each split (`assign`),
  and one or more arrangements. Arrangements within a concert are always comparable because they
  share singers and splits.
* **Arrangement**: one seating over the concert, holding `seats`, `pins`, `rows`, `cols`,
  `sectionOrder`, `labels`, `audienceAt` and `walkOn` (see [PLAN_FIELDS](#a-plan-plan_fields)),
  plus `id`, `name` and `view` (the colour-by split last used).

A split category is a fact about a **concert**, not a singer, which is why categories live in
`concert.assign` and not on roster records. `assign` is **sparse** and never completed in storage.

**The join.** `concertSingers(library, concert)` builds the **flat record** that the solver and
every component work with:

```js
{ id, name, section, [splitId]: category, …, guest?: true }
```

This is the members, in roster order, followed by the guests in the order they were added. A
missing or stale category snaps to the split's first category at read time, which is what makes
deleting a category safe. `assignmentsFrom(rows, SCH)` is the inverse.

`normaliseLibrary()` validates everything and **drops** malformed records rather than throwing:
a concert whose roster is missing, members not on the roster, a guest whose id collides with a
roster singer, duplicate ids (keeping the first), and so on. Survivors come out complete, so no
consumer needs to guard a field. `normaliseArrangement()` **throws** if an `ARRANGEMENT_FIELDS`
entry was not filled, which is deliberate: see the next section.

### A plan: `PLAN_FIELDS`

A **plan** is the flat object that `makePlanView()`, `PlanSheet`, `planPrintPages()` and friends
take: the layers joined back together.

```js
PLAN_FIELDS = ['roster', 'splits', 'seats', 'rows', 'cols', 'pins', 'sectionOrder',
               'labels', 'audienceAt', 'colours', 'splitColours', 'walkOn']
PLAN_SHARED_FIELDS  = ['roster', 'splits', 'colours', 'splitColours']  // from the layers above
ARRANGEMENT_FIELDS  = PLAN_FIELDS − PLAN_SHARED_FIELDS                  // what an arrangement owns
```

`roster` here is the flat, joined singer list. `colours` and `splitColours` come from the active
colour scheme.

Plans are built in exactly two ways:

* `buildPlan(sources)` takes one source (a value or getter) per field and **throws on a missing field**.
  The store's `livePlan` uses it.
* `planOf(roster, splits, arrangement, scheme)` / `concertPlan(library, concert, arrangement,
  scheme)` build a stored arrangement's plan. `concertPlan` also draws the chair of anyone who has
  since left the concert as EMPTY and drops their pin, without touching the stored record.

This exists because a hand-written object literal repeatedly lost fields: the printed sheet printed
the default palette, then had no walk-on list, then drew the wrong frames. `test/plan.test.js`
cross-reads `usePlanView.js` and `PlanSheet.vue` for the fields they read off a plan and fails if
any is missing from `PLAN_FIELDS`. See [Recipes](#add-a-plan-level-setting).

### What is global, what is per-arrangement, what is per-browser

| Scope | What | Stored in |
|---|---|---|
| Library | rosters, concerts, arrangements | `choir.library` |
| Global | colour schemes (active + list) | `choir.palettes` |
| Global | view mode (`ui.mode`: `'stage'` / `'bysection'`) | `choir.prefs` |
| Per arrangement | seats, pins, grid, section order, labels, viewpoint, walk-on, colour-by `view` | inside the arrangement |
| Session / open | which concert and arrangement are open, and the working copy of it | `choir.open`, `choir.working` |
| Per browser, not backed up | which tab is open, and whether the neighbour check is | `choir-folds` (ChoirArranger) |
| Not stored | seat-heading toggle, print options, previews, drag state | component/store refs |

---

## The store

`useChoirArranger()` returns one shared instance created by `createStore()` on first call. Every
component calls it; there is no provide/inject.

### Stored record vs working copy

The most important idea in the store is that **what is on stage is a working copy of the open
arrangement, not the arrangement itself.**

* `library`, `openConcertId` and `openArrangementId` say what is open. `concert`, `openRoster` and
  `openArrangement` are computeds that look them up.
* `data` (the flat singers) and `splits` are **computed from the library**, never stored in the
  store. Writing a singer or split means writing the library.
* The working copy is a set of separate refs: `seats`, `gridRows`, `gridCols`, `pinnedIds`,
  `sectionOrder`, `labels` (reactive), `audienceAt`, `walkOn` (reactive) and `ui.view`.
  * `adoptArrangement(raw)` fills them from a stored record, normalising it first. **It is the only
    path from a stored record onto the stage.** It runs `loadSavedSeats()`, which reconciles the seats
    against the roster, or `freshSeats()` when the arrangement has no seating yet, in which case it
    returns `true` so the caller can save the new solve.
  * `workingArrangement()` reads the working copy back out as an arrangement record, derived from
    `livePlan` and `ARRANGEMENT_FIELDS`.
  * `saveArrangement()` copies the working copy into the stored record. **It is the only thing that
    writes the stage back into the library** (the "Save changes" button).
* **Unsaved changes:** `cleanSnapshot` (a ref, so the Save button's computed reacts) holds a
  JSON snapshot of the arrangement fields. `hasUnsavedChanges()` compares the working copy against
  it, passing both through `normaliseArrangement` so absent and default values compare equal.
  `markClean()` takes the baseline from the working copy; `markCleanAgainstStored()` takes it from
  the stored record, which is used on startup and whenever opening emptied stale chairs, so that
  restored unsaved work still shows as unsaved. `view` (colour-by) is saved but is never counted as
  an unsaved change.
* Roster, concert, split and assignment edits are **not** part of the working copy. The setup
  dialog edits drafts and commits them straight to the library (`commitRoster`, `commitConcert`),
  so they are never "unsaved" from the stage's point of view.

There is no undo anywhere, which is why every action that would replace the working copy asks
first (Save then open / Discard / Cancel). Those questions live in `PlanBar` and `RosterDialog`,
because only a component can ask.

### Opening an arrangement

`openArrangementById(concertId, arrangementId, after)`:

1. Counts stale singers in the stored record (`staleSeated`).
2. Sets `openConcertId` and `openArrangementId` **and** adopts the seats in one synchronous step,
   so `byId` and `seats` never disagree across a reactive flush. Splitting this step would let the
   stage draw old ids against a new roster and throw.
3. Solves and saves a new seating when the arrangement had none.
4. Marks the result clean, or clean against the stored record if stale chairs were emptied.
5. For large concerts (16 singers or more) it runs behind the busy overlay (`runBusySteps`, a
   double `requestAnimationFrame` so the spinner paints first).

The caller is responsible for the two questions beforehand: unsaved changes and
"this plan seats people no longer in the concert" (`staleForOpen()` names them, and
`dropStale()` writes the removal into the stored record so the plan opens clean).

### Keeping the grid consistent

* `ensureGrid()` trims or pads `seats` to exactly `rows*cols` with EMPTY. Because the layout is
  column-major, this only ever adds or removes whole trailing columns.
* `reconcileSeats()` empties any cell whose id is not in `data` or appears twice. It never moves
  anyone. It runs after every roster or concert commit and after every load.
* `prunePins()` drops pins for people no longer in `data`.
* `resizeGrid(rows, cols)` keeps each singer at the same (row, col). Anyone who falls outside the
  new grid goes to the bench. It also trims walk-on per-row settings and clamps the aisle, and
  shows a toast when either happens.

### Seating actions

| Action | Effect |
|---|---|
| `placeAt(id, idx)` | Seated to seated: swap. Bench to seat: the occupant (if any) goes to the bench. Refuses BLOCKED targets. |
| `swap(i, j)` | Exchange two cells. |
| `unseat(id)` | The cell becomes EMPTY; the singer goes to the bench. |
| `insertRowSpace(idx)` / `insertRowBlock(idx)` | Opens an EMPTY or BLOCKED cell at `idx`, shifting the rest of that **row** one seat right and jumping over BLOCKED cells. If the row was full, its last singer goes to the bench. Block on an EMPTY cell simply converts it in place. |
| `removeRowSpace(idx)` / `removeRowBlock(idx)` | The inverses: the rest of the row shifts left and the last movable cell becomes EMPTY. |
| `togglePin(id)` | Pins follow the singer, not the seat. |
| `autoArrange()` | `engine().arrangeAll()` with the bench as extra input. Anyone who doesn't fit stays on the bench and a toast says so. |
| `autoSeat(sec)` | `engine().arrangeSection()`: re-solves one section in place. |
| `compact()` | Packs every seated singer toward the front-left in reading order, leaving BLOCKED cells in place. |

### Library actions

`addConcert`, `renameConcert`, `deleteConcert` (its roster is kept), `addArrangement` (`from:
'working'` duplicates what is on screen), `renameArrangement`, `deleteArrangement` (a concert always keeps at
least one), `saveConcertAs` (copies the open concert, sharing its roster, carries the working copy
and any concert draft into the copy, and opens it), `changeConcertRoster` (restarts the concert: everyone ticked in, categories cleared, every
arrangement re-solved), `commitRoster`, `addRoster`, `renameRoster`, `deleteRoster` (also deletes
every concert over that roster), `commitConcert`, `moveGuestToChoir`, `clearAll` (back to the seed).

**The seed.** A new user's library is not empty: `seedLibrary()` (in `library.js`, over the
constants in `arranger.js`) builds the example choir, the **Example Choir** roster and two concerts
over it, as ordinary records off the library's counter. Nothing marks them as examples, so they are
edited, renamed and deleted like anything the user made. The library is seeded when the store has
never been written (or was written by another schema) and by `clearAll`. Deleting every concert
leaves nothing open, and the stage says how to start.

Two rules about who joins a concert:

* A singer added to a roster through `commitRoster` joins **the open concert** if it uses that
  roster, but **not** any other concert over it. They appear there as available to tick in.
* Removing a singer from a roster removes them from every concert over it (members and `assign`).

### Derived state worth knowing

`byId`, `SCH` (ordered split ids), `SCH_LABEL`, `SPLIT_OPTIONS` and `CAT_INDEX` (from
`deriveSplitGlobals`), `pinnedSet`, `placedSet`, `waiting` (bench ids sorted by section then name)
and `waitingNames`, `capacity`, `stageStranded` (who gets the "alone" mark: alone in their section,
plus alone in the current colour-by split), `stageLateral` (the milder ↕ mark, over the same two
keys: a Map from id to the keys it is lateral under, so the grid can point the arrow at the
group-mates), `neighbourSummary` (the collapsed report header), and
`engine()` (a fresh solver bound to the current state; cheap to create).

---

## Persistence, backup and restore

**Keys** (`LS` in `persistence.js`): `choir.library`, `choir.open`, `choir.working`,
`choir.palettes`, `choir.prefs`, `choir.schema`.

**Schema.** `SCHEMA = 1`: this release is v1, and the version that was published before it is
treated as a beta. `readSnapshot()` returns `null` unless `choir.schema` equals `SCHEMA` exactly, in
which case the tool starts on the seed. There is **no migration**. The beta also stamped `choir.schema` as
1, but it kept everything else under different keys (`choir.roster.v1`, `choir.presets.v1`, …), so a
beta user's store reads as a library that was never written, and the tool opens on the seed. A
beta *backup* carries the same stamp but no `library`, so `backupVersionProblem` identifies it by
its shape and refuses it as an older version. Backups with any other stamp are refused with a
message. Future shape changes bump `SCHEMA`, and whether they get a migration is decided at that
point. The beta's `.v1` keys are left in the user's `localStorage` untouched.

**Saving.** Two watchers in a detached `effectScope` (so they survive component unmounts)
schedule a 150 ms debounced `save()`:

* a deep watch on `library` and `palettes`, which sets `libraryDirty` so the next save rewrites
  those two large keys;
* a watch on everything in the working copy plus `ui.view`, `ui.mode` and the open ids, which
  rewrites only the small keys.

`save()` serialises `toRaw(...)` (walking the reactive proxy is about 7× slower) and swallows
quota and private-mode errors.

**The working copy is stored separately** (`choir.working`) from the arrangement it copies. That
is what lets a reload return you to unsaved seating while Save still means something.
`adoptSnapshot()` applies the working copy only if its `id` matches the arrangement that was
reopened; otherwise it is dropped rather than applied to the wrong plan.

**Startup** (`init()`, once): `loadFromStorage()`, which seeds a store never written,
then opens the stored open concert or falls back to the first concert (`openFirstConcert()`).

**Backup** (`backupJSON()`) writes `{ schema, library, open, working, palettes, prefs }`. These are
the same pieces `save()` writes, built by the same functions. **Restore** (`restoreJSON`) parses the
file, checks the version, runs `normaliseLibrary`, drops any concert over the limits, refuses the
file if nothing usable is left, and then calls `adoptSnapshot()`. That is the same path a normal
page load takes, so a restored file and a returning user end up in identical states.

**Limits** (`LIMITS` in `arranger.js`): 250 singers, 8 splits, 12 categories per split. The solver's
polish pass is O(n²) per sweep, so these caps are enforced wherever data grows: import, restore
(an over-limit concert is dropped), and the add and tick buttons.

---

## The solver

`makeEngine(g)` in `arranger.js` binds a context
`{ DATA, byId, SCH, seats, pinned, order }` and returns
`{ evaluate2D, lateralIsolated2D, arrangeAll, arrangeSection }`. It works entirely in ids. It is
pure and deterministic: its only randomness is `mulberry32`, seeded by `seedFromString`, so the
same input always gives the same arrangement.

**Groups.** For a split `s`, a singer's group is `section + ' ' + category`. A soprano "1" and an
alto "1" are different groups. `SECTION_KEY` (`'section'`) groups by section alone. Group sizes are
counted over the **whole choir** (`sizesFor`, cached per engine). A group of one is excused.

**Adjacency** is 4-neighbour on the column-major grid (`neighboursOf`): front and back within a
column (row ±1, never wrapping across columns), and left and right to the adjacent columns (±rows).
EMPTY and BLOCKED cells take up positions, so they break adjacency. The `off` parameter lets a
sub-slice of the grid behave as if it were at its real position on stage. `rowOf`, `colOf` and
`idxOf` convert between a flat index and (row, col).

**`evaluate2D(seq, rows, split)`** returns `stranded`, the ids with no same-group neighbour, and
`broken`, the `{ sec, lab }` groups that form more than one connected component. These two and
`lateralIsolated2D` are what the neighbour report shows.

**`lateralIsolated2D`** returns singers who have group company in front or behind but nobody
beside them. It is disjoint from `stranded` by construction.

### The cost, in tiers

`makeScorer` scores a slice and keeps the score **up to date across swaps** rather than
recomputing it: a swap only re-scores the two cells, their neighbours, and the groups, labels and
atoms they belong to. Everything is interned to integers first. The score is four numbers, summed
over the splits:

| Tier | Counts |
|---|---|
| `stranded` | singers with no group-mate beside, in front or behind |
| `broken` | pieces each group is in, beyond the first (pieces, not yes/no, so joining 3 pieces into 2 counts as progress) |
| `lateral` | singers whose only group-mates are in front or behind |
| `soft` | each label's spread over rows ×10, plus atoms (singers alike in every split) in more than one piece |

Scores are compared **tier by tier** (`better()`), never as a weighted sum: fewer stranded always
wins, then fewer broken, then fewer lateral, then soft. That is why the solver can prefer people
beside you over people in front of you without ever breaking up a group to get it. (Laterals
were tried as a weighted term, and one swap that fixed two laterals outweighed a broken group.)

### Blocks, and how one is solved

The stage is a row of **blocks**: today one per section (`sectionBlock`), in `sectionOrder`.
`arrangeAll` pours each block, in turn, into the free cells in storage order, so each block is a
contiguous run of the column-major grid, a band of columns. Then each block is solved on its own over its
**span** (`solveBlock`): the slice from its first member's cell to its last. Inside the span,
only that block's unpinned members move; spaces, pins and stray singers from other blocks stay
put. The slice is solved at its real row offset, so column wrapping matches the stage.

`solveBlock` tries candidates and keeps the best by tiers:

1. **The snake.** Members in `pathOrder` (sorted by category, every other block reversed so a
   crossing split meets itself at the boundaries), laid into the span **row by row in a
   serpentine** (`snakeOrder`: front row left to right, the next right to left). Consecutive
   singers then sit beside each other, and a group that runs off a row turns the corner still
   touching. Pouring people in storage order instead would stack every small group front to back
   in one column, which is where most laterals came from.
2. **The grouped column fill** (`seedOrder` in storage order), the old seed.
3. If neither is perfect, up to 4 **annealed** runs from the snake (`anneal`): random swaps,
   taking a worse one with a probability that falls as the "temperature" cools, so the search can
   climb out of a dip that plain hill-climbing would stop in. It uses a weighted energy (it needs
   a size for "how much worse"), with laterals weighted low. Another run happens only while a
   group is still broken or someone stranded.

Every candidate is finished the same way: `polish` (pairwise swaps, first improvement, repeat until
a sweep changes nothing) first with the tiers `stranded, broken, soft`, which makes groups whole
with the spread tie-break pulling categories into rows, then with all four tiers, which finds
company beside without undoing the first pass.

A block is only `{ key, has(id) }`, so a semichorus can become a block of its own members, with
the rest of each section a block beside it, without changing the solve. The scorer's group key is
still section + category, and a semichorus with its own divisi will need that widened.

`arrangeSection(rows, sec)` is `solveBlock` for one section's block.

**Measured** (`node tools/lateral-check.mjs`): on the example (5 rows × 15) with every
split, 13 singers with nobody beside them, none stranded, no group broken, about 290 ms. On the
earlier 4 × 19 example it left 12, where the previous solver left 35. At the
250-singer cap, about 120 ms (930 ms before). Over 40 random choirs the total was a third of the
time, with a third fewer laterals and a quarter fewer broken groups. Hard random choirs with
three crossing splits can still take a few seconds, behind the busy overlay.

`tools/example-seating.mjs` regenerates the Schnittke example's two seating plans.
`lateral-check.mjs` measures the solver and compares it with an older `arranger.js` placed at
`.smoke/arranger-old.js`. `test/solver.test.js` holds the example to the targets above.

---

## Drawing a plan

### One layout function, one renderer

* **`stageLayout(plan)`** (`utils/stageLayout.js`) computes the geometry: `slots`, section `bands`,
  `rowHeads`, `colHeads` and `audienceTop`. It is used by StageView, ReferencePane and the print
  path, so the screen and the paper can't disagree.
* **`cropToSection()`** gives a section's bounding box as slots, keeping other sections' cells
  inside it so the box stays rectangular and `SeatGrid` can ghost them. **`cropHeads()`** labels a
  crop the way the full stage labels those cells. Used by SectionBlock, previews and "Page per
  section" printing.
* **`SeatGrid.vue`** draws a list of `slots`. Each slot is `{ id, gi }`, where **`gi` is the index
  into the real, unrotated `seats` array**. Drag and drop, pins, walk-on badges and labels all key
  on `gi`, so none of them need to know whether the drawing was rotated or cropped.

**Display placement** (SeatGrid's `posStyle`): display slot `k` goes to CSS grid column
`⌊k/rows⌋+1` and row `rows − (k % rows)`, so row 0 (the front) is drawn at the **bottom**.

**Viewpoint rotation:** `audienceAt: 'top'` draws the plan as seen from the stage. The 180°
rotation of a column-major rectangle is just `slots.reverse()`. This happens only at render time.
**`seats` is never stored reversed**, so the solver, tools and drops always see one unrotated grid.

**Section bands:** each display column belongs to whichever section has the most singers in it,
with a tie going to the incoming section (not the owner of the column to its left), so a column
shared evenly across a boundary starts the next heading; any remaining tie goes to the earlier
section in `sectionOrder`. Runs of the same owner merge into one band.
A column with no singers has no owner.

### The `plan` prop and `makePlanView`

`SeatGrid` and `NeighbourReport` read everything through `plan = props.plan || store` and `unref`
each field, so they accept either the store (whose fields are refs) or a plain **plan view**.

`makePlanView(plan, view)` (`usePlanView.js`) is the store's derived block recomputed as a pure
snapshot for any plan: `byId`, `SCH`, `SCH_LABEL`, `CAT_INDEX`, `pinnedSet`, `sectionColours`,
`splitFrames`, `engine()`, `stranded` and `ui.view`. If `view` names a split this plan doesn't
have, it falls back to `SECTION_VIEW`.

### Read-only grids

`useDragDrop` hit-tests `[data-gi]` **across the whole document**. A read-only `SeatGrid` therefore
renders no `data-gi`, binds no pointer handlers, never creates a press session and shows no menu.
Otherwise a preview would steal drops from the live grid. `readonly` is read once at setup; don't
toggle it on a mounted grid.

### A cell

* Fill: `tint(sectionColour)`, a light wash of the section's hue.
* Border: `bolden(sectionColour)` in "No split" mode, otherwise the **split frame**
  `splitFrames[section][categoryPosition]` for the category in the colour-by split.
* Marks: the category label (bottom-right), 🔒 when pinned (top-right, plus a hatch on screen only),
  the "alone" state (a `.stranded` class, red), the lateral state (a `.lateral` class, dashed amber,
  with a tag centred in the gap to each group-mate above or below as drawn, pointing at them, or one ↕ when the two are each other's group-mate; see `lateralTags`), the
  highlight (`.hl`, while the neighbour report points at someone; everyone else gets `.ghost`),
  and the walk-on badge (bottom-right, only on the Walk-on order tab's read-only stage; the category label
  is hidden then, since the arrangement is settled by the time the walk-on order is checked).
* The name comes from `props.names[id]` (the print short-name map) or `byId[id].name`.

---

## Drag and drop

`useDragDrop.js` provides one system for every pointer type, built on Pointer Events. The module
holds singletons (one session at a time, one ghost, one set of window guards).

* **`usePress({ fireOnMove })`** gives each element a `down(e, getPayload, onTap)` function to bind
  to `@pointerdown`.
  * Mouse and pen: a drag starts after 8 px of movement.
  * Touch with `fireOnMove` (bench chips, the Block and Space tools, which set
    `touch-action:none`): starts on the first movement.
  * Touch on a seat: a **350 ms long-press**. A seat doesn't set `touch-action`, so a swipe still
    scrolls the wide grid. Once the drag starts, a non-passive window `touchmove` listener calls
    `preventDefault()` so the browser can't take the gesture for scrolling mid-drag.
  * A press released without dragging calls `onTap` (which opens the cell menu).
* **Payloads:** `{ id, k }` (a seated singer, `k` = gi), `{ id }` (a bench chip), `{ block: true }`,
  `{ space: true }`.
* **`dropAt()`** is the single dispatcher. Over a non-blocked `[data-gi]` cell it calls
  `insertRowBlock`, `insertRowSpace` or `placeAt`. For a seated singer released over the `.bench`
  (with a 12 px tolerance) it calls `unseat`. `cellAt()` falls back to the nearest cell within 16 px
  so a drop in the 4 px gap between cells still lands.
* During a drag, `store.dragOverGi` and `store.dragOverBench` drive the highlights, and
  `body.dnd-active` sets the grabbing cursor and disables text selection.
* Guards swallow the browser's synthetic `contextmenu` and `click` after a touch gesture, so they
  can't trigger the cell menu. Escape cancels a drag.

---

## Seat labels and the viewpoint

`utils/labels.js` is the **only** code allowed to produce a seat's name. The stage headings, the CSV
grid, the printed sheet, the walk-on list and the Settings preview all call it.

Four settings travel with the arrangement (`LABEL_OPTIONS` / `LABEL_DEFAULTS`):

| Field | Values (default first) | Meaning |
|---|---|---|
| `rowLabel` | `letters`, `numbers` | how a row is written |
| `rowFirst` | `bottom`, `top` | which end **of the drawing** is row 1/A |
| `colLabel` | `numbers`, `letters` | how a column is written |
| `colOrder` | `ltr`, `rtl` | which side **of the drawing** is column 1/A |

Labels are **measured on the drawing as the user sees it**, so both axis functions take
`audienceAt`. A-1 stays in the same corner of the picture whichever way round the plan is drawn,
and the singers rotate underneath the labels. As a result, the same chair has different names
from the two viewpoints, which is why every printed or exported output states the viewpoint.
Changing the viewpoint **writes nothing else**; it doesn't flip the label settings.

The format always includes a separator (`B-7`, `7-C`). Letters are bijective base-26 (`A…Z, AA…`)
because the grid can be up to 40 columns wide.

Labelling is purely cosmetic. Nothing in `labels.js` touches `seats`, indexes, the solver or drops.

`seatPreview.js` lays out the 4×6 mini plan in Settings and reproduces SeatGrid's placement rule and
StageView's rotation. `test/seat-preview.test.js` checks that the preview and the stage agree.

---

## Colours

**Section colours** (`SECTION_COLOR`): Soprano `#bd8c00`, Alto `#2e74d9`, Tenor `#c4317a`,
Bass `#23844f`. The *hue* is each section's identity. Their lightness is tuned for text contrast,
and `tint()` discards lightness when making cell fills, so changing lightness never alters a fill.
Don't round these values back towards "nicer" hexes. The long comment above `SECTION_COLOR`
explains each one, including why Soprano deliberately fails AA as text.

**Split frames** show which category a singer is in (and they survive printing in mono).
`SPLIT_FRAMES` holds a hand-picked set of 8 per default section colour, keyed by the exact hex. A
custom section colour falls back to computed LCh hue offsets (`SPLIT_HUE_OFFSETS`, with the olive
band `SPLIT_HUE_BAN` avoided). A k-way split uses positions 0…k−1, and positions wrap after 8.

**Colour schemes are global** (`utils/palettes.js`):

```js
palettes = { active: 'p1', schemes: [{ id, name, colours: {Alto:'#…'}, splitColours: {Bass:{0:'#…'}} }] }
```

* Both override maps are **sparse**. A missing entry means "use the app's default", resolved each
  time it is read, so a future change to a default still reaches every scheme that never overrode
  it. **Reset deletes** the entry rather than writing today's default. Invalid values are dropped
  (never painted black).
* Split overrides are keyed by **section name and category position**, not by hex, so a user's
  choices survive recolouring the section.
* Resolving: `resolveSectionColours(colours)` → the store's `sectionColours`;
  `resolveSplitFrames(sectionColours, splitColours)` → `splitFrames[section][pos]`.
* There is always at least one scheme, and `active` always names one of them.
* The Settings panel edits a **draft** of the active scheme and saves it all at once
  (`saveSchemeColours`).

The palette choices were measured when they were chosen, by scripts that were not kept.
`test/colour.test.js` enforces the minimum contrast and separation values.

---

## Walk-on order

This is the order singers file onto the stage, so queues can form backstage. There are two halves:

* **Order (geometry)**: `walkOnOrder(namedSeats, rows, cols, walkOn)` in `arranger.js`.
  * It works **row by row** (`walkRowSequence`: back row first or front row first, or a custom
    `rowSeq`). Walking `seats` in index order would go column by column, which produces a list that
    looks plausible but is entirely wrong.
  * `enterFrom` is `left`, `right` or `both`. `perRow[r]` overrides it for one row; the array is
    indexed front row first, like the internal row index, and **never** follows the cosmetic
    `rowFirst`.
  * **Each row fills away from the entrance**: the first person on walks furthest, so nobody has to
    squeeze past. Queue L fills right to left and queue R left to right. With `both`, the two queues
    meet at the aisle (`splitCol`, the last column of the left half, or the centre when it is null).
  * EMPTY and BLOCKED cells produce no entry and **use up no position number**.
  * Numbering restarts at 1 in each queue.
  * It returns `{ queues: { L, R }, split, rowOrder }`, so the preview can show the generator's own
    decisions.
* **Presentation**: `utils/walkOnList.js`.
  * `walkOnGroups` groups entries by queue and row, labels them through `labels.js`, and hides the
    queue heading when there is only one queue.
  * `walkOnBadges` produces `bySeat[gi]` (`12`, or `L12`/`R3` when there are two queues).
  * `walkOnText` produces clipboard text separated by tabs (for pasting into Word);
    `walkOnRows` produces a flat CSV.
  * `walkOnFor(seats, …, byId)` does it all in one call and is **the only place seats are converted
    to names on this path**. The store's `walkOnPlan` and `PlanSheet` both call it.

The order is **always derived** from the seating and a small set of rules; there is no per-person
order to edit. `normaliseWalkOn` coerces any stored block field by field.

---

## Printing

Printing takes three parts working together.

1. **`ChoirArranger.vue`** owns the options (layout `stage`/`sections`, pages `auto`/`one`/`two`,
   names `full`/`short`, whether to include the neighbour report, whether to include the walk-on
   order, and whether to print every plan in the concert). It mounts the sheet in `#choir-print-root`
   **only while printing**, and does so for the button, the Walk-on order tab's Print the list, and the browser's
   own `beforeprint` (Ctrl+P). It sets `document.title` to steer the filename suggested for a PDF,
   and restores it on `afterprint`. The sheet is unmounted on `afterprint`, not straight after
   `window.print()` returns, because some engines return before rendering.
2. **`PlanSheet.vue`** renders one plan passed as a prop. For "every plan in the concert" it is
   repeated per plan (`store.concertPlans`: the open plan comes from the **working copy**, so the
   paper matches the screen, and the rest come from the library). `WalkOnSheet.vue` prints the
   walk-on order on its own portrait page.
3. **`utils/printPlan.js`** does all the maths that can be done without a browser.
   `planPrintPages(plan, opts)` produces `{ pages, names }`. Each page has its slots, bands,
   headings and a `geo` with the cell size, font size and line count. Cells share out the full
   printable width and height of an A4 landscape page with 10 mm margins, and `fitNameFont`
   binary-searches the largest name size at which every name wraps at word boundaries without
   breaking a word. Name widths are *estimated* from per-character em widths deliberately set on the
   wide side, since there is no DOM to measure against. `auto` splits the stage onto two pages when
   one page would print names below 8 pt, cutting at a section-band edge in the middle fifth if there
   is one. The Print button's warning (`legibilityWarning`, below 6 pt) reads the same page plan, so
   the warning always describes what will print.

**The constants in `SHEET` / `PRINT_CELL` must match PlanSheet.vue's CSS.** Every strip on the
sheet has an explicit height so the arithmetic is exact.

The print CSS is in three places, each layer resetting what it owns:

* `App.vue` (global block): the page shell (white background, no top bar, footer or padding), and
  the whole document on the `choir` named page;
* `ChoirArranger.vue` (global block): the `@page choir` (A4 landscape) and `@page choir-portrait`
  named pages, and hiding everything except `#choir-print-root`;
* `PlanSheet.vue`: the sheet itself.

Named pages cause page breaks, and a print ends on the document's own page type, so
`html.choir-portrait` switches the whole document to portrait whenever a walk-on sheet prints last.
This avoids a blank trailing page in Chrome.

Printing can only be verified by a person looking at a print preview: check page breaks, the
named-page orientation and the name sizes by eye.

---

## Import and export

### Exports (all CSV, all via `csvText`)

Every CSV starts with a UTF-8 BOM (so Excel on Windows decodes accents correctly) and uses CRLF line
endings. `csvCell` prefixes values starting with `= + - @` with `'` so they can't be run as formulas,
and `cellText` strips that prefix again on import.

| Export | Function | Shape |
|---|---|---|
| Seating | `exportSeatingCSV` → `seatingRows` | A grid that looks like the stage: a caption line (plan, viewpoint, colour-by), column headings, one line per stage row with its row label, `[blocked]` for BLOCKED, blank for EMPTY, then a "Not seated" block. The file **is** the picture: row 0 of the file is the top of the drawing. Cannot be imported again. |
| All plans | `exportConcertSeatingCSV` → `concertSeatingRows` | Each plan's seating block one after another, each in its own viewpoint and labelling. |
| Walk-on | `exportWalkOnCSV` → `walkOnRows` | A flat table in walk-on order. |
| Roster | `exportRosterCSV` | `Name, Section`. Can be imported again. |
| Concert | `exportConcertCSV` | `Name, Section, <split>…`. Can be imported again. |
| Templates | `downloadTemplate('concert'/'roster')` | `TEMPLATE_ROWS` / `ROSTER_TEMPLATE_ROWS` |
| Backup | `backupJSON` | see [Persistence](#persistence-backup-and-restore) |

Filenames come from `exportFilename(name, kind, ext)`, e.g. `spring-seating-2026-09-19.csv`, using
the local date.

### Import

Both CSV and .xlsx files are reduced to **one rows array** before any decision is made, so the two
formats can't behave differently.

1. `openPicker` reads the file as an `ArrayBuffer`. `sniffFormat` checks the first bytes, **never
   the file extension**: a ZIP (`PK..`) is treated as .xlsx, OLE2 as a legacy .xls (refused with
   instructions to re-save), and anything else as text.
2. xlsx: `import('read-excel-file/browser')` **dynamically**, so its ~16 KB gzipped chunk only
   loads when needed; use `readSheet`, not the default export, and read the first sheet only. CSV:
   `decodeFile` tries strict UTF-8, falls back to Windows-1252, then passes the text to `parseCSV`.
3. `normaliseRows` → `headerProblem` (the first two columns must be named Name and Section; a short
   list of alternative headings is accepted) → `classifyColumns` (every later column is a candidate
   split, pre-ticked unless it has no heading, no values, or more than 12 distinct values).
4. The user ticks columns in `ImportDialog` and names things. Then:
   * **Concert tab** → `importAsConcert`: `buildImport` creates the rows (the section is matched by
     its first letter, S/A/T/B; reserved names, unknown sections and duplicates are skipped and
     reported). `limitProblem` is checked **before anything is changed**. Split and singer ids are
     **minted** from the counter, replacing the ids `buildImport` derived from headings. `importPlan`
     then creates a new roster, a new concert and "Plan 1", which is solved, saved and opened.
     An import never writes into an existing concert.
   * **Roster tab, new** → `importAsRoster`: a new roster, committed immediately.
   * **Roster tab, replace** → `rosterReplacement`: `matchRosterByName` matches names exactly, then
     ignoring case and surrounding spaces, and only when the match is unambiguous on both sides, so
     matched singers keep their ids (and with them their seats and categories). The result is loaded
     as the Roster tab's **unsaved draft**, and Save asks before anyone leaves a concert.

Every import result is **returned**, not shown with `alert()`, so the dialog can display
scrollable, copyable lists of skipped rows and unrecognised section values.

Test fixtures for all of this are in `test/fixtures/import/` (generated by `make-fixtures.mjs`,
which is excluded from `npm test`'s glob).

---

## Previews (comparing plans)

Read-only copies of other arrangements (from this concert or any other) can be drawn alongside the
live stage.

* `previewRaw` holds keys `concertId|arrangementId` in the order they were added. `previews` is
  **derived** from those keys, so a preview whose plan has been deleted, or which is now open on
  stage, disappears immediately.
* Each preview is the **stored** arrangement (never a working copy) passed through `concertPlan`,
  with a `makePlanView` coloured by the stage's colour-by split when that plan has the split.
* In Full-stage mode each preview is a `ReferencePane` below the stage. In By-section mode each
  `SectionBlock` draws the same section cropped from every preview beside its own.
* Previews are never saved, and they are cleared on restore.

---

## The Choir setup dialog

`RosterDialog.vue` is one `<dialog>` with two faces: **Choir setup** (tabs Roster, Concert and
Splits) and **Settings** (opened by the cogwheel, with no tab strip; internally `tab === 'settings'`).

**Every tab edits a draft.** `rosterDraft`, `concertDraft`, `assignDraft` and `colourDraft` each
have a JSON "base" snapshot for dirty checking. Nothing reaches the library until that tab's Save,
which calls `commitRoster`, `commitConcert` or `saveSchemeColours`.

**One gate: `guardLayer(tab, run, question)`.** Anything that would discard a draft (switching
tab, loading another roster, concert or scheme, creating, importing, closing, or Esc) goes through
it and offers Save changes / Discard changes / Cancel. Because a tab can't be left while dirty,
whatever one tab reads from another's layer has always been saved. `beforeunload` warns if a draft
is dirty. `onNativeClose` reopens the dialog if the browser closes it while a draft is unsaved.

**The inline form.** `presetUI` drives one shared inline area for naming (new, rename and save-as
for concerts, rosters and schemes) and for confirm prompts. The name reflects its history; it is no
longer tied to "presets". `ChoirModal` hosts the import overlay (`importUI`) and the result messages
(`msgUI`).

Roster and Concert table rows are sorted once, when first shown (by section order, then surname),
and **keep that order while open** (`orderCache`), so a row
doesn't jump away while you're editing its name.

The dialog also repeats the stage-replacing questions (unsaved changes, and people who have left
the concert) for loading a
concert and creating one. `PlanBar` does the same for switching plans.

---

## Rules not to break

1. **`seats` is column-major, row 0 is the front, `length === rows * cols`.** Anything that walks
   the stage in a human order (walk-on, CSV, print) converts explicitly and never reuses array
   order.
2. **Cells hold ids; names are resolved at display time.** Never put a name in `seats`, pins or
   solver output, and never let an id reach a file or a printed sheet.
3. **The viewpoint rotates the drawing, never the data.** Do not store `seats` reversed. Carry
   `gi` for the true index.
4. **Only `labels.js` names a seat.** No component or export formats `B-7` itself.
5. **A plan is built through `buildPlan` / `planOf`**, never as an object literal, and every
   plan-level field is declared in `PLAN_FIELDS`.
6. **`adoptArrangement` is the only way onto the stage; `saveArrangement` is the only way back.**
   Anything that replaces the working copy must ask about unsaved changes first.
7. **Concert ids and seats must change together.** `openArrangementById` sets both in one
   synchronous step. Doing it in two steps makes `byId[id]` throw mid-render.
8. **Every new id comes from `mintId(library, …)`.** Don't derive ids as "one past the highest
   present"; the only exception is `nextId` for colour schemes, which live outside the library.
9. **Colour overrides are sparse; reset deletes.** Never copy default values into stored state.
10. **Read-only grids have no `data-gi`.** Drag and drop hit-tests the whole document.
11. **`utils/` stays pure and uses `.js` imports.** Otherwise `npm test` can't load it. The store
    uses `.js` imports too, so that `tools/store-smoke.mjs` can.
12. **Limits are checked before anything is changed.** An over-limit import or restore changes
    nothing.
13. **No `alert()` in the import and restore paths.** Return results and display them in the page.
    (A few simple validation messages in RosterDialog still use `alert()`/`confirm()`.)
14. **The storage keys stay as they are.** People's choirs are in `localStorage` under the keys in
    `LS` (`utils/persistence.js`) and `choir-folds` (`ChoirArranger.vue`), at whatever address they
    use the app. Renaming a key, or moving the app to another origin, leaves that work behind.
15. **A new version never reloads the page by itself.** Choir setup can be holding an unsaved
    draft. The service worker waits for the Reload button or the next launch.

---

## Recipes

### Add a plan-level setting

For example, a new per-arrangement option `foo`:

1. Add `'foo'` to `PLAN_FIELDS` in `utils/plan.js`. It becomes part of `ARRANGEMENT_FIELDS`
   automatically, unless it belongs in `PLAN_SHARED_FIELDS`.
2. Give it a normaliser (in `planFields.js`, or next to its feature) and set `out.foo` in
   `normaliseArrangement()`, which throws if you forget.
3. In the store: add the working-copy ref, add `foo: () => …` to `livePlan`'s `buildPlan` sources
   (which also throws if you forget), apply it in `adoptArrangement`, add it to the second save
   watcher, and extend `snapPlanField` if it is nested.
4. Read it in components from the **plan** (`props.plan.foo`), not the store, if print or previews
   need it.
5. `npm test` (the cross-read in `test/plan.test.js`) and `node tools/store-smoke.mjs`.

Unsaved-change detection, save, backup, restore, duplicate and comparison all work for the new field
without further changes.

### Add a persisted key

Add it to `LS`, `readSnapshot`, `save()`, `backupJSON()` and `adoptSnapshot()`. A backup is meant
to reproduce the whole tool.

### Change the stored shape

Bump `SCHEMA` in `persistence.js` and add the step to `MIGRATIONS` there: `MIGRATIONS[n]` takes a
snapshot as schema `n` wrote it and returns it as `n + 1` reads it. `readSnapshot` and
`restoreJSON` both run the chain, so an older version's stored work and its backup files open in
this one, however many versions back they are. A step is never edited or removed once it has
shipped, and `npm test` fails if a bump has none.

The other direction cannot be migrated: an older version meeting newer work, which happens to
anyone who keeps an old desktop download. `storedByNewerVersion` tells the store, which then reads
nothing and `save()` writes nothing, at startup and at every later save (a newer copy can be open
on the same store). The arranger shows a message that cannot be dismissed: update, or
**Delete my choirs**, which the user confirms.

Add a frozen `test/fixtures/backup-v<N>.json` for the new version
(the persistence tests require one for the current `SCHEMA`), and run the store smoke tool.

### Change the solver

Put the previous `arranger.js` at `.smoke/arranger-old.js` and run
`node tools/lateral-check.mjs`: it measures both on the same choirs and prints the
deltas. `npm test` holds the example to its targets. `example-seating.mjs` regenerates the
Schnittke example's two seating plans, both Auto-arrange output.

---

## The shell, the manual and the service worker

### `src/base.css`

The components were written inside a website that reset every element and set a few page-wide
defaults, and they rely on both without saying so: a button has no border or background of its own,
a heading no margin, and body text is weight 300. `base.css` is that CSS, and `main.js` imports it
first. It has two parts, and the split matters:

* **The reset** (Tailwind's preflight, with its MIT notice) is inside `@layer base`. A layered rule
  loses to any unlayered one, so every component rule beats it whatever its specificity.
* **The page defaults** after it are unlayered: the dark canvas, `body`'s font, weight and colour,
  heading weight, link and selection colours, the scrollbar. They compete with component rules on
  specificity as usual.

`<html>` is `color-scheme: dark` and `<body>` is `color-scheme: light`: the page round the app is
dark, and everything in it (form controls, pickers, scrollbars inside the app) is drawn light.

`.choir-app` sets its own font and colour. What is drawn outside it inherits `body`'s: the top bar,
and a seat's menu, which `SeatGrid` teleports to `<body>`.

### `src/App.vue`

The page shell: the fixed top bar, the dark canvas, and a footer with the manual, the source, the
third-party notices (**Licences**), the version and the author. The footer is how a hosted copy
says what it is running, which the licence asks of anyone who hosts one. `vite.config.js` defines `__APP_VERSION__`, `__APP_HOMEPAGE__`,
`__APP_AUTHOR__` and `__APP_REPOSITORY__` from `package.json`.

The bar holds the link back to the project's page (`homepage` in `package.json`), **Install app**,
and the "new version" notice. Install app is the browser's own install prompt, which Chrome and
Edge hand over in a `beforeinstallprompt` event when the app can be installed and is not yet. No
other browser does, so the button never shows there.

The link back is the published about page, wherever the build is hosted. The one exception is a
copy of the whole site served from this machine (`127.0.0.1` or `localhost`, with the tool in a
folder of it and not at the server's root): `public/app-window.js` then points the link, in the app
and in the manual, at that copy's own about page.

**In a window of its own the app is not a page of the website.** `public/app-window.js`, loaded
in `<head>` by `index.html` and by every manual page, puts the class `app-window` on `<html>` when
the page's `display-mode` is `standalone`, which is what an installed copy's window reports. The
desktop app sets the same class itself. Everything that differs hangs off that one class, so an
installed copy and the desktop app run the very files the site serves:

* **No link back**, and no bar at all unless a new version is waiting to be announced in it
  (`App.vue`). The manual's pages drop their bar too (`manual/manual.css`).
* **The app fills the window**: white to the edges, with no dark page round it and no border or
  corners on the card (`App.vue`, and `.workspace` in `ChoirArranger.vue`). The window's
  background, `color-scheme` and scrollbars go light with it. Those rules are in `App.vue`'s global
  block and not in `base.css`, which the manual shares: the manual keeps its dark page.
* Nothing but the link back takes the app's window away from the app. The manual and the source
  open a window of their own (`target="_blank"`), from the footer and from the help dialog.
* Chromium's media emulation does not cover `display-mode`. To see the installed layout without
  installing, open the app with `chrome --app=<url>`.

### Third-party notices

The licences of the code the app is built with (MIT, BSD, ISC, Apache) ask for their copyright and
licence text to go with every copy, and minifying strips it. `tools/vite-notices.mjs` is a Vite
plugin that writes it all into `THIRD-PARTY-NOTICES.txt` at the root of the build, which the
footer's **Licences** link opens and the service worker precaches. Nothing in it is typed by hand:

* **npm packages** are every module Rollup rendered into a chunk, traced to its package and that
  package's licence file. A package with no licence file fails the build until it is named in
  `unlicensed` in `vite.config.js`, where it is listed by what its `package.json` says (`worker-f`,
  which `read-excel-file` brings in, is the one so far).
* **The service worker** is built by Workbox after Vite's bundle is closed, so it cannot be traced.
  Its packages are `serviceWorker` in `vite.config.js` and what they depend on. Workbox leaves a
  stamp per package in its code (`workbox:core:7.4.0`), and once the worker is written the build
  fails if a stamp is for a package that is not listed.
* **Tailwind's preflight** in `src/base.css` is copied code, not a package (`vendored`): its notice
  is read out of the comment above it.
* **The desktop app** adds the Rust crates compiled into the program. Under `tauri build` (told by
  `TAURI_ENV_TARGET_TRIPLE`) the plugin runs [cargo-about](https://github.com/EmbarkStudios/cargo-about)
  with `src-tauri/about.toml` and `about.hbs`, so building the desktop app needs
  `cargo install --locked cargo-about --features cli`, and takes most of a minute longer. A crate
  under a licence that is not in `accepted` in `about.toml` fails the build: read the licence
  before adding it. The list errs towards too much (it includes proc macros, which only run at
  build time). It does not include the Rust standard library or Microsoft's WebView2 loader, which
  are linked in without being crates of their own with licence files cargo-about reads.

A web build has no Rust section. The dev server answers the address with a line saying the build
writes the file.

### The manual

`manual/*.md` is the user manual, one page per part of the app, with `title`, `description` and
`order` (the sidebar order) in its front matter. `tools/vite-manual.mjs` is a Vite plugin that
renders each page with markdown-it into `manual/<slug>.html` through `manual/template.html`, with
`manual/manual.css` served after `base.css` as one file, and the screenshots beside them.
`manual/index.html` is the first page. The dev server serves the same pages at `/manual/`.

* Links between pages name the Markdown file (`arranging.md#moving-singers`), and the plugin
  points the built page's link at the `.html`. That is what lets the manual be read in the
  repository on GitHub, which `README.md` links to. `manual/README.md` is the contents list
  GitHub shows for the folder: it is not a page and is not in the build, and the build fails
  unless it links to every page, in order. Images are relative too (`stage.png`), so the
  manual works wherever the build is put.
* A heading's id is its letters and digits joined by hyphens (`headingId()`). Links into the manual
  depend on the ids, so rewording a heading breaks them.
* **The build fails** on a link to a page or heading that does not exist, or an image that is not in
  `manual/`. The dev server answers with the same message.
* `![…](stage.png){.wide}` shows a wide screenshot at its real size in a scroller.
  `[⊘ Block]{.tool .block}` draws a word like one of the app's drag tools. GitHub shows both
  markers as they are typed, and the front matter as a table.
* The pages are emitted inside the Vite build, not by a script run after it, so that the service
  worker precaches them.

### The service worker

`vite-plugin-pwa` generates the worker (`generateSW`) and the web manifest. It precaches
**everything in the build**: the app, its lazy spreadsheet chunk, the manual and its screenshots,
and the third-party notices, about 3 MB. Revisions come from the build, so there is no cache version to bump by hand.

* `base` is `./` and the manifest's `start_url` and `scope` are `./`, so one build works under any
  path.
* There is no navigation fallback: the app has no client routing, so a URL that is not a file is
  not the app.
* `registerType: 'prompt'`. `main.js` registers the worker and, when a newer build has been fetched,
  sets `update.ready`; `App.vue` then shows "A new version is ready" with a Reload button. Without
  it, the new version starts the next time the app is opened after every tab of it has closed.
* On an iPhone or iPad an installed app has its own storage, separate from Safari's. Backup and
  restore is how data moves between them, as between any two browsers.

### The icons

`public/icon.svg` is the icon as drawn, with rounded, see-through corners; `public/icon-maskable.svg`
is the same drawing full-bleed and at three quarters of the size, for systems that cut icons to
their own shape. `node tools/icons.mjs` draws the PNGs from them (192, 512, a maskable 512, and an
opaque 180 px `apple-touch-icon`). Run it after editing either SVG.

### The desktop app

`src-tauri/` is a [Tauri](https://tauri.app) shell: a small Rust program that shows the built app
in the system's own web view (WebView2 on Windows) in a window with no browser round it. It adds
a window, a second one for the manual, and a check for a newer version. The app asks nothing of
it: there is no capability file, so the page has no access to Tauri's API. Building it needs
[Rust](https://rustup.rs) and, on Windows, the Visual Studio C++ build tools.

* `npx tauri build --no-bundle` runs `npm run build` and then compiles
  `src-tauri/target/release/Choir Seating Tool.exe` with `dist` inside it. `npx tauri dev` runs the
  shell against the dev server.
* **It ships in two forms from that one program.** The `.exe` by itself is the one-file copy, run
  from wherever it is kept. `npx tauri build` without `--no-bundle` also wraps it in an installer
  (`target/release/bundle/nsis/`), which puts it in `%LOCALAPPDATA%\Choir Seating Tool` with a Start
  menu entry and an uninstaller. Both keep their work in the same place (next point), so somebody
  who changes from one to the other finds it there.
* **Updates** (`check_for_update` in `lib.rs`). As it opens, the app asks the latest GitHub
  Release for `latest.json` (the `endpoints` in `tauri.conf.json`; `release.yml` writes the file).
  If that names a newer version it asks the user, in a dialog of the system's own, because the
  page has no way to ask the shell for anything. An installed copy, told by the `uninstall.exe`
  beside it, downloads the new installer, which replaces it and starts it again. The one-file copy
  cannot replace itself and opens the download page. No network, no release and "Later" all leave
  the app as it is, and it asks again the next time it opens.
* **The installer is signed, and `pubkey` in `tauri.conf.json` is the other half.** An installed
  copy refuses an update whose signature does not match it. The private key is not in the
  repository (see Releasing in `CLAUDE.md`); building the installer needs it in
  `TAURI_SIGNING_PRIVATE_KEY`. Change `pubkey` and every copy already installed stops updating.
* **Where its work is kept is part of the build.** The app runs at `http://tauri.localhost`, and
  its `localStorage` is in `%LOCALAPPDATA%\uk.jordanbarnes.choir-seating-tool`. Change the `identifier`
  in `tauri.conf.json`, or switch the web view to the `https` scheme, and an existing copy opens
  on the example choir with its work left behind. Treat both as rule 14 treats the storage keys.
* `lib.rs` marks `<html>` with the class `app-window` in both windows, as `public/app-window.js`
  does for an installed copy: a web view never reports `display-mode` as standalone.
* The manual opens in a second window, and there is only ever one: asked for again, it comes
  forward on the page asked for. "Open Choir Seating Tool" in it brings the app's window forward.
  Closing the app's window closes the manual's and ends the program.
* Neither window can be taken out of the app. A link to anywhere else opens in the browser.
  **Licences** in the footer opens `THIRD-PARTY-NOTICES.txt` in the manual's window.
* `tauri-plugin-opener` is built with `open_js_links_on_click(false)`. Left on, its script takes
  every `target="_blank"` click for itself, and with no capability to act on it the click does
  nothing: the manual never opens.
* **There is no service worker in the desktop app.** `main.js` does not register one at
  `tauri.localhost`. Every version of the program runs at that one address on one storage, so a
  worker hands one version's program the files it cached from another's: an updated copy, or an
  older `.exe` opened beside a newer one, showed the wrong app. Version 0.9.0 did register one, so
  the script `lib.rs` runs in each window removes any worker and its caches, and loads the page
  again if the worker served it. `localStorage` is not touched.
* **Two versions can share one store**, since the one-file copy is kept wherever somebody likes
  and old ones stay around. That is what `MIGRATIONS` and `storedByNewerVersion` are for (Change
  the stored shape).
* **To try the update dialog**, run a debug build with `CHOIR_SEATING_UPDATE_URL` set to the
  address of a `latest.json` that names a higher version. A release build ignores the variable.
* Saving a file (`downloadFile()` in the store) puts it in the user's Downloads folder.
* `src-tauri/icons/` is drawn from `public/icon.svg` by `npx tauri icon public/icon.svg`, which
  also writes mobile and Store icons that are not kept.
* **To drive it from a test**, build with `--debug` and set `CHOIR_SEATING_BROWSER_ARGS` to
  `--remote-debugging-port=<port>`: Playwright's `connectOverCDP` then reaches the pages in both
  windows. A release build ignores the variable. `WEBVIEW2_USER_DATA_FOLDER` points the web view
  at a throwaway folder, so a test never touches real work.

---

## Tests and tools

* **`npm test`** runs `node --test "test/*.test.js"` with no dependencies. It covers the pure modules only:
  `persistence`, `plan`, `plan-view`, `singer-ids`, `library`, `colour`, `palettes`, `labels`,
  `seat-preview`, `stage-layout`, `export`, `print`, `walk-on`, `import`, `solver`.
  The glob is deliberate: `node --test` with no
  argument treats every file under `test/` as a test, which would run
  `test/fixtures/import/make-fixtures.mjs`.
* **`node tools/store-smoke.mjs`** exercises the **live store** headlessly: it imports
  `useChoirArranger.js` as it is and runs it against stubbed browser globals. It is the only
  automated check that reaches `restoreJSON`, `save()`, `reconcileSeats` and the bench. Run it after
  touching `SCHEMA`, the stored shape or the seating array. It is a tool, not a test.
* **`node tools/lateral-check.mjs`** measures the solver (laterals, stranded,
  broken, time) on the examples and at the 250-singer cap; with an older `arranger.js` at
  `.smoke/arranger-old.js` (gitignored) it prints both and the deltas.
* Also in `tools/`: `colour.mjs` (colour maths, which `test/colour.test.js` imports),
  `example-seating.mjs` (generates the example's two seating plans), `icons.mjs`,
  `vite-manual.mjs` (the manual's Vite plugin, above) and `vite-notices.mjs` (the third-party
  notices' Vite plugin, above).
* **`node tools/manual-shots.mjs`** retakes every screenshot in the user manual,
  against a running `npm run dev`, from an empty browser profile (so, the seed). Rerun it
  after changing anything the manual shows. Run twice on the same code, it writes the same pixels.
* **`.smoke/`** is ignored: a place for scratch scripts and what they write. Nothing in the
  repository depends on it.
* **CI** (`.github/workflows/ci.yml`) runs `npm test`, the store smoke tool and the build on every
  push. `release.yml` runs the same on a version tag, then publishes that one build as the GitHub
  Release's `choir-seating-tool.zip`, and builds the desktop app into `Choir-Seating-Tool.exe`,
  `Choir-Seating-Tool-setup.exe` and `latest.json` beside it (the procedure is in `CLAUDE.md`).
  The names are the same in every release, so `…/releases/latest/download/<name>` is always the
  newest. The website serves the web app from the zip, unpacked at
  `https://jordanbarnes.uk/projects/choir-seating/` when the website is next published; this
  repository does not use GitHub Pages.
* **Manual checks**: colour, page breaks, drag feel and files opening in Excel can only be checked
  by a person.

