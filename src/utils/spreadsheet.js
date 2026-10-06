import { SECTIONS, SECTION_KEY, SECTION_VIEW, isSinger, LIMITS } from './arranger.js';

/*
 * spreadsheet — the pure half of the Choir Seating Tool import and export path.
 *
 * Everything here is a plain function over plain data: no DOM, no FileReader, no Vue, and
 * no dynamic import of read-excel-file. That is the point. The two file formats the tool
 * accepts (CSV and .xlsx) converge on ONE array of rows before anything is decided about
 * them, and every decision taken after that junction lives here: which columns are splits,
 * which section a cell means, which rows are skipped and why. So the CSV path and the
 * .xlsx path cannot disagree, and the whole of it is testable under `node --test`
 * (test/import.test.js) without a browser.
 *
 * useChoirArranger.js keeps what genuinely needs the browser: reading the bytes, sniffing
 * the format, importing read-excel-file, and committing the result to reactive state.
 *
 * (Note the explicit `.js` on the arranger import above: Vite resolves an extensionless
 * specifier and plain Node does not, and being loadable by plain Node is the requirement.
 * Same reason as utils/persistence.js.)
 */

/* ---------- writing ---------- */

// Quote a value for a CSV cell.
export function csvCell(v) {
  v = String(v == null ? '' : v);
  // A singer named "=1+1" is a live formula once the file is opened in Excel. A leading
  // apostrophe makes the cell text, and is the convention every spreadsheet understands.
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// The UTF-8 byte order mark. Excel on Windows decodes a BOM-less CSV as the system codepage,
// so an accented or non-Latin name garbles on double-click; with the BOM it reads UTF-8. Every
// CSV this app writes carries one rather than only the two exports:
// one rule with no branch, and the template is a file people open in
// Excel too. parseCSV() below strips a leading BOM, so the round trip is unaffected; the bytes
// of the roster export change, and that is accepted.
export const CSV_BOM = '﻿';

// Join a rows array into CRLF-delimited CSV text, behind the BOM. CRLF because Excel writes it
// and every other reader tolerates it.
export const csvText = (rows) => CSV_BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

// The blank template handed out beside the Concert tab's import button.
//
// TWELVE example singers, three to a section, with two splits: a 2-way whose categories are "1"
// and "2", and "Another Split" with A, B and C scattered across the sections, which shows that
// a split's groups can be anything and needn't be even. The structure is the thing users get
// wrong and prose does not fix it: Name, Section, then one column per split. The full section
// spellings are the second half of the lesson, even though matchSection() below would accept
// "S" — the file the user hands back is easier to read when the words are there.
//
// The names are deliberately plain ASCII with no leading `=`, `+`, `-` or `@`: csvCell would
// quote such a name into safety anyway, but a template is a thing people copy, and a
// template that teaches an apostrophe prefix teaches the wrong lesson.
export const TEMPLATE_ROWS = [
  ['Name', 'Section', '2-way', 'Another Split'],
  ['Alice Green', 'Soprano', '1', 'A'],
  ['Beth Hall', 'Soprano', '2', 'C'],
  ['Isla Owen', 'Soprano', '1', 'B'],
  ['Carol Innes', 'Alto', '2', 'B'],
  ['Dana Judd', 'Alto', '1', 'A'],
  ['Kate Quinn', 'Alto', '2', 'C'],
  ['Ellis Kerr', 'Tenor', '1', 'C'],
  ['Frank Lowe', 'Tenor', '2', 'B'],
  ['Jack Price', 'Tenor', '1', 'A'],
  ['Grace Muir', 'Bass', '2', 'A'],
  ['Henry Nash', 'Bass', '1', 'A'],
  ['Liam Reid', 'Bass', '2', 'B']
];
export const templateCSV = () => csvText(TEMPLATE_ROWS);
// The Roster tab's template: the same singers, names and sections only. Splits belong to a
// concert, so a roster file has no business teaching a split column.
export const ROSTER_TEMPLATE_ROWS = TEMPLATE_ROWS.map((r) => r.slice(0, 2));
export const rosterTemplateCSV = () => csvText(ROSTER_TEMPLATE_ROWS);

/* ---------- replacing a roster's singers from a file ---------- */

// Two names are the same singer when they match ignoring case and surrounding spaces.
export const nameKey = (name) => String(name || '').trim().toLowerCase();

/**
 * The file's singers as a replacement for a roster's. Everybody the file still names stays,
 * with their id, so their chairs, categories and pins in every concert survive; everybody it
 * doesn't is removed; everybody new is added with an id from `mint()`. A name matches exactly
 * first, then by nameKey(), and only where that is unambiguous on BOTH sides — two "Ann Lee"s
 * are never guessed between. The file's spelling and section win.
 *
 * Returns `{ singers, matched, renamed, added, removed }`: `singers` in the file's order, ready to
 * be the roster; `renamed` as `{ from, to }` (a match whose case or spacing differs); `added` and
 * `removed` as names.
 */
export function matchRosterByName(existing, incoming, mint) {
  const have = (existing || []).slice();
  const idOf = new Map(); // incoming index → existing singer
  const taken = new Set(); // existing ids already matched
  const pass = (key) => {
    const count = (list, k) => list.reduce((m, x) => m.set(k(x), (m.get(k(x)) || 0) + 1), new Map());
    const left = have.filter((p) => !taken.has(p.id));
    const want = incoming.map((p, i) => ({ p, i })).filter(({ i }) => !idOf.has(i));
    const leftCount = count(left, (p) => key(p.name));
    const wantCount = count(want, ({ p }) => key(p.name));
    for (const { p, i } of want) {
      const k = key(p.name);
      if (!k || leftCount.get(k) !== 1 || wantCount.get(k) !== 1) continue;
      const hit = left.find((q) => key(q.name) === k);
      idOf.set(i, hit);
      taken.add(hit.id);
    }
  };
  pass((n) => n);
  pass(nameKey);

  const singers = [], renamed = [], added = [];
  incoming.forEach((p, i) => {
    const hit = idOf.get(i);
    if (hit && hit.name !== p.name) renamed.push({ from: hit.name, to: p.name });
    if (!hit) added.push(p.name);
    const id = hit ? hit.id : mint();
    singers.push({ id, name: p.name, section: p.section });
  });
  return {
    singers,
    matched: idOf.size,
    renamed,
    added,
    removed: have.filter((p) => !taken.has(p.id)).map((p) => p.name)
  };
}

/* ---------- reading: format ---------- */

// Which of the three shapes a picked file is, decided by its first bytes and NEVER by its
// extension: an .xlsx renamed to .csv is still a ZIP, and a .csv renamed to .xlsx is still
// text. Called before anything tries to decode or parse.
//
//   'zip'  — 50 4B 03 04 (`PK\x03\x04`): an .xlsx, or an .ods, or any other ZIP. Hand it to
//            read-excel-file and let that decide; a non-workbook throws and is refused by
//            name rather than by blaming the columns.
//   'ole2' — D0 CF 11 E0: the legacy OLE2 container, i.e. a pre-2007 .xls. Nothing in the
//            tool can read it, so it is refused with the fix ("re-save as .xlsx or CSV").
//   'text' — anything else, which goes down the CSV path exactly as before.
export function sniffFormat(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ole2';
  return 'text';
}

/* ---------- reading: CSV ---------- */

// A hand-written character scanner rather than split(','), because a quoted field may hold
// commas and newlines. Handles a leading BOM, `""` escapes, and a final row with no trailing
// newline. An unquoted `\r` ends a row like `\n` does (CRLF counts once), so an old Mac CR-only
// file reads row by row; inside quotes `\r` is kept, so a quoted field survives a round trip.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' && text[i + 1] === '\n') {
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ---------- reading: the shared rows array ---------- */

// Both file types reach the rest of this module through here. read-excel-file hands back
// real JavaScript values — a number, a Date, or null for an empty cell — while parseCSV
// hands back strings, so everything is flattened to a trimmed string once, in one place.
// A Date is rendered as its ISO date, which is what a spreadsheet showing a date column of
// split values would most plausibly have meant; nothing downstream cares beyond equality.
// The apostrophe csvCell() puts in front of a would-be formula is taken off again, so a file the
// tool wrote reads back as it was written.
export function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v).trim();
  return /^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t;
}
export const normaliseRows = (rows) =>
  rows.map((r) => (Array.isArray(r) ? r.map(cellText) : [])).filter((r) => r.some((c) => c !== ''));

