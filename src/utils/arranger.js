/*
 * Choir arranger — pure engine + constants + colour helpers.
 *
 * Framework-agnostic: no DOM, no localStorage, no Vue. The solver reads its state
 * from a context object `g = { DATA, byId, SCH, seats, pinned, order }` passed to
 * makeEngine(), rather than the module-level globals the original single-file app used.
 *
 * Data model: seating is ONE grid — a single `seats` array, packed column-major over `rows`
 * into a FIXED rows×cols rectangle (so `seats.length === rows*cols` and every cell exists).
 * Each cell is exactly one of: a singer's ID, EMPTY (a free chair), or BLOCKED (a seat that
 * can never be filled). A singer's SECTION is purely a property on their roster record (read
 * via byId), never a function of where they sit; "sections" are a derived overlay (colour +
 * neighbour grouping), not containers. So swapping two singers only exchanges their cells —
 * nobody's section can change. Singers not in `seats` are "on the bench" (the waiting area).
 *
 * THE CELL HOLDS AN ID AND NOT A NAME. A chair used to contain the
 * string "Helen Marr", which works only while a plan owns its roster: correcting a name then
 * empties the chair, and two singers who happen to share a name are one person. Every key into
 * a person is now the roster record's `id` — seats, pins, the bench, the pinned set, the
 * solver's own bookkeeping — and the NAME is resolved at render, once, by whoever is drawing.
 * The sentinels are unchanged and must never be given ids: `isSinger` still tells the three
 * kinds of cell apart, and it never cared what the third kind said.
 *
 * Everything the user sees or receives is still names: seatNames() below is the one conversion,
 * and the CSV exports, the printed sheet and the walk-on list all go through it.
 */

/* ---------- constants ---------- */
export const SECTIONS = ['Soprano', 'Alto', 'Tenor', 'Bass'];
// the default stage depth (the rows selector clamps to ROWS_MIN..ROWS_MAX in utils/planFields.js).
export const DEFAULT_ROWS = 4;
// Stage shown from the audience: left to right = Soprano, Alto, Tenor, Bass. Used as the
// default section precedence for auto-arrange assembly and header-band tie-breaks.
export const STAGE_ORDER = ['Soprano', 'Alto', 'Tenor', 'Bass'];
export const SECTION_VIEW = '__section__'; // colour-by mode using section colour only (the "0-split")
// The singer property that holds their section. Used as a grouping in the neighbour check
// (so a singer with no same-section neighbour is flagged) and, crucially, in the solver's
// cost so sections stay tightly packed together on the one shared grid.
export const SECTION_KEY = 'section';
// Every grid cell is exactly one of three things: a singer's id, EMPTY, or BLOCKED. The grid
// is a FIXED rows×cols rectangle, so `seats` always has length rows*cols and every cell exists.
//
// BLOCKED — a seat that can never hold a singer: a physical gap, aisle, or pillar. It occupies a
//   grid position (so it breaks adjacency) and auto-arrange always leaves it exactly where it is.
//   This is the "space" the user drops in to spread groups apart. The sentinel (matching the
//   __section__ convention) is barred from being saved as a singer's name, so it never collides.
// EMPTY — an available chair with nobody in it. Auto-arrange and manual drops may fill it; the
//   solver treats it as a free slot, not a singer.
export const BLOCKED = '__BLOCKED__';
export const isBlocked = (n) => n === BLOCKED;
export const EMPTY = '__EMPTY__';
export const isEmpty = (n) => n === EMPTY;
// A real singer occupies the cell (neither empty nor blocked, and an actual name).
export const isSinger = (n) => n != null && n !== EMPTY && n !== BLOCKED;

/* ---------- singer ids ---------- */
// A roster record's primary key, and what a seat, a pin and the bench all hold. Sequential and
// deliberately opaque: it is never shown, never exported to a file a user opens, and never
// matched on, so the only properties that matter are that it is a string, that it is unique
// within its roster, and that it is not a sentinel. `s1` follows the `preset1` / `split1`
// convention already in useChoirArranger.js. The format is not load-bearing.

// New ids for a user's library come off its one counter: mintId() in utils/library.js.

/**
 * One past the highest `<prefix><n>` in `ids`, ignoring anything that is not of that shape, so an
 * id that arrived from somewhere else is never parsed and never collided with. For lists that
 * live outside the library's counter, which is only the colour schemes (utils/palettes.js).
 */
export function nextId(prefix, ids) {
  const re = new RegExp('^' + prefix + '(\\d+)$');
  let max = 0;
  for (const id of ids || []) {
    const m = typeof id === 'string' ? re.exec(id) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + (max + 1);
}

/**
 * Is this roster already keyed? Every record carries a non-empty string id and no two share one.
 * Anything short of that is re-keyed from scratch by withSingerIds below, because a half-keyed
 * roster has no honest reading, and guessing wrong moves singers between chairs.
 */
export function hasSingerIds(roster) {
  if (!Array.isArray(roster)) return false;
  const seen = new Set();
  for (const r of roster) {
    if (!r || typeof r.id !== 'string' || !r.id || seen.has(r.id)) return false;
    seen.add(r.id);
  }
  return true;
}

/**
 * Key a plan written with NAMES onto stable ids: the roster records get `s1`, `s2`, …, and
 * `seats` and `pins` are rewritten to hold those ids. The shipped examples and the spreadsheet
 * import both start from names.
 *
 * IDEMPOTENT: a roster that is already keyed comes straight back (detached).
 *
 * Two records sharing a name both want every chair holding that string; chairs go to them in
 * SEAT order, first chair to first record. A name in `seats` with no roster match — or seated
 * twice — becomes EMPTY.
 *
 * @param {{ roster?: object[], seats?: string[], pins?: string[] }} plan
 * @returns {{ roster: object[], seats: string[], pins: string[] }}
 */
export function withSingerIds(plan) {
  const roster = Array.isArray(plan && plan.roster) ? plan.roster : [];
  const seats = Array.isArray(plan && plan.seats) ? plan.seats : [];
  const pins = Array.isArray(plan && plan.pins) ? plan.pins : [];
  // Already keyed: nothing to re-key, but the three arrays still come back detached, because
  // every caller treats the result as its own copy.
  if (hasSingerIds(roster)) return { roster: roster.slice(), seats: seats.slice(), pins: pins.slice() };

  const keyed = roster.map((r, i) => ({ ...r, id: 's' + (i + 1) }));
  // name -> the ids of every record carrying it, in roster order. The seat pass shifts off the
  // front, so the first chair goes to the first record and the queue empties as they are claimed.
  const queue = new Map();
  const first = new Map();
  keyed.forEach((r) => {
    const n = String(r.name);
    if (!queue.has(n)) queue.set(n, []);
    queue.get(n).push(r.id);
    if (!first.has(n)) first.set(n, r.id);
  });

  const nextSeats = seats.map((cell) => {
    if (!isSinger(cell)) return cell; // EMPTY and BLOCKED are untouched and never get an id
    const q = queue.get(String(cell));
    return q && q.length ? q.shift() : EMPTY;
  });

  // a pin is a set, so a name that resolves to an id already pinned is not pinned twice.
  const seen = new Set();
  const nextPins = [];
  for (const n of pins) {
    const id = first.get(String(n));
    if (id && !seen.has(id)) {
      seen.add(id);
      nextPins.push(id);
    }
  }
  return { roster: keyed, seats: nextSeats, pins: nextPins };
}

/** The id -> record lookup every consumer resolves a seat through. */
export function rosterById(roster) {
  const m = {};
  for (const r of roster || []) if (r && r.id != null) m[r.id] = r;
  return m;
}

/**
 * A seats array as NAMES, and the ONE place an id turns back into a person.
 *
 * Everything the user sees or receives keeps using names — the CSV exports, the printed sheet,
 * the walk-on list — so each of those resolves here and then works in names, rather than every
 * one of them learning to carry a roster around. The sentinels pass through untouched, and an id
 * with no roster record reads as EMPTY: that chair is empty, which is exactly what
 * reconcileSeats would make of it at the next load.
 */
export function seatNames(seats, byId) {
  const bn = byId || {};
  return (Array.isArray(seats) ? seats : []).map((cell) => {
    if (!isSinger(cell)) return cell;
    const rec = bn[cell];
    return rec && typeof rec.name === 'string' ? rec.name : EMPTY;
  });
}
// Fixed section palette: Soprano yellow, Alto blue, Tenor pink, Bass green — the
// Glasshouse standard. These are the DEFAULTS a plan falls back to, not the only values the app
// can paint: a plan may override any of them — see normaliseColours() below.
//
// HUES ARE THE IDENTITY. Bass was darkened on 2026-09-04 to clear WCAG AA as text, at its
// exact Glasshouse hue (`#2ba160`); Alto has never moved.
//
// TENOR IS PINK, AND WAS PURPLE BY MISTAKE. `#7c4dd3` (HSL hue 261) arrived with the
// Glasshouse set in June 2026 and was never the Glasshouse tenor — the standard is pink.
// Corrected 2026-09-19 to `#c4317a`, HSL hue 330 at the SAME saturation (0.60) the purple
// had, darkened to L 0.48 so it still clears AA as text. This is the one hue change in the
// palette's life, so it is the one place the identity argument below does not apply.
// It measures better on every floor the suite guards:
//   Alto/Tenor fill separation  dE 17.8 -> 33.9   (the weak pair)
//   worst fill pair of the four dE 17.8 -> 28.6   singer name on the fill  5.98:1 -> 7.01:1
//   frame on its own fill       dE 30.5 -> 31.7, 2.37:1 -> 2.77:1
// and worse on one: the worst pair among EIGHT tenor split frames fell dE 8.2 -> 6.1 under
// the shared offsets. That belonged to the frames, not the hue, and the bespoke SPLIT_FRAMES
// below replaced them the same day (Tenor's eight now 10.7).
//
// SOPRANO DELIBERATELY STILL FAILS AA (3.04:1) AND IS NOT TO BE "FIXED" BY DARKENING. A
// yellow cannot clear 4.5:1 on white and still read as yellow: dark yellow IS brown. That
// was tried (`#966f00`, 4.59:1) and rejected on sight — it reads as clear brown and loses
// the section's identity, which is the thing the contrast was supposed to be protecting.
// The text is 15px bold in SectionBlock.vue, below WCAG's large-text threshold, so the 3:1
// allowance does not apply either. The real fix is at the usage site — stop painting 15px
// body text in the raw section colour — not in this constant. Nor do custom colours close this: they
// give a user who needs the contrast a way to set it, which is not the same as the default
// clearing AA.
//
// That is free because the two surfaces are decoupled. tint() below DISCARDS lightness
// outright (it forces L=0.74) and clamps saturation into 0.75-0.95 — and all four sections
// fall OUTSIDE that band, so the seat fill is a pure function of HUE. Retune a section's
// lightness or saturation as far as the text needs and the fills stay
// `#fcdb7e #8bb4ee #ee8bbc #8beeb8`, byte for byte. Only the hue is load-bearing on the
// stage. The raw hex is used separately as TEXT
// (`SectionBlock.vue` h2, `NeighbourReport.vue` row header) and as dots and bands, and that
// is the only place the change shows. Contrast on white, was -> now:
//   Bass 3.30:1 -> 4.68:1   Alto 4.55:1 untouched   Tenor 5.44:1 -> 5.16:1   Soprano stays 3.04:1
//
// So do NOT "simplify" these by rounding them back towards the originals: the lightness is
// carrying the text contrast and the hue is carrying the identity. `test/colour.test.js` holds
// the contrast and the separation to their minimums.
export const SECTION_COLOR = { Soprano: '#bd8c00', Alto: '#2e74d9', Tenor: '#c4317a', Bass: '#23844f' };

// A PLAN'S OWN SECTION COLOURS. The four above are the shipped defaults; a plan may
// override any of them, and the override map is SPARSE. That is load-bearing rather than tidy:
//
//   * an ABSENT section means "paint SECTION_COLOR", resolved on every read rather than copied
//     into the plan when it is saved, so a later retune of a default still reaches every plan
//     whose owner never chose their own — which is the whole reason these constants stay
//     hardcoded instead of being seeded into stored state;
//   * "reset to defaults" is therefore a DELETE, never a write of today's constant, so pressing
//     it cannot quietly pin a plan to whatever shipped that afternoon;
//   * absent must never resolve to black. normaliseColours DROPS what it does not recognise
//     rather than substituting, so a hand-edited backup carrying "red", "" or null loses that
//     one section back to its default and takes nothing else with it.
//
// RECOLOURING A SECTION ALSO RECOLOURS ITS EIGHT SPLIT FRAMES, and that is intended: SPLIT_FRAMES
// above is keyed on the section's exact hex, so a custom colour finds no bespoke list and falls
// through to the computed SPLIT_HUE_OFFSETS derivation. Frames chosen for a colour the section no
// longer has would be frames measured against a fill that no longer exists.
const HEX6 = /^#[0-9a-f]{6}$/i;
export const validSectionColour = (v) => typeof v === 'string' && HEX6.test(v);
// Lowercased on the way in, because SPLIT_FRAMES is keyed on the exact hex. `<input type="color">`
// is specified to hand back lowercase; a file edited by hand is under no such obligation.
export function normaliseColours(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const s of SECTIONS) if (validSectionColour(src[s])) out[s] = src[s].toLowerCase();
  return out;
}
// The colour to PAINT one section in: the plan's override where it has one, the default where
// it does not.
export function sectionColour(section, colours) {
  return validSectionColour(colours?.[section]) ? colours[section].toLowerCase() : SECTION_COLOR[section];
}
// ...and all four at once, which is the shape every consumer wants: an object that indexes
// exactly like SECTION_COLOR, so the six call sites that read the constant directly change by
// NAME and not by shape. The store exposes this as `sectionColours`; makePlanView returns the
// same thing for a plan that is not the live one.
export function resolveSectionColours(colours) {
  const out = {};
  for (const s of SECTIONS) out[s] = sectionColour(s, colours);
  return out;
}

