/*
 * walkOnList: the pure half of the walk-on list and the seat badges.
 *
 * utils/arranger.js owns the ORDER — who walks on when, in which queue — because that is pure
 * geometry over the seating and belongs beside the rest of the grid logic. What is here is the
 * PRESENTATION of that order: how it groups into rows, what each group is called, what the
 * clipboard gets, and the badge each seat carries. The split is the same one
 * utils/seatPreview.js makes against utils/labels.js, and for the same reason: this half needs
 * the plan's labelling settings and the viewpoint, and the generator must not.
 *
 * Like utils/arranger.js, utils/labels.js and utils/seatPreview.js this is plain functions over
 * plain data, with no Vue and no DOM, so it is loadable by a bare `node` script and testable
 * under `node --test` (see test/walk-on.test.js).
 *
 * Two rules are load-bearing:
 *
 *  1. EVERY NAME OF A SEAT OR A ROW COMES FROM utils/labels.js. That module exists so that the
 *     stage, the printed plan, the exported spreadsheet and this list cannot disagree about
 *     which chair is which. Nothing here formats a label of its own.
 *
 *  2. THE ORDER IS PHYSICAL; THE DRAWING IS A VIEWPOINT. The viewpoint changes how seats are
 *     named and drawn, never who walks on when.
 */
import { seatNames, walkOnOrder } from './arranger.js';
import { rowLabelAt, seatLabelFor } from './labels.js';
import { normaliseAudienceAt } from './persistence.js';
import { NOT_SEATED } from './exportCsv.js';

// The two queues, in the order they are always presented, with the words used for each. "Enter
// from the left" is the entry-relative reading: the choir comes from the left wing
// and the row therefore fills right to left, because the first person on walks furthest.
export const QUEUE_KEYS = ['L', 'R'];
export const QUEUE_TEXT = Object.freeze({
  L: { heading: 'Left queue', enter: 'enter from the left' },
  R: { heading: 'Right queue', enter: 'enter from the right' }
});

/**
 * Group one order into the sections the list draws: one per non-empty queue, and within it one
 * per row in the order the rows are walked.
 *
 * @param {object} order the return of walkOnOrder()
 * @param {number} rows  grid depth
 * @param {number} cols  grid width
 * @param {object} labels the four labelling settings
 * @param {string} audienceAt the viewpoint, for the column half of a seat name
 * @returns {{ single: boolean, total: number, side: string, queues: Array<{
 *   key: string, heading: string, enter: string, count: number,
 *   groups: Array<{ row: number, heading: string, where: string,
 *                   entries: Array<{ position: number, name: string, seat: string }> }>
 * }> }}
 *
 * `single` is true when only one queue has anybody in it, which is the common case: the queue
 * heading is then dropped and the list is a plain 1..N, so a feature the plan does not use never
 * makes the sheet look more complicated than it is.
 *
 * `side` is the one line that says which wing to enter from, and that left and right are the
 * audience's: the order only works from one side, and the sheet is read backstage, away from the
 * preview that says so on screen. '' when nobody is seated.
 */
export function walkOnGroups(order, rows, cols, labels, audienceAt) {
  const at = normaliseAudienceAt(audienceAt);
  const src = (order && order.queues) || { L: [], R: [] };
  const queues = [];
  let total = 0;

  for (const key of QUEUE_KEYS) {
    const list = Array.isArray(src[key]) ? src[key] : [];
    if (!list.length) continue;
    total += list.length;
    const groups = [];
    for (const e of list) {
      // The generator emits row by row in walk order, so a change of `row` is a new group and no
      // sort is needed. Grouping on the RUN rather than on the value is what keeps that true if a
      // future row sequence ever walks the same row twice.
      let g = groups[groups.length - 1];
      if (!g || g.row !== e.row) {
        g = { row: e.row, heading: 'Row ' + rowLabelAt(e.row, rows, labels, at), where: whereRow(e.row, rows), entries: [] };
        groups.push(g);
      }
      g.entries.push({ position: e.position, name: e.name, seat: seatLabelFor(e.seatIndex, rows, cols, labels, at) });
    }
    queues.push({ key, ...QUEUE_TEXT[key], count: list.length, groups });
  }
  const single = queues.length < 2;
  const frame = 'left and right as the audience sees the stage';
  const side = !queues.length ? '' : single ? `Enter from the ${queues[0].key === 'L' ? 'left' : 'right'} (${frame}).` : `Left and right are as the audience sees the stage.`;
  return { single, total, side, queues };
}

// The plain-English position of a row on the stage, beside its label. Only the two ends get one:
// "Back row (Row D)" tells a stranger where to stand in a way that "Row D" cannot, and that is
// the whole audience for this sheet. A one-row stage is both ends at once, so it gets neither.
function whereRow(r, rows) {
  if (rows < 2) return '';
  if (r === rows - 1) return 'Back row';
  if (r === 0) return 'Front row';
  return '';
}

/**
 * The seat badge: the walk-on position each CHAIR carries, keyed by seat index.
 *
 * The fourth consumer of one generator ("everything downstream — the on-screen list, the
 * printed table, the optional seat badge — consumes this one output"). It formats nothing that
 * the list does not already say; it says it in the one place the user is actually looking while
 * they drag, which is the stage.
 *
 * FOUR CHARACTERS: the cell is 92x40, and the badge takes the split label's bottom-right corner
 * (SeatGrid hides the label while the badges show), so it has to fit `R120` at the 250-singer
 * cap. The lock badge and the "alone" tag share top-right.
 *
 * THE PREFIX IS DROPPED WHEN THERE IS ONLY ONE QUEUE, exactly as `walkOnGroups` drops the queue
 * heading and for the same reason: a plan that does not split its entrance should not be made to
 * look as though it does, and `12` in a 92px cell reads where `L12` is one more thing to decode.
 * So the common case is a bare number and the prefix appears precisely when it carries meaning.
 *
 * @param {object} order the return of walkOnOrder()
 * @returns {{ single: boolean, bySeat: Record<number, string> }} `bySeat` is keyed by the seat's
 *          index into the UNROTATED `seats` array, which is what `gi` carries, so a badge follows
 *          a chair through the viewpoint and through a By-section crop without being recomputed.
 */