/* ---------- reading: the header ---------- */

// The first two columns are the one structural requirement, and the only thing the template
// exists to teach. The headings themselves are forgiven from a short table: a choir's own
// spreadsheet is as likely to say "Singer" and "Voice part" as "Name" and "Section", and a
// lookup is cheaper than making the user rename a column to satisfy a rule they cannot see.
//
// Column ORDER is not forgiven, and is not worth it while the template exists: guessing which
// column is which from its contents is a much bigger promise than reading two headings.
const NAME_HEADS = ['name', 'singer', 'singer name', 'full name'];
const SECTION_HEADS = ['section', 'voice', 'voice part', 'part'];

// Returns null when the header is good, or the sentence to show the user when it is not.
//
// The first-sheet half of the message is unconditional on purpose: only the FIRST sheet is
// ever read (Jordan, 2026-09-02), so a user whose singers live on sheet 2 would
// otherwise get an error about columns and no clue why. Saying it here is far cheaper than a
// sheet picker, and the import's rule is to report rather than to negotiate.
export function headerProblem(rows) {
  if (!rows.length) return 'There are no rows in that file.';
  const header = rows[0].map((h) => h.toLowerCase());
  if (header.length < 2 || !NAME_HEADS.includes(header[0]) || !SECTION_HEADS.includes(header[1]))
    return 'The first two columns must be Name and Section. Only the first sheet of a workbook is read — download the template to see the layout.';
  if (rows.length < 2) return 'That file has a header row and no singers under it.';
  return null;
}