// Sensible bounds. The 2D polish is O(n²) per pass, so an unbounded roster or split count
// could lock the tab for seconds. These caps are enforced at every entry point that grows
// the data: import, restore, and the add buttons.
export const LIMITS = {
  singers: 250, // total roster size
  splits: 8, // number of splits (ways the choir is sub-divided)
  cats: 12 // categories within a single split
};

// Split frames are per section (2026-09-11). Each default section colour has its
// own bespoke eight (the 2026-09-19 revision), found by a search script that was not kept:
// every frame at least 50 degrees of hue from its section, no brown or olive, the first four
// chosen for normal AND colour-blind separation, five to eight weaker by design. A k-way split
// takes the first k, so the order matters; past eight they wrap and the label identifies.
// The lists are keyed by the section's EXACT hex, so recolouring a section drops it to the
// computed fallback below instead of keeping frames picked for a colour it no longer has.
export const SPLIT_FRAMES = {
  [SECTION_COLOR.Soprano]: ['#0b5801', '#5f0199', '#0e8bdf', '#fe2c67', '#1c9c04', '#970246', '#d904ba', '#3c51fc'],
  [SECTION_COLOR.Alto]: ['#597102', '#750164', '#761d01', '#ce0057', '#bf01a4', '#7f012c', '#d1061b', '#00792f'],
  [SECTION_COLOR.Tenor]: ['#597102', '#002caa', '#761d01', '#0368c1', '#3c51fc', '#00792f', '#004998', '#c33101'],
  [SECTION_COLOR.Bass]: ['#988705', '#013596', '#761d01', '#fe09a3', '#2983ff', '#7a034c', '#cf014d', '#6647f4']
};
// The fallback for any other section colour (a custom colour): the section's LCh hue turned
// by fixed offsets, found the same way.
export const SPLIT_FRAME = { L: 40, C: 80 }; // one CIE lightness and chroma, so every frame reads alike on the pale fills
export const SPLIT_HUE_OFFSETS = [235, 50, 140, 330, 195, 280, 95, 215];
export const SPLIT_HUE_BAN = [75, 105]; // dark yellow reads as olive, so a hue in here moves to the nearer edge
export function splitFrame(sectionHex, i) {
  const bespoke = SPLIT_FRAMES[sectionHex.toLowerCase()];
  if (bespoke) return bespoke[i % bespoke.length];
  const [lo, hi] = SPLIT_HUE_BAN;
  let h = (lchHue(sectionHex) + SPLIT_HUE_OFFSETS[i % SPLIT_HUE_OFFSETS.length]) % 360;
  if (h > lo && h < hi) h = h - lo < hi - h ? lo : hi;
  return lchToHex(SPLIT_FRAME.L, SPLIT_FRAME.C, h);
}

// A PLAN'S OWN SPLIT FRAME COLOURS (the per-split-category half). splitFrame() above is
// what "the default" MEANS, and it is pure; an override belongs in FRONT of it, exactly as
// sectionColour() sits in front of SECTION_COLOR.
//
// THE KEY IS (SECTION NAME, CATEGORY POSITION), which is the colour space the stage actually
// renders: deriveSplitGlobals gives a category its position WITHIN its split, and the cell takes
// splitFrame(sectionHex, position). So the rendered frames have the shape of SPLIT_FRAMES —
// section by position — and a picker sits beside exactly one of them.
//
// BY SECTION NAME, NEVER BY HEX, and that is the one place this store deliberately parts company
// with SPLIT_FRAMES. SPLIT_FRAMES is keyed on the exact hex SO THAT recolouring a section drops
// the frames that were measured against the fill it no longer has. Keyed the same way, a user's
// hand-picked overrides would be ORPHANED by the same recolour — silently, since the plan would
// still carry them under a hex nothing looks up any more. A colour someone chose by hand belongs
// to the section, not to the shade the section happened to be that afternoon.
//
// A POSITION IS SHARED ACROSS SPLITS, which is the defaults' own behaviour: position 0 of the
// 2-way split and position 0 of the 4-way split render the same frame today, because both resolve
// to splitFrame(hex, 0). One override per (section, position) preserves that. Splitting them
// apart would be a different feature.
//
// PRECEDENCE, when a section is recoloured AND has overrides: the override wins for the positions
// it names, and splitFrame() fills the rest — which for a custom section colour means the
// computed SPLIT_HUE_OFFSETS derivation, never the bespoke list of the colour it used to be.
// Overrides survive the recolour; the positions nobody chose follow the new hue.
//
// Sparse on exactly the same terms as the section overrides: absent means "ask splitFrame()",
// never black and never a copy of today's bespoke list, so reset is a delete and a later retune
// of the constants still reaches every position nobody chose.
export function normaliseSplitColours(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const s of SECTIONS) {
    const row = src[s];
    if (!row || typeof row !== 'object') continue;
    const kept = {};
    // LIMITS.cats is the most positions a split can reach, so it is also the most a plan can
    // usefully override. A key outside that range is junk from a hand-edited file and is dropped
    // rather than carried to a picker that will never be drawn.
    for (let i = 0; i < LIMITS.cats; i++) if (validSectionColour(row[i])) kept[i] = row[i].toLowerCase();
    if (Object.keys(kept).length) out[s] = kept;
  }
  return out;
}
// The colour to PAINT one category position in, for one section: the plan's override where it has
// one, splitFrame() where it does not. `sectionHex` is the section's RESOLVED colour, so the
// fallback already follows a recoloured section.
export function splitFrameColour(section, sectionHex, i, splitColours) {
  const v = splitColours?.[section]?.[i];
  return validSectionColour(v) ? v.toLowerCase() : splitFrame(sectionHex, i);
}
// ...and every section's whole run at once, which is the shape SeatGrid wants: an object indexed
// by section name holding one frame per category position. The store exposes this as
// `splitFrames` and makePlanView returns the same thing for a plan that is not the live one, so a
// plan drawn read-only draws ITS frames. LIMITS.cats long because that is as far as a split can
// reach; past the bespoke eight splitFrame() wraps, and an override at position 8 is its own
// value rather than a second name for position 0 — the wrap belongs to the default list.
export function resolveSplitFrames(sectionColours, splitColours, count = LIMITS.cats) {
  const out = {};
  for (const s of SECTIONS) {
    const hex = sectionColours?.[s] || SECTION_COLOR[s];
    out[s] = Array.from({ length: count }, (_, i) => splitFrameColour(s, hex, i, splitColours));
  }
  return out;
}
// Which category positions the plan's splits actually REACH, with the category names that land on
// each one. A k-way split uses positions 0 to k-1. Returned in position order, names in split
// order and de-duplicated, because the names are how a user recognises the column they are
// colouring.
export function splitCatPositions(splits) {
  const rows = [];
  for (const s of Array.isArray(splits) ? splits : []) {
    const cats = Array.isArray(s?.cats) ? s.cats : [];
    cats.slice(0, LIMITS.cats).forEach((c, i) => {
      if (!rows[i]) rows[i] = { pos: i, names: [] };
      if (typeof c === 'string' && c && !rows[i].names.includes(c)) rows[i].names.push(c);
    });
  }
  return rows.filter(Boolean);
}