export function walkOnBadges(order) {
  const src = (order && order.queues) || { L: [], R: [] };
  const used = QUEUE_KEYS.filter((k) => Array.isArray(src[k]) && src[k].length);
  const single = used.length < 2;
  const bySeat = {};
  for (const key of used) for (const e of src[key]) bySeat[e.seatIndex] = (single ? '' : key) + e.position;
  return { single, bySeat };
}

/**
 * The clipboard text. One name per line, grouped and headed by queue, no markup and no
 * box-drawing, because it has to survive a paste into Word or an email.
 *
 * The three fields on a singer's line are separated by a TAB rather than padded with spaces:
 * space alignment only holds in a monospaced font and collapses the moment it is pasted into a
 * document, whereas Word turns tabs into tab stops and can convert the block straight into a
 * table. The name is followed by two tabs, not one: at the default half-inch stops a single tab
 * lets a long name spill past the next stop and push its seat out of line with the rest.
 *
 * @param {object} view the return of walkOnGroups()
 * @param {string[]} [waiting] singers with no seat, listed unnumbered at the end
 * @param {string} [title] a first line, e.g. the plan's name
 * @returns {string}
 */
export function walkOnText(view, waiting = [], title = '') {
  const out = [];
  if (title) out.push(title, '');
  if (view.side) out.push(view.side, '');
  for (const q of view.queues) {
    // With one queue the heading would name a distinction the plan does not make.
    if (!view.single) out.push(`${q.heading.toUpperCase()} (${q.enter}, ${countText(q.count)})`, '');
    for (const g of q.groups) {
      out.push(g.where ? `${g.where} (${g.heading})` : g.heading);
      for (const e of g.entries) out.push(`${e.position}\t${e.name}\t\t${e.seat}`);
      out.push('');
    }
  }
  // Stated, never inferred: a name silently missing from a printed list is read as a bug on the
  // night, so the people with nowhere to walk to are named as such.
  if (waiting.length) {
    out.push(`NOT ON STAGE (${waiting.length})`);
    for (const n of waiting) out.push(n);
    out.push('');
  }
  // one trailing newline, and never a run of blank lines at the end
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

/**
 * The walk-on order as spreadsheet rows, for its own CSV download.
 *
 * A FLAT TABLE, not the grouped layout of walkOnText(): one line per singer with the row as a
 * column, so the file sorts and filters like any other list. The row still reads in walk order,
 * so opening it without touching anything gives the same sequence as the copied text. The Queue
 * column only appears when there are two queues, for the reason walkOnGroups() drops the heading.
 *
 * @param {object} view the return of walkOnGroups()
 * @param {string[]} [waiting] singers with no seat, listed in a block after the table
 * @param {string} [title] a first line, e.g. the plan's name
 * @returns {string[][]} rows ready for csvText()
 */
export function walkOnRows(view, waiting = [], title = '') {
  const out = [];
  if (title) out.push([title]);
  if (view.side) out.push([view.side]);
  if (out.length) out.push([]);
  out.push((view.single ? [] : ['Queue']).concat(['Order', 'Name', 'Seat', 'Row']));
  for (const q of view.queues) {
    for (const g of q.groups) {
      const row = g.where ? `${g.heading} (${g.where.toLowerCase()})` : g.heading;
      for (const e of g.entries) out.push((view.single ? [] : [q.heading]).concat([String(e.position), e.name, e.seat, row]));
    }
  }
  // Named, as in the text and the seating export: a name missing from the file reads as a bug.
  if (waiting.length) {
    out.push([], [NOT_SEATED]);
    for (const n of waiting) out.push([n]);
  }
  return out;
}

const countText = (n) => `${n} singer${n === 1 ? '' : 's'}`;

/**
 * The whole view in one call, for the component and for anything that renders a plan that is not
 * the live one (the print path, the concert sheet). The LIVE view goes
 * through here too, so there is one call and not two half-identical ones.
 *
 * `seats` is the stored grid, holding singer ids, and `byId` is the plan's id -> record lookup.
 * The conversion to names happens HERE and nowhere else on this path: a walk-on list is a sheet
 * of paper handed to a steward on a door, and no id ever reaches it. Everything downstream —
 * walkOnOrder, walkOnGroups, walkOnText — therefore works in names and never learns what an id
 * is. A seat holding an id the roster does not have reads as an empty chair and emits nobody,
 * which is what reconcileSeats would make of it anyway.
 *
 * @param {object} [byId] the plan's roster keyed by id (rosterById). Omitted, `seats` is taken
 *                        to hold names already, which is what the pure-geometry tests do.
 */
export function walkOnFor(seats, rows, cols, walkOn, labels, audienceAt, byId) {
  const named = byId ? seatNames(seats, byId) : seats;
  const order = walkOnOrder(named, rows, cols, walkOn);
  return {
    order,
    list: walkOnGroups(order, rows, cols, labels, audienceAt),
    badges: walkOnBadges(order)
  };
}