/* ---------- reading: sections ---------- */

// First-letter matching (Jordan, 2026-09-02): UPPER(section[0]) against S, A, T
// and B. Derived from SECTIONS rather than written out, because the four initials happen to
// be distinct and a hand-written table would be a second place to keep them in step.
//
// This accepts Sop, Soprano, Soprano 2, Alt, Altos, Ten, Tenors, Bass I and Basses, which is
// the whole point: real choir spreadsheets use short or numbered voice labels, not the four
// full words. Two mis-mappings are ACCEPTED KNOWINGLY rather than special-cased — `Treble`
// lands on Tenor though trebles sing the soprano line, and `Baritone` lands on Bass, which
// is the usual choir convention anyway. They are noted in the help copy instead. An alias
// table and numbered-voice inference were both offered and declined: the first is a list to
// maintain, the second invents a split the user did not ask for.
//
// Anything else returns null, and the caller lists the offending VALUE in the report so the
// spreadsheet can be fixed.
const SECTION_BY_INITIAL = SECTIONS.reduce((m, s) => ((m[s[0].toUpperCase()] = s), m), {});
export function matchSection(raw) {
  const s = cellText(raw);
  if (!s) return null;
  return SECTION_BY_INITIAL[s[0].toUpperCase()] || null;
}

/* ---------- reading: the column picker ---------- */