// a clean install seeds just one 2-way split (plus the implicit "No split"/section mode).
export const BASIC_SPLITS = [{ id: '2way', name: '2-way', cats: ['1', '2'] }];
// the example choir's full set of splits (paired with EXAMPLE_ROSTER).
export const EXAMPLE_SPLITS = [
  { id: '2way', name: '2-way', cats: ['1', '2'] },
  { id: '3way', name: '3-way', cats: ['Highs', 'Mids', 'Lows'] },
  { id: '4way', name: '4-way', cats: ['1A', '1B', '2A', '2B'] }
];

// The example choir. One roster serves both example concerts: the categories below are keyed by
// the EXAMPLE_SPLITS ids, and the concert with only the 2-way split ignores the rest.
//
// The ids are STAMPED ON below rather than written out here, and the seatings are likewise left
// as names. They are source constants a person edits — moving Julian into the Bass front row has
// to stay a matter of moving one string — and a list of 76 `s41`s is not something anyone can
// proofread.
const EXAMPLE_PEOPLE = [
  { name: 'Chen-Wei Cheung', section: 'Bass', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Gabriel Jessop', section: 'Bass', '2way': '1', '3way': 'Highs', '4way': '1B' },
  { name: 'George Ives', section: 'Bass', '2way': '1', '3way': 'Mids', '4way': '1B' },
  { name: 'Gordon Henderson', section: 'Bass', '2way': '1', '3way': 'Highs', '4way': '1B' },
  { name: 'Ivo Keane', section: 'Bass', '2way': '1', '3way': 'Mids', '4way': '1B' },
  { name: 'Jay Chow', section: 'Bass', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Juan Hatch', section: 'Bass', '2way': '1', '3way': 'Mids', '4way': '1B' },
  { name: 'Julian Barlow', section: 'Bass', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Piers Carver', section: 'Bass', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Prakash Sumner', section: 'Bass', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Bob Dobson', section: 'Bass', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Damilare Adeyemi', section: 'Bass', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Declan Coles', section: 'Bass', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Jacob Drummond', section: 'Bass', '2way': '2', '3way': 'Lows', '4way': '2A' },
  { name: 'Neil Fenwick', section: 'Bass', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Pavel Bevan', section: 'Bass', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Piers Ravenscroft', section: 'Bass', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Piers Saunders', section: 'Bass', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Reuben Teal', section: 'Bass', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Silas Wise', section: 'Bass', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Tom Hobson', section: 'Bass', '2way': '2', '3way': 'Lows', '4way': '2A' },
  { name: 'Tom McIntyre', section: 'Bass', '2way': '2', '3way': 'Lows', '4way': '2B' },

  { name: 'Camilla Yates', section: 'Soprano', '2way': '1', '3way': 'Mids', '4way': '1B' },
  { name: 'Ekaterina De Vere', section: 'Soprano', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Elsie Redfern', section: 'Soprano', '2way': '1', '3way': 'Mids', '4way': '1B' },
  { name: 'Esme Lennox', section: 'Soprano', '2way': '1', '3way': 'Highs', '4way': '1B' },
  { name: 'Frieda Stokes', section: 'Soprano', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Georgina Penrose', section: 'Soprano', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Jeanette Birch', section: 'Soprano', '2way': '1', '3way': 'Highs', '4way': '1B' },
  { name: 'Juliet Murdoch', section: 'Soprano', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Kaya Quinlivan', section: 'Soprano', '2way': '1', '3way': 'Highs', '4way': '1B' },
  { name: 'Kim Shelton', section: 'Soprano', '2way': '1', '3way': 'Highs', '4way': '1B' },
  { name: 'Kitty Symonds', section: 'Soprano', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Niamh Slater', section: 'Soprano', '2way': '1', '3way': 'Lows', '4way': '2B' },
  { name: 'Primrose Saunders', section: 'Soprano', '2way': '1', '3way': 'Lows', '4way': '2B' },
  { name: 'Rhona Teal', section: 'Soprano', '2way': '1', '3way': 'Mids', '4way': '2A' },
  { name: 'Selma Rowntree', section: 'Soprano', '2way': '1', '3way': 'Mids', '4way': '2A' },
  { name: 'Bridget Tilley', section: 'Soprano', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Delphine Weston', section: 'Soprano', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Flora Thornton', section: 'Soprano', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Hazel Baines', section: 'Soprano', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Hazel Stokes', section: 'Soprano', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Jess Milne', section: 'Soprano', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Joy Tobin', section: 'Soprano', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Joyce Farrow', section: 'Soprano', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Marianne Page', section: 'Soprano', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Maya Hicks', section: 'Soprano', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Meera Hale', section: 'Soprano', '2way': '2', '3way': 'Mids', '4way': '2A' },

  { name: 'Harriet Corbett', section: 'Alto', '2way': '1', '3way': 'Highs', '4way': '1B' },
  { name: 'Harriet Hunt', section: 'Alto', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Hester Ives', section: 'Alto', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Janine Burke', section: 'Alto', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'June Bowden', section: 'Alto', '2way': '1', '3way': 'Mids', '4way': '1B' },
  { name: 'Keira Lang', section: 'Alto', '2way': '1', '3way': 'Mids', '4way': '1A' },
  { name: 'Rebecca Leach', section: 'Alto', '2way': '1', '3way': 'Highs', '4way': '1B' },
  { name: 'Rita Mowbray', section: 'Alto', '2way': '1', '3way': 'Mids', '4way': '1B' },
  { name: 'Stella Dawes', section: 'Alto', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Catriona Redfern', section: 'Alto', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Cordelia Duval', section: 'Alto', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Elsie Morton-Fraser', section: 'Alto', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Leila Lomax', section: 'Alto', '2way': '2', '3way': 'Lows', '4way': '2A' },
  { name: 'Lois Madden', section: 'Alto', '2way': '2', '3way': 'Lows', '4way': '2A' },
  { name: 'Margot Battersby', section: 'Alto', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Prue Beck', section: 'Alto', '2way': '2', '3way': 'Lows', '4way': '2B' },

  { name: 'Alastair Waite', section: 'Tenor', '2way': '1', '3way': 'Highs', '4way': '1B' },
  { name: 'Clive Venturi', section: 'Tenor', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Clive Hunt', section: 'Tenor', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Des Wyatt', section: 'Tenor', '2way': '1', '3way': 'Highs', '4way': '1A' },
  { name: 'Gary Eddington', section: 'Tenor', '2way': '1', '3way': 'Mids', '4way': '1B' },
  { name: 'Piers Vance', section: 'Tenor', '2way': '1', '3way': 'Mids', '4way': '1B' },
  { name: 'Arthur Harding', section: 'Tenor', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Arthur Battersby', section: 'Tenor', '2way': '2', '3way': 'Mids', '4way': '2A' },
  { name: 'Duncan Hampton', section: 'Tenor', '2way': '2', '3way': 'Lows', '4way': '2A' },
  { name: 'Gavin Howell', section: 'Tenor', '2way': '2', '3way': 'Lows', '4way': '2B' },
  { name: 'Marcus Drummond', section: 'Tenor', '2way': '2', '3way': 'Lows', '4way': '2B' }
];

// Option 1: the Schnittke seating, precomputed so the examples load already arranged, instantly,
// with no solve-on-load. ONE shared grid, column-major over EXAMPLE_ROWS (each line below is one
// stage column, front row first), on a fixed EXAMPLE_ROWS × EXAMPLE_COLS rectangle; EMPTY marks a
// free chair. Auto-arrange output, generated with Option 2 by tools/example-seating.mjs.
const EXAMPLE_SEAT_NAMES = [
  'Kim Shelton', 'Kaya Quinlivan', 'Selma Rowntree', 'Niamh Slater', 'Delphine Weston',
  'Frieda Stokes', 'Jeanette Birch', 'Rhona Teal', 'Primrose Saunders', 'Marianne Page',
  'Georgina Penrose', 'Esme Lennox', 'Meera Hale', 'Joy Tobin', 'Hazel Stokes',
  'Kitty Symonds', 'Elsie Redfern', 'Joyce Farrow', 'Bridget Tilley', 'Jess Milne',
  'Ekaterina De Vere', 'Camilla Yates', 'Hazel Baines', 'Flora Thornton', 'Maya Hicks',
  'Juliet Murdoch', 'Keira Lang', 'Cordelia Duval', 'Margot Battersby', 'Prue Beck',
  'Stella Dawes', 'Harriet Hunt', 'June Bowden', 'Lois Madden', 'Catriona Redfern',
  'Hester Ives', 'Harriet Corbett', 'Rita Mowbray', 'Leila Lomax', 'Elsie Morton-Fraser',
  'Janine Burke', 'Rebecca Leach', 'Arthur Harding', 'Arthur Battersby', 'Marcus Drummond',
  'Clive Venturi', 'Alastair Waite', 'Piers Vance', 'Duncan Hampton', 'Gavin Howell',
  'Clive Hunt', 'Des Wyatt', 'Gary Eddington', 'Piers Ravenscroft', 'Piers Saunders',
  'Chen-Wei Cheung', 'George Ives', 'Ivo Keane', 'Pavel Bevan', 'Reuben Teal',
  'Jay Chow', 'Gordon Henderson', 'Juan Hatch', 'Declan Coles', 'Tom McIntyre',
  'Julian Barlow', 'Gabriel Jessop', 'Bob Dobson', 'Silas Wise', 'Jacob Drummond',
  'Piers Carver', 'Prakash Sumner', 'Damilare Adeyemi', 'Neil Fenwick', 'Tom Hobson'
];

// Option 2: the same singers, arranged from a different starting seating, so it scores the same
// as Option 1 and seats people differently. Generated by the same tool.
const EXAMPLE_SEAT_NAMES_2 = [
  'Kim Shelton', 'Kaya Quinlivan', 'Selma Rowntree', 'Primrose Saunders', 'Maya Hicks',
  'Ekaterina De Vere', 'Jeanette Birch', 'Rhona Teal', 'Niamh Slater', 'Marianne Page',
  'Kitty Symonds', 'Esme Lennox', 'Meera Hale', 'Joy Tobin', 'Jess Milne',
  'Frieda Stokes', 'Elsie Redfern', 'Joyce Farrow', 'Flora Thornton', 'Hazel Stokes',
  'Juliet Murdoch', 'Camilla Yates', 'Bridget Tilley', 'Hazel Baines', 'Delphine Weston',
  'Georgina Penrose', 'Keira Lang', 'Margot Battersby', 'Cordelia Duval', 'Prue Beck',
  'Stella Dawes', 'Janine Burke', 'Rita Mowbray', 'Lois Madden', 'Elsie Morton-Fraser',
  'Hester Ives', 'Rebecca Leach', 'June Bowden', 'Leila Lomax', 'Catriona Redfern',
  'Harriet Hunt', 'Harriet Corbett', 'Arthur Battersby', 'Arthur Harding', 'Marcus Drummond',
  'Des Wyatt', 'Alastair Waite', 'Piers Vance', 'Duncan Hampton', 'Gavin Howell',
  'Clive Hunt', 'Clive Venturi', 'Gary Eddington', 'Reuben Teal', 'Pavel Bevan',
  'Prakash Sumner', 'Juan Hatch', 'Ivo Keane', 'Declan Coles', 'Piers Saunders',
  'Piers Carver', 'Gordon Henderson', 'George Ives', 'Tom McIntyre', 'Piers Ravenscroft',
  'Julian Barlow', 'Gabriel Jessop', 'Neil Fenwick', 'Bob Dobson', 'Tom Hobson',
  'Jay Chow', 'Chen-Wei Cheung', 'Damilare Adeyemi', 'Silas Wise', 'Jacob Drummond'
];

// The constants above, keyed onto stable ids.
const EXAMPLE_PLAN = withSingerIds({ roster: EXAMPLE_PEOPLE, seats: EXAMPLE_SEAT_NAMES, pins: [] });
export const EXAMPLE_ROSTER = EXAMPLE_PLAN.roster;
export const EXAMPLE_SEATS = EXAMPLE_PLAN.seats;
export const EXAMPLE_SEATS_2 = withSingerIds({ roster: EXAMPLE_PEOPLE, seats: EXAMPLE_SEAT_NAMES_2, pins: [] }).seats;
export const EXAMPLE_ROWS = 5, EXAMPLE_COLS = 15;

// Così fan tutte: a second concert over the same roster, sung by sixteen of its singers and four
// guests who are not on it. Two seatings of them, both entering from both wings: sopranos from the
// left, everyone else from the right, with the aisle set after the last soprano column. Each
// seating is column-major, front row first, like the Schnittke ones.
const COSI_GUESTS = [
  { id: 'g1', name: 'Gavin Whitaker', section: 'Bass', '2way': '1' },
  { id: 'g2', name: 'Winston Kerr', section: 'Bass', '2way': '2' },
  { id: 'g3', name: 'Omar Pickering', section: 'Tenor', '2way': '2' },
  { id: 'g4', name: 'Seb Laing', section: 'Tenor', '2way': '2' }
];
const COSI_MEMBERS = [
  'Jeanette Birch', 'Kim Shelton', 'Delphine Weston', 'Marianne Page',
  'Bridget Tilley', 'Hazel Baines', 'Joyce Farrow', 'Meera Hale',
  'Harriet Corbett', 'Harriet Hunt', 'Catriona Redfern',
  'Alastair Waite', 'Marcus Drummond',
  'Julian Barlow', 'Bob Dobson', 'Piers Ravenscroft'
];
const COSI_TWO_LINES = [
  'Jeanette Birch', 'Kim Shelton',
  'Delphine Weston', 'Marianne Page',
  'Bridget Tilley', 'Hazel Baines',
  'Joyce Farrow', 'Meera Hale',
  'Harriet Corbett', 'Harriet Hunt',
  'Catriona Redfern', 'Alastair Waite',
  'Omar Pickering', 'Marcus Drummond',
  'Seb Laing', 'Julian Barlow',
  'Bob Dobson', 'Gavin Whitaker',
  'Piers Ravenscroft', 'Winston Kerr'
];
const COSI_ONE_LINE = [
  'Jeanette Birch', 'Kim Shelton', 'Delphine Weston', 'Marianne Page',
  'Bridget Tilley', 'Hazel Baines', 'Joyce Farrow', 'Meera Hale',
  'Harriet Corbett', 'Harriet Hunt', 'Catriona Redfern', 'Alastair Waite',
  'Marcus Drummond', 'Omar Pickering', 'Seb Laing', 'Julian Barlow',
  'Gavin Whitaker', 'Bob Dobson', 'Piers Ravenscroft', 'Winston Kerr'
];
// Names to ids: a guest by their own id, anyone else through the roster.
const exampleIds = (names, guests = []) => {
  const guestId = new Map(guests.map((g) => [g.name, g.id]));
  const onRoster = withSingerIds({ roster: EXAMPLE_PEOPLE, seats: names.map((n) => (guestId.has(n) ? EMPTY : n)), pins: [] }).seats;
  return names.map((n, i) => guestId.get(n) || onRoster[i]);
};
const wings = (splitCol) => ({ enterFrom: 'both', splitCol }); // normaliseWalkOn completes the rest

// The shipped example concerts, all over EXAMPLE_ROSTER. `members` lists who from the roster sings
// it (omitted: everyone), `guests` who else does; each plan is one seating.
export const EXAMPLE_CONCERTS = [
  {
    name: "Schnittke's Concerto for Choir",
    splits: EXAMPLE_SPLITS,
    plans: [
      { name: 'Option 1', rows: EXAMPLE_ROWS, cols: EXAMPLE_COLS, seats: EXAMPLE_SEATS },
      { name: 'Option 2', rows: EXAMPLE_ROWS, cols: EXAMPLE_COLS, seats: EXAMPLE_SEATS_2 }
    ]
  },
  {
    name: 'Così fan tutte',
    splits: EXAMPLE_SPLITS.filter((s) => s.id === '2way'),
    members: exampleIds(COSI_MEMBERS),
    guests: COSI_GUESTS,
    plans: [
      { name: 'Two lines', rows: 2, cols: 10, seats: exampleIds(COSI_TWO_LINES, COSI_GUESTS), walkOn: wings(3) },
      { name: 'One line', rows: 1, cols: 20, seats: exampleIds(COSI_ONE_LINE, COSI_GUESTS), walkOn: wings(7) }
    ]
  }
];

/* ---------- clone helpers ---------- */
export function cloneSplits(arr) {
  return arr.map((s) => ({ id: s.id, name: s.name, cats: s.cats.slice() }));
}
// clone a roster under the given split ids (SCH). The `id` rides at the front, because
// it is the record's primary key: a clone that dropped it would strand every chair,
// every pin and every bench entry that names this person.
export function cloneRoster(roster, SCH) {
  return roster.map((p) => {
    const o = { id: p.id, name: p.name, section: p.section };
    SCH.forEach((id) => (o[id] = p[id]));
    return o;
  });
}

/* ---------- colour helpers ---------- */
export function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255,
    g = parseInt(hex.slice(3, 5), 16) / 255,
    b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}
export function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}
// sRGB and CIE Lab (D65). The palette tools and tests import these from here, so there is one copy.
export const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export const hexToLin = (hex) => [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / 255));
export const linToHex = (v) =>
  '#' + v.map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255).toString(16).padStart(2, '0')).join('');
const WHITE_POINT = [0.95047, 1.0, 1.08883];
export function labOf(hex) {
  const [r, g, b] = hexToLin(hex);
  const xyz = [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b
  ];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = xyz.map((v, i) => f(v / WHITE_POINT[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function lchHue(hex) {
  const [, a, b] = labOf(hex);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}
// An out-of-gamut colour keeps its lightness and hue and sheds chroma until it fits sRGB.
export function lchToHex(L, C, h) {
  const fy = (L + 16) / 116;
  const inv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const rad = (h * Math.PI) / 180;
  for (let c = C; ; c = Math.max(0, c - 1)) {
    const X = inv(fy + (c * Math.cos(rad)) / 500) * WHITE_POINT[0];
    const Y = inv(fy) * WHITE_POINT[1];
    const Z = inv(fy - (c * Math.sin(rad)) / 200) * WHITE_POINT[2];
    const lin = [
      3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
      -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
      0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z
    ];
    if (c === 0 || lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) return linToHex(lin);
  }
}
// A readable wash of a colour for the seat-cell fills: keeps the hue, forces the lightness,
// and clamps the saturation into a band. Retuned 2026-09-04 from L 0.78 / S 0.55-0.85.
//
// THE TWO CONSTANTS ARE THE WHOLE SECTION PALETTE. Every section colour reaches the largest
// coloured surface in the app through here, and lightness is DISCARDED on the way, so
// retuning a section's own lightness changes nothing here — these numbers are the only
// lever, and they move all four sections together.
//
// Why 0.74 and 0.75-0.95 rather than the old 0.78 and 0.55-0.85: at L 0.78 the four fills
// were too light to tell apart, and blue and purple in particular converge as lightness
// rises (Alto/Tenor sat at ΔE 14.7, where every other pair was 20+). The fix is CHROMA, not
// darkness. Raising saturation and dropping lightness only slightly takes Alto/Tenor to 17.8
// while keeping the two things the fill has to stay out of the way of:
//
//   singer name (#11203a on the fill)   7.53:1 -> 5.98:1   floor is WCAG AA 4.5:1
//   split frame against the fill        16.3   -> 13.2
//
// Going darker instead was measured and rejected: L 0.66 buys 1.7 more section separation
// and costs 2.5 of frame contrast, dropping the name to 4.57:1, a hair above the floor.
// Since the frames are the thing the fill exists to sit behind, that is the wrong trade.
//
// NOTE all four section saturations now fall outside this band (Soprano 1.00 clamps down to
// 0.95; Alto 0.69, Tenor 0.60 and Bass 0.58 all clamp up to 0.75), so in practice the fill
// is a pure function of HUE for every section. That is what makes the section hues the
// identity and everything else about SECTION_COLOR free for text contrast.
export function tint(hex) {
  const { h, s } = hexToHsl(hex);
  return hslToHex(h, Math.max(Math.min(s, 0.95), 0.75), 0.74);
}
// a bold, saturated version of a section colour, for section-coloured frames and borders
export function bolden(hex) {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, Math.min(1, s + 0.25), Math.min(l, 0.5));
}

// build the derived split globals from SPLITS; CAT_INDEX[split][cat] is a position that splitFrame() colours per section.
export function deriveSplitGlobals(splits) {
  const SCH = splits.map((s) => s.id);
  const SCH_LABEL = {}, SPLIT_OPTIONS = {}, CAT_INDEX = {};
  splits.forEach((s) => {
    SCH_LABEL[s.id] = s.name;
    SPLIT_OPTIONS[s.id] = s.cats.slice();
    CAT_INDEX[s.id] = {};
    s.cats.forEach((c, i) => (CAT_INDEX[s.id][c] = i));
  });
  return { SCH, SCH_LABEL, SPLIT_OPTIONS, CAT_INDEX };
}

/* ---------- pure grid helpers ---------- */
export function gridCols(len, rows) {
  return Math.max(1, Math.ceil(len / rows));
}
// 4-neighbour adjacency on a column-major grid (front/back within a column, left/right to
// the adjacent columns). The global grid uses off=0; the per-section solver passes the
// section's stage offset so its isolated sub-grid wraps columns exactly as it will once
// packed onto the real stage.
export function neighboursOf(i, len, rows, off = 0) {
  const row = (off + i) % rows, out = [];
  if (row > 0) out.push(i - 1); // front
  if (row < rows - 1) out.push(i + 1); // back
  out.push(i - rows); // left
  out.push(i + rows); // right
  return out.filter((j) => j >= 0 && j < len);
}
// (row, col) of a flat index and back, for code that thinks in stage terms. Row 0 is the front.
export const rowOf = (i, rows) => i % rows;
export const colOf = (i, rows) => Math.floor(i / rows);
export const idxOf = (row, col, rows) => col * rows + row;
// Cells in serpentine reading order: front row left to right, the next row right to left, and so
// on, so each cell is beside the one before it and the row changes at a corner. `cells` are
// indices into a slice that starts `off` cells into a stage of `rows` rows.
export function snakeOrder(cells, rows, off = 0) {
  const key = (l) => {
    const r = rowOf(off + l, rows), c = colOf(off + l, rows);
    return [r, r % 2 ? -c : c];
  };
  return cells.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  });
}
/* ---------- walk-on order ---------- */
/*
 * The request: a list singers can line up against, for
 * choirs who do not know each other or the stage. The order cannot be inferred from the seating
 * (some risers are walked on in reverse depending on which side of the aisle you sit), so the
 * user is asked, and this turns their answer into queues.
 *
 * THE ONE TRAP. `seats` is column-major, so walking the array in index order walks COLUMNS,
 * front to back, then the next column. Nobody files onto a stage that way. A walk-on order is
 * row-major and the generator below iterates (row, col) explicitly; it never reuses the array's
 * own order. Getting this wrong produces a list that is entirely plausible and entirely wrong.
 *
 * A QUEUE is a physical line of people waiting in a wing. `left` and `right` give one queue,
 * `both` gives two that converge on the aisle. Numbering is PER QUEUE and restarts at 1, because
 * two lines forming backstage count themselves independently and a global 1..N across both is a
 * number that looks authoritative and means nothing.
 *
 * DIRECTION WITHIN A ROW IS AWAY FROM THE ENTRY: the first person on walks furthest, so nobody
 * squeezes past somebody already standing. Queue L (entering from the left wing) therefore fills
 * right to left and queue R left to right, which makes the two halves of a `both` row mirror each
 * other and fill from the aisle outward. That is the request's "some in order and others in reverse"
 * expressed as one rule rather than as two settings the user has to keep in step.
 */
export const WALKON_OPTIONS = Object.freeze({
  rowFrom: ['back', 'front'], // which physical row is walked first
  enterFrom: ['left', 'right', 'both'] // which wing (or wings) the choir comes from
});
// A user opening the walk-on list sees a working order and corrects it, rather than an empty form.
//
// `perRow[r]` overrides `enterFrom` for one row (null: no override). `rowSeq` is the order the rows
// are walked in, as physical row indexes front-first, when the user has set one; null means the
// order `rowFrom` gives.
export const WALKON_DEFAULTS = Object.freeze({
  rowFrom: 'back',
  enterFrom: 'left',
  perRow: [],
  rowSeq: null,
  splitCol: null
});
// The deepest stage the app allows. That bound is ROWS_MAX in utils/persistence.js, which imports
// from this module, so it is mirrored here rather than imported back.
const PER_ROW_MAX = 8;

/**
 * Coerce anything claiming to be a walk-on block into a complete, legal one, field by field: a
 * plan can arrive from a backup written by any version of the app, or hand-edited, so one bad
 * field must not cost the others.
 *
 * `perRow` entries are normalised to a legal direction or to `null`, which means "this row has no
 * override, use `enterFrom`". `rowSeq` must be distinct row indexes, or it is dropped.
 */
export function normaliseWalkOn(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const dir = (v) => (WALKON_OPTIONS.enterFrom.includes(v) ? v : null);
  const perRow = Array.isArray(src.perRow) ? src.perRow.slice(0, PER_ROW_MAX).map(dir) : [];
  // trailing nulls carry no information and would otherwise grow the saved plan forever.
  while (perRow.length && perRow[perRow.length - 1] == null) perRow.pop();
  const seq = Array.isArray(src.rowSeq) ? src.rowSeq : null;
  const rowSeq =
    seq && seq.length && seq.length <= PER_ROW_MAX && seq.every((r) => Number.isInteger(r) && r >= 0 && r < PER_ROW_MAX) && new Set(seq).size === seq.length
      ? seq.slice()
      : null;
  return {
    rowFrom: WALKON_OPTIONS.rowFrom.includes(src.rowFrom) ? src.rowFrom : WALKON_DEFAULTS.rowFrom,
    enterFrom: dir(src.enterFrom) || WALKON_DEFAULTS.enterFrom,
    perRow,
    rowSeq,
    splitCol: Number.isFinite(src.splitCol) && src.splitCol >= 0 ? Math.floor(src.splitCol) : null
  };
}

/**
 * The order the rows of a `rows`-deep stage are walked in: `rowSeq` where the user has set one,
 * else back to front or front to back as `rowFrom` says. A `rowSeq` written for a different depth
 * keeps the rows it names that still exist, in its order, and the rest follow in `rowFrom` order.
 * @returns {number[]} physical row indexes, front-first numbering
 */
export function walkRowSequence(walkOn, rows) {
  const w = normaliseWalkOn(walkOn);
  const base = Array.from({ length: Math.max(0, rows) }, (_, k) => (w.rowFrom === 'back' ? rows - 1 - k : k));
  if (!w.rowSeq) return base;
  const seq = w.rowSeq.filter((r) => r < rows);
  for (const r of base) if (!seq.includes(r)) seq.push(r);
  return seq;
}

/**
 * The columns that are blocked from front to back, for the 5.2 "put the aisle here" suggestion.
 * A convenience on top of `splitCol`, never the source of truth for it: blocked cells are placed
 * one at a time and almost never line up into a column, and neither shipped preset contains a
 * single one.
 * @returns {number[]} stored column indices, ascending
 */
export function blockedColumns(seats, rows, cols) {
  if (!Array.isArray(seats) || !Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) return [];
  const out = [];
  for (let c = 0; c < cols; c++) {
    let all = true;
    for (let r = 0; r < rows && all; r++) all = isBlocked(seats[c * rows + r]);
    if (all) out.push(c);
  }
  return out;
}

/**
 * The walk-on order: pure, taking the whole state as arguments, like makeEngine above.
 *
 * @param {Array} seats   the column-major grid, AS NAMES — seatNames(seats, byId). The walk-on
 *                        list is a list of people to hand to a steward, so the one conversion
 *                        happens before the generator rather than inside every consumer of it;
 *                        `walkOnFor()` in utils/walkOnList.js is the call site that does it, and
 *                        the only one. Nothing here inspects a cell beyond isSinger(), so this
 *                        is purely about what ends up in `name`.
 * @param {number} rows   grid depth (row 0 is the FRONT row)
 * @param {number} cols   grid width (column 0 is the audience's left)
 * @param {object} walkOn the block from 3.1; anything invalid falls back to the defaults
 * @returns {{
 *   queues: { L: Array<{ position: number, name: string, row: number, col: number, seatIndex: number }>,
 *             R: Array<object> },
 *   split: number,
 *   rowOrder: Array<{ row: number, mode: string }>
 * }}
 *
 * The entries carry no `section`: a singer's section is a property of their roster record and
 * never a function of where they sit (see the data-model note at the top of this file), so a
 * consumer that wants it looks the person up in `byId`. That also keeps this signature down to
 * the geometry, which is all the ordering depends on.
 *
 * `split` is the aisle column actually used and `rowOrder` the per-row decisions actually taken,
 * both returned so the preview draws the generator's own reasoning instead of recomputing it and
 * drifting from the list it sits beside.
 */
export function walkOnOrder(seats, rows, cols, walkOn) {
  const w = normaliseWalkOn(walkOn);
  const queues = { L: [], R: [] };
  const rowOrder = [];
  if (!Array.isArray(seats) || !Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1)
    return { queues, split: 0, rowOrder };

  // `split` is the last column of the left half; null means auto-centre, which halves an even
  // width exactly and gives an odd width's extra column to the left. A user-set aisle is clamped
  // short of the last column, here as well as in resizeGrid, because a generator that throws away
  // a stale value is cheaper than one that can emit a one-sided list.
  const split = w.splitCol == null ? Math.ceil(cols / 2) - 1 : Math.max(0, Math.min(cols - 2, w.splitCol));

  const emit = (r, c, q) => {
    const i = c * rows + r;
    const name = seats[i];
    // blocked and empty cells emit nothing AND CONSUME NO POSITION: a gap in the risers is not a
    // person, and a printed list that counts one is wrong for everybody after it.
    if (!isSinger(name)) return;
    queues[q].push({ position: queues[q].length + 1, name, row: r, col: c, seatIndex: i });
  };

  for (const r of walkRowSequence(w, rows)) {
    // `perRow` is indexed front-first, matching the internal row index. The labelling's `rowFirst` is
    // cosmetic and must never reach this.
    const mode = w.perRow[r] || w.enterFrom;
    rowOrder.push({ row: r, mode });
    if (mode === 'left') for (let c = cols - 1; c >= 0; c--) emit(r, c, 'L');
    else if (mode === 'right') for (let c = 0; c < cols; c++) emit(r, c, 'R');
    else {
      for (let c = split; c >= 0; c--) emit(r, c, 'L');
      for (let c = split + 1; c < cols; c++) emit(r, c, 'R');
    }
  }
  return { queues, split, rowOrder };
}
// small seeded PRNG so Auto-arrange is reproducible.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/*
 * makeEngine(g) — bind the stateful solver to a context.
 * g = { DATA, byId, SCH, seats, pinned, order }
 *   DATA    : array of singers { id, name, section, <splitId>: cat, ... }
 *   byId    : map id -> singer (rosterById)
 *   SCH     : ordered split ids
 *   seats   : the single seating array [id | EMPTY | BLOCKED]
 *   pinned  : Set of pinned singer IDS
 *   order   : left-to-right section precedence (defaults to STAGE_ORDER)
 *
 * The solver works entirely in ids: every list it returns — `stranded`, the
 * overflow from arrangeAll, `lateralIsolated2D` — is a list of ids, and a caller that wants to
 * show one to a person resolves it through `byId` (or through seatNames() for a whole grid). The
 * grouping is by RESOLVED section and split, never by the key's own shape, so the arrangement it
 * produces for a given roster is identical to the one it produced when the key was a name.
 */
export function makeEngine(g) {
  const { DATA, byId, SCH, seats, pinned } = g;
  const order = g.order || STAGE_ORDER;

  // Bucket sizes per split, counted over the whole choir. DATA does not change for the life
  // of an engine, and evaluate2D is called thousands of times per solve, so build each map
  // once instead of walking DATA on every call.
  const sizeCache = new Map();
  function sizesFor(split) {
    let sizeOf = sizeCache.get(split);
    if (sizeOf) return sizeOf;
    sizeOf = {};
    DATA.forEach((p) => {
      const k = p.section + ' ' + p[split];
      sizeOf[k] = (sizeOf[k] || 0) + 1;
    });
    sizeCache.set(split, sizeOf);
    return sizeOf;
  }

  const atomKeyOf = (id) => SCH.map((s) => byId[id][s]).join('|');

  // A singer's group for one `split`. One definition, shared by evaluate2D and
  // lateralIsolated2D, so the two lists cannot disagree about what a group is.
  const groupKeyOf = (id, split) => byId[id].section + ' ' + byId[id][split];

  // group a list of singer ids into atoms (same split-category tuple across every split).
  function atomsFromMembers(ids) {
    const m = new Map();
    for (const n of ids) {
      const k = atomKeyOf(n);
      if (!m.has(k)) m.set(k, { key: k, members: [] });
      m.get(k).members.push(n);
    }
    return [...m.values()];
  }
  // a deterministic seed order for a set of members: atoms grouped (lexicographic by their
  // category tuple) so same-category singers start adjacent, in storage (column) order: the
  // candidate beside the snake in solveBlock, and the order arrangeAll pours each block in.
  function seedOrder(ids) {
    return atomsFromMembers(ids)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .flatMap((a) => a.members);
  }
  // The same atoms as seedOrder, in a PATH order: sorted by the first split, and within that by
  // the next, but every other block runs backwards (1-1 1-2 | 2-2 2-1 | …). Neighbouring atoms
  // then share a category wherever they can, so a second split that cuts across the first meets
  // itself at the block boundaries instead of being scattered.
  function pathOrder(ids) {
    const atoms = atomsFromMembers(ids);
    const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    const walk = (list, depth, reversed) => {
      if (depth === SCH.length || list.length <= 1) return list;
      const split = SCH[depth], cats = new Map();
      for (const a of list) {
        const c = byId[a.members[0]][split];
        if (!cats.has(c)) cats.set(c, []);
        cats.get(c).push(a);
      }
      const keys = [...cats.keys()].sort(cmp);
      if (reversed) keys.reverse();
      return keys.flatMap((c, n) => walk(cats.get(c), depth + 1, n % 2 === 1));
    };
    return walk(atoms, 0, false).flatMap((a) => a.members);
  }

  // Evaluate one grouping over the grid. A singer's group is their SECTION together with
  // their label for `split` (pass split = SECTION_KEY to check section adjacency itself), so
  // a 1B soprano and a 1B alto are different groups. Bucket sizes are counted across the
  // whole choir (DATA), so a singer separated from same-group members elsewhere is flagged
  // rather than excused as an unpairable singleton. EMPTY and BLOCKED cells are skipped but
  // still occupy a grid position, so they break adjacency. Returns:
  //   stranded : ids with no same-group grid neighbour
  //   broken   : { sec, lab } groups that exist in more than one disconnected component
  function evaluate2D(seq, rows, split, off = 0) {
    const labOf = (n) => byId[n][split];
    const groupOf = (n) => groupKeyOf(n, split);
    const sizeOf = sizesFor(split);

    const stranded = [];
    seq.forEach((n, i) => {
      if (!isSinger(n)) return;
      const k = groupOf(n);
      if (sizeOf[k] <= 1) return;
      const ok = neighboursOf(i, seq.length, rows, off).some((j) => isSinger(seq[j]) && groupOf(seq[j]) === k);
      if (!ok) stranded.push(n);
    });

    const broken = [];
    const seen = new Array(seq.length).fill(false);
    for (let start = 0; start < seq.length; start++) {
      if (seen[start]) continue;
      if (!isSinger(seq[start])) {
        seen[start] = true;
        continue;
      }
      const k = groupOf(seq[start]);
      const stack = [start];
      seen[start] = true;
      let count = 0;
      while (stack.length) {
        const i = stack.pop();
        count++;
        for (const j of neighboursOf(i, seq.length, rows, off))
          if (!seen[j] && isSinger(seq[j]) && groupOf(seq[j]) === k) {
            seen[j] = true;
            stack.push(j);
          }
      }
      if (count < sizeOf[k] && sizeOf[k] > 1) {
        const sec = byId[seq[start]].section, lab = labOf(seq[start]);
        if (!broken.some((b) => b.sec === sec && b.lab === lab)) broken.push({ sec, lab });
      }
    }
    return { broken, stranded };
  }

  // Lateral company only. Returns the ids of singers who DO have a same-group
  // neighbour in front or behind them but none to their left or right: a one-person-wide
  // column of their part. The grouping, the whole-choir bucket sizes and the singleton
  // excusal are exactly `evaluate2D`'s, and the offset convention is `neighboursOf`'s, so a
  // slice handed over by `solveBlock` reports the laterals it will have once packed
  // onto the real stage. Left/right are bounds-clipped only, never wrapped, exactly as
  // `neighboursOf` clips them, so a column at either end of `seq` simply has no company on
  // that side; there is no second clip here.
  //
  // Disjoint from `evaluate2D`'s `stranded` BY CONSTRUCTION: an id is only listed here if
  // it has a same-group neighbour front or behind, and a stranded singer has none in any
  // direction. So the report can show both lists without naming anybody twice.
  function lateralIsolated2D(seq, rows, split, off = 0) {
    const groupOf = (n) => groupKeyOf(n, split);
    const sizeOf = sizesFor(split);

    const out = [];
    seq.forEach((n, i) => {
      if (!isSinger(n)) return;
      const k = groupOf(n);
      if (sizeOf[k] <= 1) return; // a category of one is excused, as evaluate2D excuses it
      const row = (off + i) % rows;
      const mate = (j) => j >= 0 && j < seq.length && isSinger(seq[j]) && groupOf(seq[j]) === k;
      const beside = mate(i - rows) || mate(i + rows); // left / right: the adjacent columns
      const along = (row > 0 && mate(i - 1)) || (row < rows - 1 && mate(i + 1)); // front / back
      if (!beside && along) out.push(n);
    });
    return out;
  }

  /*
   * The cost of a slice, kept up to date across swaps instead of recomputed. The search tries
   * thousands of swaps, and recomputing the whole grid for each made a solve O(n³). A swap of
   * cells i and j can only change:
   *   - stranded / lateral status of i, j and their four neighbours each;
   *   - `broken` for the (at most two) groups, per split, that i and j belong to;
   *   - vertical spread for their (at most two) labels, per split;
   *   - fragmentation for their (at most two) atoms.
   * so that is all `swap` re-scores. Everything is counted in integers, which makes a total
   * independent of the order it was summed in.
   *
   * `score()` returns the cost tiers, summed over `keys` (the splits):
   *   stranded  singers with no group-mate beside, in front or behind (a group of one is excused)
   *   broken    pieces each group is in, beyond the first
   *   lateral   singers whose only group-mates are in front or behind
   *   soft      tidy-ups: each label's spread over rows (×10, so rows count more), plus atoms
   *             (singers alike in every split) that are in more than one piece
   * `better()` below says how two scores compare.
   */
  function makeScorer(seq, rows, keys, off = 0) {
    const L = seq.length, K = keys.length;
    const rowAt = new Int32Array(L);
    for (let i = 0; i < L; i++) rowAt[i] = (off + i) % rows;
    const nbrs = [];
    for (let i = 0; i < L; i++) nbrs.push(neighboursOf(i, L, rows, off));

    // Everything the hot loops compare is a small integer, interned here once: per split, a
    // group number and a label number for each cell's occupant, and an atom number (-1 for EMPTY
    // and BLOCKED). The strings are only ever built in this setup.
    const intern = () => {
      const m = new Map();
      return (key) => {
        let n = m.get(key);
        if (n === undefined) m.set(key, (n = m.size));
        return n;
      };
    };
    const gNum = keys.map(intern), lNum = keys.map(intern), aNum = intern();
    const G = keys.map(() => new Int32Array(L).fill(-1)), LB = keys.map(() => new Int32Array(L).fill(-1));
    const AT = new Int32Array(L).fill(-1);
    const gSize = keys.map(() => []);
    for (let i = 0; i < L; i++) {
      const id = seq[i];
      if (!isSinger(id)) continue;
      for (let k = 0; k < K; k++) {
        const gk = groupKeyOf(id, keys[k]);
        G[k][i] = gNum[k](gk);
        gSize[k][G[k][i]] = sizesFor(keys[k])[gk];
        LB[k][i] = lNum[k](byId[id][keys[k]]);
      }
      AT[i] = aNum(atomKeyOf(id));
    }

    // Where every group and atom is, and how many of each label sit in each row.
    const gPos = keys.map(() => []), lRows = keys.map(() => []), aPos = [];
    const setOf = (arr, n) => arr[n] || (arr[n] = new Set());
    const rowsOf = (k, l) => lRows[k][l] || (lRows[k][l] = new Int32Array(rows));
    const place = (i, add) => {
      if (AT[i] < 0) return;
      for (let k = 0; k < K; k++) {
        if (add) setOf(gPos[k], G[k][i]).add(i);
        else gPos[k][G[k][i]].delete(i);
        rowsOf(k, LB[k][i])[rowAt[i]] += add ? 1 : -1;
      }
      if (add) setOf(aPos, AT[i]).add(i);
      else aPos[AT[i]].delete(i);
    };
    for (let i = 0; i < L; i++) place(i, true);

    // 0 fine, 1 lateral (company only in front/behind), 2 stranded, for one cell and split.
    function cellState(k, i) {
      const Gk = G[k], g = Gk[i];
      if (g < 0 || gSize[k][g] <= 1) return 0;
      if ((i - rows >= 0 && Gk[i - rows] === g) || (i + rows < L && Gk[i + rows] === g)) return 0;
      const r = rowAt[i];
      return (r > 0 && Gk[i - 1] === g) || (r < rows - 1 && Gk[i + 1] === g) ? 1 : 2;
    }
    // Connected pieces of the cells in `pos`, where `arr[cell] === v` says who belongs.
    const stamp = new Int32Array(L);
    let tick = 0;
    function pieces(pos, arr, v) {
      tick++;
      let n = 0;
      const stack = [];
      for (const s of pos) {
        if (stamp[s] === tick) continue;
        n++;
        stamp[s] = tick;
        stack.push(s);
        while (stack.length) {
          const nb = nbrs[stack.pop()];
          for (let x = 0; x < nb.length; x++) {
            const j = nb[x];
            if (stamp[j] !== tick && arr[j] === v) {
              stamp[j] = tick;
              stack.push(j);
            }
          }
        }
      }
      return n;
    }
    // How broken a group is: its pieces beyond the first, plus one if some of it is outside the
    // slice. Counting pieces rather than "broken or not" lets the search see progress when a swap
    // joins three pieces into two, which a yes/no count scores as no change.
    function groupBroken(k, g) {
      const size = gSize[k][g], pos = gPos[k][g];
      if (size <= 1 || !pos || !pos.size) return 0;
      return pieces(pos, G[k], g) - 1 + (pos.size < size ? 1 : 0);
    }
    function labSpread(k, l) {
      const r = lRows[k][l];
      if (!r) return 0;
      let lo = -1, hi = -1;
      for (let x = 0; x < rows; x++) if (r[x]) {
        if (lo < 0) lo = x;
        hi = x;
      }
      return lo < 0 ? 0 : hi - lo;
    }
    function atomSplit(a) {
      const pos = aPos[a];
      return pos && pos.size && pieces(pos, AT, a) > 1 ? 1 : 0;
    }

    let stranded = 0, broken = 0, lateral = 0, spread = 0, atoms = 0;
    const addCell = (k, i, sign) => {
      const st = cellState(k, i);
      if (st === 2) stranded += sign;
      else if (st === 1) lateral += sign;
    };
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < L; i++) addCell(k, i, 1);
      gPos[k].forEach((_, g) => (broken += groupBroken(k, g)));
      lRows[k].forEach((_, l) => (spread += labSpread(k, l)));
    }
    aPos.forEach((_, a) => (atoms += atomSplit(a)));

    // The cells whose state a swap of i and j can change: i, j and their neighbours.
    const touched = [];
    const touch = (c) => {
      if (!touched.includes(c)) touched.push(c);
    };
    // What a swap of i and j can touch, measured with sign -1 before and +1 after.
    function account(i, j, sign, ks, atomsToo) {
      for (const k of ks) {
        for (const c of touched) addCell(k, c, sign);
        const gi = G[k][i], gj = G[k][j];
        if (gi >= 0) broken += sign * groupBroken(k, gi);
        if (gj >= 0 && gj !== gi) broken += sign * groupBroken(k, gj);
        if (rowAt[i] !== rowAt[j]) {
          const li = LB[k][i], lj = LB[k][j];
          if (li >= 0) spread += sign * labSpread(k, li);
          if (lj >= 0 && lj !== li) spread += sign * labSpread(k, lj);
        }
      }
      if (atomsToo) {
        if (AT[i] >= 0) atoms += sign * atomSplit(AT[i]);
        if (AT[j] >= 0 && AT[j] !== AT[i]) atoms += sign * atomSplit(AT[j]);
      }
    }
    const exchange = (arr, i, j) => {
      const v = arr[i];
      arr[i] = arr[j];
      arr[j] = v;
    };
    const ks = [];
    function swap(i, j) {
      if (seq[i] === seq[j]) return;
      // Splits in which i and j hold the same group and label change nothing, so they are skipped.
      ks.length = 0;
      for (let k = 0; k < K; k++) if (G[k][i] !== G[k][j] || LB[k][i] !== LB[k][j]) ks.push(k);
      const atomsToo = AT[i] !== AT[j];
      if (ks.length || atomsToo) {
        touched.length = 0;
        touch(i);
        touch(j);
        nbrs[i].forEach(touch);
        nbrs[j].forEach(touch);
        account(i, j, -1, ks, atomsToo);
        place(i, false);
        place(j, false);
      }
      exchange(seq, i, j);
      for (let k = 0; k < K; k++) {
        exchange(G[k], i, j);
        exchange(LB[k], i, j);
      }
      exchange(AT, i, j);
      if (ks.length || atomsToo) {
        place(i, true);
        place(j, true);
        account(i, j, 1, ks, atomsToo);
      }
    }
    const score = () => ({ stranded, broken, lateral, soft: spread * 10 + atoms });
    return { seq, swap, score };
  }
  /*
   * The cost is compared TIER BY TIER, never as a weighted sum: fewer stranded singers always
   * wins, then fewer broken groups, then fewer singers with nobody beside them, then the soft
   * tidy-ups. Laterals were tried as a weighted term and it broke groups, because one swap
   * that fixes two laterals outweighed one broken group. Compared in tiers, no swap can buy
   * lateral company with a broken group, whatever the numbers.
   */
  const TIERS = ['stranded', 'broken', 'lateral', 'soft'];
  // The first pass leaves laterals out: groups are made whole first, with the vertical-spread
  // tie-break pulling each category into as few rows as it can. That is what lets groups join up
  // at all. Chasing laterals from the start walks the search into corners it cannot unbreak.
  const WHOLE_FIRST = ['stranded', 'broken', 'soft'];
  function better(a, b, tiers = TIERS) {
    for (const t of tiers) if (a[t] !== b[t]) return a[t] < b[t];
    return false;
  }
  const WORST = { stranded: Infinity, broken: Infinity, lateral: Infinity, soft: Infinity };

  // greedy local search: swap any two non-fixed seats while it lowers the cost.
  function polish(seq, rows, fixed = null, keys = [SECTION_KEY, ...SCH], off = 0, tiers = TIERS) {
    const sc = makeScorer(seq.slice(), rows, keys, off);
    const cur = sc.seq;
    const free = [];
    for (let i = 0; i < cur.length; i++) if (!(fixed && fixed.has(i))) free.push(i);
    let curCost = sc.score();
    let improved = true, guard = 0;
    while (improved && guard++ < 500) {
      improved = false;
      // one full sweep applies every improving swap it finds (first-improvement), then we
      // repeat until a whole sweep changes nothing — far fewer cost evaluations than
      // restarting the scan after each individual swap.
      for (let a = 0; a < free.length; a++) {
        const i = free[a];
        for (let b = a + 1; b < free.length; b++) {
          const j = free[b];
          if (cur[i] === cur[j]) continue;
          sc.swap(i, j);
          const c = sc.score();
          if (better(c, curCost, tiers)) {
            curCost = c;
            improved = true;
          } else sc.swap(i, j);
        }
      }
    }
    return { seq: cur, score: sc.score() };
  }

  /*
   * Simulated annealing, the first pass. `polish` only ever takes a swap that helps, so it stops in
   * the first dip it reaches, and joining a broken group up often needs a move or two that first
   * make things worse. Annealing tries random swaps and takes a worse one with a probability that
   * shrinks as the "temperature" falls: early on it can climb out of a shallow dip, later it only
   * goes downhill. The randomness comes from the seeded `rng`, so the result is still repeatable.
   * It returns the best arrangement it passed through, and `polish` finishes from there.
   *
   * The energy is a weighted sum because annealing needs a size for "how much worse", so here,
   * and only here, a lateral could be bought with a broken group. It is weighted low for that
   * reason, and whatever annealing hands on is then polished and chosen between tier by tier, so
   * a candidate that did make that trade loses to one that did not.
   */
  const ANNEAL_RUNS = 4, ANNEAL_STEPS_PER_MEMBER = 400;
  const energy = (s) => s.stranded * 30 + s.broken * 10 + s.lateral + s.soft / 10;
  function anneal(seq, rows, fixed, keys, off, rng, steps) {
    const sc = makeScorer(seq.slice(), rows, keys, off);
    const cur = sc.seq;
    const free = [];
    for (let i = 0; i < cur.length; i++) if (!(fixed && fixed.has(i))) free.push(i);
    if (free.length < 2) return cur;
    let e = energy(sc.score()), bestE = e, best = cur.slice();
    const T0 = 8, T1 = 0.05;
    for (let step = 0; step < steps; step++) {
      const T = T0 * Math.pow(T1 / T0, step / steps);
      const i = free[Math.floor(rng() * free.length)], j = free[Math.floor(rng() * free.length)];
      if (cur[i] === cur[j]) continue;
      sc.swap(i, j);
      const e2 = energy(sc.score());
      if (e2 <= e || rng() < Math.exp((e - e2) / T)) {
        e = e2;
        if (e < bestE) {
          bestE = e;
          best = cur.slice();
        }
      } else sc.swap(i, j);
    }
    return best;
  }

  /*
   * A BLOCK is a set of singers the stage keeps together: today, one per section, in stage order
   * (`sectionBlock`). Blocks are laid down one after another (arrangeAll: "sort each section, then
   * smush them together") and each is solved on its own over its span. Nothing below knows that
   * a block is a section, so a block can be any set with a stable `key`: a semichorus becomes a
   * block of its own members, with the rest of each section a block beside it. (The group key the
   * scorer uses is still section + category; a semichorus with its own divisi needs that widened.)
   */
  const sectionBlock = (sec) => ({ key: sec, has: (id) => byId[id].section === sec });

  // Solve one block over its SPAN on the real grid — the slice from its first to its last
  // member's seat. That slice is small (≈ section size) and self-contained: EMPTY/BLOCKED cells and
  // any pinned/foreign seat woven through it are held in place, the block's own members are
  // reordered around them, and the slice is solved with its real stage offset so column wrap
  // matches the live grid exactly. Cheap (cost is over the slice, not all 80 seats) and
  // correct around spaces — which is where the old "one offset, contiguous block" seed broke.
  // Tries the snake and the grouped column fill, then annealed runs, and keeps the best by tiers.
  function solveBlock(cur, rows, block, runs = ANNEAL_RUNS) {
    // span bounds include this block's pinned members too, so the solve sees and works
    // around them (they stay fixed); only the free members are reordered.
    const idxs = [];
    cur.forEach((n, i) => {
      if (isSinger(n) && byId[n] && block.has(n)) idxs.push(i);
    });
    if (idxs.filter((i) => !pinned.has(cur[i])).length <= 1) return cur;
    const start = idxs[0], end = idxs[idxs.length - 1];
    const sub = cur.slice(start, end + 1);
    const off = start % rows;
    // local slots the solver may fill: this section's free members. Everything else in the
    // slice (spaces, pins, a stray foreign member) is fixed at its position.
    const freeLocal = [], members = [];
    sub.forEach((n, l) => {
      if (isSinger(n) && !pinned.has(n) && block.has(n)) {
        freeLocal.push(l);
        members.push(n);
      }
    });
    const fixed = new Set();
    for (let l = 0; l < sub.length; l++) if (!freeLocal.includes(l)) fixed.add(l);
    const place = (orderArr, slots) => {
      const seq = sub.slice();
      slots.forEach((pos, k) => (seq[pos] = orderArr[k]));
      return seq;
    };
    // The first seed lays the section down ROW BY ROW, snaking, in path order: consecutive
    // singers sit beside each other, and a group that runs off the end of a row turns the corner
    // into the row behind still touching. (Storage order is column-major, so pouring people in
    // index order stacks every small group front-to-back in one column.)
    const snake = place(pathOrder(members), snakeOrder(freeLocal, rows, off));
    const rng = mulberry32(seedFromString('span|' + block.key + '|' + members.length + '|' + rows + '|' + off));
    // Every candidate ends the same way: make the groups whole, then look for company beside.
    const finish = (seq) => polish(polish(seq, rows, fixed, SCH, off, WHOLE_FIRST).seq, rows, fixed, SCH, off);
    let best = sub, bestCost = WORST;
    const consider = ({ seq, score }) => {
      if (better(score, bestCost)) {
        bestCost = score;
        best = seq;
      }
      return score.stranded === 0 && score.broken === 0 && score.lateral === 0;
    };
    // The two direct starts first (they are cheap and often enough), then annealed runs from
    // the snake, each with its own stretch of the seeded random stream.
    if (!consider(finish(snake)) && !consider(finish(place(seedOrder(members), freeLocal)))) {
      const steps = ANNEAL_STEPS_PER_MEMBER * members.length;
      // Another run only while a group is still broken or someone stranded: those are worth the
      // time, a lateral or two usually is not.
      for (let t = 0; t < runs; t++) {
        if (consider(finish(anneal(snake, rows, fixed, SCH, off, rng, steps)))) break;
        if (bestCost.stranded === 0 && bestCost.broken === 0) break;
      }
    }
    const out = cur.slice();
    for (let l = 0; l < best.length; l++) out[start + l] = best[l];
    return out;
  }

  // Auto-arrange the whole stage into the FIXED rows×cols grid. Works IN PLACE so nothing shifts
  // under a pin: pinned singers keep their exact cell and BLOCKED seats are never touched; only
  // the free cells are reassigned. The pool to seat is every non-pinned placed singer plus the
  // `waiting` list, ordered by section then split-seeded; they fill the earliest free cells and
  // any surplus free cells are left EMPTY. Each section is then optimised over its span. If the
  // pool is larger than the free cells, the leftover ids are returned as `overflow` (they stay
  // on the waiting bench). Returns { seats, overflow }.
  function arrangeAll(rows, cols, waiting = []) {
    const total = rows * cols;
    const cur = seats.slice(0, total);
    while (cur.length < total) cur.push(EMPTY);
    // frozen cells keep their exact grid index: pinned singers and blocked seats.
    const frozen = (i) => isBlocked(cur[i]) || (isSinger(cur[i]) && pinned.has(cur[i]));
    const freeCells = [];
    for (let i = 0; i < total; i++) if (!frozen(i)) freeCells.push(i);
    // pool = free placed singers + everyone waiting (de-duped, real singers only).
    const seen = new Set();
    const pool = [];
    freeCells.map((i) => cur[i]).concat(waiting).forEach((n) => {
      if (isSinger(n) && byId[n] && !seen.has(n)) {
        seen.add(n);
        pool.push(n);
      }
    });
    // section-grouped, split-seeded order of the pool. `order` is a permutation of all four
    // sections and every pool member's section is one of them, so this places the whole pool.
    const ordered = [];
    const blocks = order.map(sectionBlock);
    blocks.forEach((b) => seedOrder(pool.filter((n) => b.has(n))).forEach((n) => ordered.push(n)));
    const capacity = freeCells.length;
    const overflow = ordered.slice(capacity); // ids that won't fit — back to the bench
    const fill = ordered.slice(0, capacity);
    while (fill.length < capacity) fill.push(EMPTY); // surplus chairs stay empty
    freeCells.forEach((idx, k) => (cur[idx] = fill[k]));
    let out = cur;
    for (const b of blocks) out = solveBlock(out, rows, b);
    return { seats: out, overflow };
  }

  // Re-seat just one section in place; pins, empty/blocked seats and every other section stay put.
  function arrangeSection(rows, sec) {
    return solveBlock(seats.slice(), rows, sectionBlock(sec));
  }

  return { evaluate2D, lateralIsolated2D, arrangeAll, arrangeSection };
}