// Describe every column from index 2 on, which is every column that COULD be a split, so the
// picker can list them and pre-tick the sensible ones (Jordan, 2026-09-02).
//
// "Groups" is Jordan's word for the distinct non-blank values in the column: that is exactly
// what would become the split's categories, so it is the number that tells a user whether a
// column is a split or a notes field at a glance.
//
// A column is pre-ticked unless there is a reason not to, and the reason is shown:
//   - no heading   — Excel writes trailing empty columns whenever the used range is wider
//                    than the data, and today each one becomes a phantom "Split 3" nobody
//                    asked for. This is the commonest misfire on real Excel output.
//   - no values    — a headed column that is blank all the way down would import as a split
//                    with one made-up category. Harmless and useless, so not pre-ticked.
//   - too many     — over LIMITS.cats distinct values is a free-text column (Email, Notes,
//                    Phone), and today ONE of them aborts the entire import. Shown, unticked,
//                    with the count, so the user can see which column is the problem.
// Nothing is forbidden: a reason unticks a box, it does not disable it. Ticking a "too many"
// column anyway is answered by the limit message, inline, with nothing changed.
export function classifyColumns(rows) {
  const header = rows[0] || [];
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const out = [];
  // Only the rows buildImport() keeps, so a count here is the count an import would make.
  const seen = new Set();
  const kept = rows.slice(1).filter((r) => {
    const name = r[0] || '';
    if (!name || !isSinger(name) || !matchSection(r[1] || '') || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  for (let k = 2; k < width; k++) {
    const label = header[k] || '';
    const groups = [];
    for (const row of kept) {
      const v = row[k] || '';
      if (v && !groups.includes(v)) groups.push(v);
    }
    let reason = '';
    if (!label) reason = 'no heading';
    else if (!groups.length) reason = 'no values';
    else if (groups.length > LIMITS.cats) reason = `too many — the maximum is ${LIMITS.cats}`;
    // The label the picker shows for a headless column has to name something the user can
    // find in their spreadsheet, and "(column 6)" is the 1-based position they would count to.
    out.push({ index: k, label, display: label || `(column ${k + 1})`, groups: groups.length, reason, pick: !reason });
  }
  return out;
}

/* ---------- reading: building the roster ---------- */

// Turn the shared rows array plus the picked split columns into the roster and splits the
// store will commit, or into the reasons it cannot.
//
// Nothing here mutates anything and nothing here alerts: it returns a result the caller
// reports. `skipped` is one line per dropped row, `unknownSections` is the distinct section
// VALUES that were not recognised with a count each, so the report can say "3 rows: Sop 1"
// rather than repeating a row-by-row list the user cannot act on.
export function buildImport(rows, pickedIndexes) {
  const problem = headerProblem(rows);
  if (problem) return { ok: false, error: problem };

  const header = rows[0];
  const cols = [...new Set(pickedIndexes)].filter((k) => k >= 2).sort((a, b) => a - b);
  const catsPerCol = cols.map(() => []);
  const staged = [], skipped = [];
  const unknown = new Map(); // section value → how many rows carried it
  // Mirror the rules the rename form enforces: a name can't be a reserved sentinel
  // (isSinger rejects EMPTY/BLOCKED/non-strings) and can't duplicate another singer.
  const seenNames = new Set();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = cells[0] || '', raw = cells[1] || '';
    if (!name) continue; // a row with no name is not a singer, and is not worth reporting
    if (!isSinger(name)) {
      skipped.push(`${name} (reserved name)`);
      continue;
    }
    const section = matchSection(raw);
    if (!section) {
      skipped.push(`${name} (${raw || 'no section'})`);
      unknown.set(raw || '(blank)', (unknown.get(raw || '(blank)') || 0) + 1);
      continue;
    }
    if (seenNames.has(name)) {
      skipped.push(`${name} (duplicate)`);
      continue;
    }
    seenNames.add(name);
    const vals = cols.map((k, ci) => {
      const v = cells[k] || '';
      if (v && !catsPerCol[ci].includes(v)) catsPerCol[ci].push(v);
      return v;
    });
    staged.push({ name, section, vals });
  }

  if (!staged.length)
    return {
      ok: false,
      error: 'No singers could be read from that file. Every section must start with S, A, T or B.',
      skipped,
      unknownSections: [...unknown].map(([value, count]) => ({ value, count }))
    };

  // Derive a split id from its header label. Seeded with the reserved roster-record keys so a
  // column named "Name" or "Section" can never produce an id that shadows a singer's own
  // properties, and with `__proto__`, which is not a reserved key so much as an unassignable
  // one: `row['__proto__'] = value` on an object literal is a silent no-op, so the value
  // would never land and every later read of that split's category would be wrong.
  // SECTION_VIEW too: a split with that id could never be coloured by, as it is the "No split" view.
  const usedIds = new Set(['name', SECTION_KEY, '__proto__', SECTION_VIEW]);
  const splits = cols.map((k, ci) => {
    const label = header[k] || 'Split ' + (k + 1);
    let base = label.replace(/\s+/g, '_') || 'split' + (k + 1), id = base, n = 1;
    while (usedIds.has(id)) id = base + '_' + n++;
    usedIds.add(id);
    return { id, name: label, cats: catsPerCol[ci].length ? catsPerCol[ci] : ['A'] };
  });
  const roster = staged.map((o) => {
    const row = { name: o.name, section: o.section };
    splits.forEach((s, ci) => {
      const v = o.vals[ci];
      row[s.id] = v && s.cats.includes(v) ? v : s.cats[0];
    });
    return row;
  });

  return {
    ok: true,
    roster,
    splits,
    skipped,
    unknownSections: [...unknown].map(([value, count]) => ({ value, count }))
  };
}
