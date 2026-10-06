/*
 * Tests for the spreadsheet import logic.
 *
 * Run: npm test
 *
 * utils/spreadsheet.js is the whole of the judgement the importer makes, deliberately kept
 * clear of the browser so it can be held to account here: which columns are splits, which
 * section a cell means, which rows are skipped and why. The parts worth pinning are the ones
 * that are invisible when they go wrong:
 *
 *   1. The pre-tick rules. A trailing empty column silently becoming a phantom split, and
 *      one free-text column aborting an entire import, are the two ways the old automatic
 *      behaviour misfired on real Excel output. Both are now a reason on an unticked box, and
 *      neither is reachable by clicking once it is right.
 *   2. First-letter section matching, including the two mis-mappings that are accepted
 *      knowingly. `Treble` landing on Tenor looks exactly like a bug; it is a decision
 *      (Jordan, 2026-09-02) and this is where that is recorded in code.
 *   3. The skipped-value report. It is the only thing that tells a user which cell in a
 *      200-row spreadsheet to fix, so it must list the VALUE and not merely a count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, SECTIONS } from '../src/utils/arranger.js';
import {
  TEMPLATE_ROWS,
  ROSTER_TEMPLATE_ROWS,
  buildImport,
  classifyColumns,
  CSV_BOM,
  csvCell,
  csvText,
  headerProblem,
  matchRosterByName,
  matchSection,
  nameKey,
  normaliseRows,
  parseCSV,
  rosterTemplateCSV,
  sniffFormat,
  templateCSV
} from '../src/utils/spreadsheet.js';

/* ---------- section matching ---------- */

test('a section is matched on its first letter, in any case and any length', () => {
  for (const v of ['S', 's', 'Sop', 'soprano', 'Soprano 2', 'SOPRANOS']) assert.equal(matchSection(v), 'Soprano');
  for (const v of ['A', 'Alt', 'Altos', 'alto 1']) assert.equal(matchSection(v), 'Alto');
  for (const v of ['T', 'Ten', 'Tenors', 'tenor 2']) assert.equal(matchSection(v), 'Tenor');
  for (const v of ['B', 'Bass I', 'basses']) assert.equal(matchSection(v), 'Bass');
});

test('every full section name matches itself, so an exported roster re-imports unchanged', () => {
  for (const s of SECTIONS) assert.equal(matchSection(s), s);
});

test('the two known mis-mappings are accepted knowingly, not special-cased', () => {
  // Trebles sing the soprano line and Treble starts with T. A carve-out was offered and
  // declined; the help copy warns instead. If this ever starts returning Soprano, that was a
  // decision someone took, not a fix.
  assert.equal(matchSection('Treble'), 'Tenor');
  // Baritone to Bass is the usual choir convention anyway.
  assert.equal(matchSection('Baritone'), 'Bass');
});

test('anything not starting S, A, T or B is unmatched, and so is a blank', () => {
  for (const v of ['', '  ', 'Descant', '1', 'Mezzo', null, undefined]) assert.equal(matchSection(v), null);
});

/* ---------- format sniffing ---------- */

test('the format is decided by the first bytes, never by the extension', () => {
  assert.equal(sniffFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])), 'zip');
  assert.equal(sniffFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1])), 'ole2');
  assert.equal(sniffFormat(new TextEncoder().encode('Name,Section\n')), 'text');
  // an empty file is text, and fails later on the header rather than on the magic number
  assert.equal(sniffFormat(new Uint8Array([])), 'text');
});

test('an ArrayBuffer is sniffed the same as a Uint8Array', () => {
  const buf = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
  assert.equal(sniffFormat(buf), 'zip');
});

/* ---------- the header ---------- */

test('the header must be Name then Section, in any case and with any padding', () => {
  assert.equal(headerProblem(normaliseRows([[' NAME ', 'Section'], ['Ann', 'S']])), null);
  assert.match(headerProblem(normaliseRows([['Surname', 'Group'], ['Ann', 'S']])), /Name and Section/);
});

test('the common alternative headings are forgiven, but the column order is not', () => {
  for (const h of [['Singer', 'Voice'], ['Singer Name', 'Voice part'], ['Full name', 'Part']])
    assert.equal(headerProblem(normaliseRows([h, ['Ann', 'S']])), null, h.join('/'));
  // swapping the two columns is a guess about contents, not a lookup, and is not made
  assert.match(headerProblem(normaliseRows([['Section', 'Name'], ['S', 'Ann']])), /Name and Section/);
});

test('the header failure names the first-sheet rule, because that is the invisible cause', () => {
  // A user whose singers live on sheet 2 gets a message about columns and no clue why.
  assert.match(headerProblem(normaliseRows([['Notes'], ['whatever']])), /first sheet/);
});

test('an empty file and a headers-only file are refused separately', () => {
  assert.match(headerProblem([]), /no rows/);
  assert.match(headerProblem(normaliseRows([['Name', 'Section']])), /no singers/);
});

/* ---------- column classification ---------- */

const rowsWith = (...rows) => normaliseRows(rows);

test('a column that looks like a split is pre-ticked, and its group count is the distinct values', () => {
  const cols = classifyColumns(
    rowsWith(['Name', 'Section', '3-way'], ['Ann', 'S', 'A'], ['Bea', 'A', 'B'], ['Cal', 'T', 'A'], ['Dan', 'B', 'C'])
  );
  assert.equal(cols.length, 1);
  assert.deepEqual(
    { index: cols[0].index, label: cols[0].label, groups: cols[0].groups, reason: cols[0].reason, pick: cols[0].pick },
    { index: 2, label: '3-way', groups: 3, reason: '', pick: true }
  );
});

test("a trailing empty column is unticked and says 'no heading', so no phantom split appears", () => {
  // Excel writes these whenever the used range is wider than the data. normaliseRows drops
  // all-blank ROWS, not all-blank columns, so the column still has to be classified.
  const cols = classifyColumns(rowsWith(['Name', 'Section', '2-way', '', ''], ['Ann', 'S', 'A', '', ''], ['Bea', 'A', 'B', '', '']));
  assert.equal(cols.length, 3);
  assert.deepEqual(cols.map((c) => c.pick), [true, false, false]);
  assert.deepEqual(cols.slice(1).map((c) => c.reason), ['no heading', 'no heading']);
  // and it is named by the position the user would count to in their spreadsheet
  assert.equal(cols[1].display, '(column 4)');
});

test('a free-text column is unticked with a count, instead of aborting the whole import', () => {
  const rows = [['Name', 'Section', 'Notes']];
  for (let i = 0; i < LIMITS.cats + 5; i++) rows.push(['Singer ' + i, 'S', 'note ' + i]);
  const cols = classifyColumns(rowsWith(...rows));
  assert.equal(cols[0].groups, LIMITS.cats + 5);
  assert.equal(cols[0].pick, false);
  assert.match(cols[0].reason, /too many/);
  // exactly at the limit is fine, so the reason is about being OVER it and not near it
  const atLimit = [['Name', 'Section', 'Part']];
  for (let i = 0; i < LIMITS.cats; i++) atLimit.push(['Singer ' + i, 'S', 'p' + i]);
  assert.equal(classifyColumns(rowsWith(...atLimit))[0].pick, true);
});

test("a headed column with nothing in it is unticked and says 'no values'", () => {
  const cols = classifyColumns(rowsWith(['Name', 'Section', 'Comments'], ['Ann', 'S', ''], ['Bea', 'A', '']));
  assert.deepEqual([cols[0].reason, cols[0].pick], ['no values', false]);
});

test('a reason unticks a column but never forbids it', () => {
  // The user may tick a "too many" column anyway; the answer is the limit message, inline,
  // with nothing changed. Nothing in the classification marks a column as unavailable.
  const cols = classifyColumns(rowsWith(['Name', 'Section', ''], ['Ann', 'S', 'x']));
  assert.equal('disabled' in cols[0], false);
});

/* ---------- building the roster ---------- */

const SIMPLE = rowsWith(
  ['Name', 'Section', '2-way', 'Email'],
  ['Ann Smith', 'Sop', '1', 'a@example.com'],
  ['Bea Jones', 'alto 2', '2', 'b@example.com'],
  ['Cal Reid', 'T', '1', 'c@example.com'],
  ['Dan Boyd', 'Bass I', '2', 'd@example.com']
);

test('only the picked columns become splits', () => {
  const r = buildImport(SIMPLE, [2]);
  assert.equal(r.ok, true);
  assert.equal(r.splits.length, 1);
  assert.deepEqual(r.splits[0], { id: '2-way', name: '2-way', cats: ['1', '2'] });
  assert.deepEqual(r.roster.map((p) => p.section), ['Soprano', 'Alto', 'Tenor', 'Bass']);
  assert.equal('Email' in r.roster[0], false);
});

test('picking nothing imports names and sections alone', () => {
  const r = buildImport(SIMPLE, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.splits, []);
  assert.deepEqual(Object.keys(r.roster[0]), ['name', 'section']);
});

test('a picked column below index 2 is ignored: Name and Section are not splits', () => {
  assert.deepEqual(buildImport(SIMPLE, [0, 1, 2]).splits.length, 1);
});

test('categories keep first-seen order, and a value outside them snaps to the first', () => {
  const rows = rowsWith(['Name', 'Section', 'Part'], ['Ann', 'S', 'Second'], ['Bea', 'A', 'First'], ['Cal', 'T', '']);
  const r = buildImport(rows, [2]);
  assert.deepEqual(r.splits[0].cats, ['Second', 'First']);
  assert.equal(r.roster[2].Part, 'Second'); // blank snaps to the first category
});

test('a split column with no values at all still yields one category rather than none', () => {
  const r = buildImport(rowsWith(['Name', 'Section', 'Part'], ['Ann', 'S', '']), [2]);
  assert.deepEqual(r.splits[0].cats, ['A']);
});

test('an unknown section skips the row and is reported BY VALUE with a count', () => {
  const rows = rowsWith(
    ['Name', 'Section', '2-way'],
    ['Ann', 'Descant', '1'],
    ['Bea', 'Descant', '2'],
    ['Cal', 'Mezzo', '1'],
    ['Dan', 'S', '1']
  );
  const r = buildImport(rows, [2]);
  assert.equal(r.ok, true);
  assert.equal(r.roster.length, 1);
  // the value is what tells the user which cell to fix; a bare count would not
  assert.deepEqual(r.unknownSections, [
    { value: 'Descant', count: 2 },
    { value: 'Mezzo', count: 1 }
  ]);
  assert.deepEqual(r.skipped, ['Ann (Descant)', 'Bea (Descant)', 'Cal (Mezzo)']);
});

test('a missing section is reported under its own heading rather than as an empty string', () => {
  const r = buildImport(rowsWith(['Name', 'Section'], ['Ann', ''], ['Bea', 'S']), []);
  assert.deepEqual(r.unknownSections, [{ value: '(blank)', count: 1 }]);
  assert.deepEqual(r.skipped, ['Ann (no section)']);
});

test('duplicates and reserved sentinel names are skipped with their reason', () => {
  const rows = rowsWith(['Name', 'Section'], ['Ann', 'S'], ['Ann', 'A'], ['__EMPTY__', 'S'], ['__BLOCKED__', 'S']);
  const r = buildImport(rows, []);
  assert.equal(r.roster.length, 1);
  // in file order, so the list can be read against the spreadsheet a row at a time
  assert.deepEqual(r.skipped, ['Ann (duplicate)', '__EMPTY__ (reserved name)', '__BLOCKED__ (reserved name)']);
});

test('a row with no name is dropped silently, because it is not a singer to report', () => {
  const r = buildImport(rowsWith(['Name', 'Section'], ['', 'S'], ['Ann', 'S']), []);
  assert.equal(r.roster.length, 1);
  assert.deepEqual(r.skipped, []);
});

test('nothing importable is a refusal that still carries the report', () => {
  const r = buildImport(rowsWith(['Name', 'Section'], ['Ann', 'Descant']), []);
  assert.equal(r.ok, false);
  assert.match(r.error, /S, A, T or B/);
  assert.deepEqual(r.unknownSections, [{ value: 'Descant', count: 1 }]);
});

test('a bad header is refused by buildImport too, not only by the picker', () => {
  const r = buildImport(rowsWith(['Surname', 'Group'], ['Ann', 'S']), []);
  assert.equal(r.ok, false);
  assert.match(r.error, /Name and Section/);
});

/* ---------- split ids ---------- */

test('a split column named Name or Section cannot shadow a singer’s own properties', () => {
  const rows = rowsWith(['Name', 'Section', 'name', 'section'], ['Ann', 'S', 'x', 'y']);
  const r = buildImport(rows, [2, 3]);
  assert.deepEqual(r.splits.map((s) => s.id), ['name_1', 'section_1']);
  assert.equal(r.roster[0].name, 'Ann');
  assert.equal(r.roster[0].section, 'Soprano');
  assert.equal(r.roster[0].name_1, 'x');
  // Capitalised headings are NOT a clash: the roster keys are lower-case 'name' and
  // 'section', JS property keys are case-sensitive, and the seeding is deliberately
  // case-exact so a "Name" column keeps the id the user would recognise.
  const cap = buildImport(rowsWith(['Name', 'Section', 'Name', 'Section'], ['Ann', 'S', 'x', 'y']), [2, 3]);
  assert.deepEqual(cap.splits.map((s) => s.id), ['Name', 'Section']);
  assert.equal(cap.roster[0].name, 'Ann');
  assert.equal(cap.roster[0].Name, 'x');
});

test('a split column headed __proto__ lands as a real value instead of vanishing', () => {
  // `row['__proto__'] = v` on an object literal is a silent no-op, so the value would never
  // arrive and every later read of that split's category would be wrong.
  const r = buildImport(rowsWith(['Name', 'Section', '__proto__'], ['Ann', 'S', 'x']), [2]);
  assert.equal(r.splits[0].id, '__proto___1');
  assert.equal(r.roster[0].__proto___1, 'x');
});

test('two columns with the same heading get distinct ids', () => {
  const r = buildImport(rowsWith(['Name', 'Section', 'Part', 'Part'], ['Ann', 'S', 'a', 'b']), [2, 3]);
  assert.deepEqual(r.splits.map((s) => s.id), ['Part', 'Part_1']);
});

test('a headless picked column gets a positional name and a usable id', () => {
  const r = buildImport(rowsWith(['Name', 'Section', ''], ['Ann', 'S', 'a']), [2]);
  assert.equal(r.splits[0].name, 'Split 3');
  assert.equal(r.roster[0][r.splits[0].id], 'a');
});

/* ---------- rows normalisation ---------- */

test('all-blank rows are dropped and every cell arrives as a trimmed string', () => {
  const rows = normaliseRows([['Name', 'Section'], ['', '', ''], [' Ann ', ' S '], [null, null]]);
  assert.deepEqual(rows, [['Name', 'Section'], ['Ann', 'S']]);
});

test('the values read-excel-file hands back are flattened, not stringified by accident', () => {
  const rows = normaliseRows([['Name', 'Section', 'Part'], ['Ann', 'S', 2], ['Bea', 'A', new Date(Date.UTC(2026, 8, 7))]]);
  assert.deepEqual(rows[1], ['Ann', 'S', '2']);
  assert.deepEqual(rows[2], ['Bea', 'A', '2026-09-07']);
});

/* ---------- CSV parsing, unchanged behaviour ---------- */

test('the CSV scanner still handles BOM, quotes, escapes and CRLF', () => {
  const rows = parseCSV('﻿Name,Section\r\n"Smith, Ann",Soprano\r\n"He said ""hi""",Alto\r\n');
  assert.deepEqual(rows, [['Name', 'Section'], ['Smith, Ann', 'Soprano'], ['He said "hi"', 'Alto']]);
});

test('a final row with no trailing newline is kept', () => {
  assert.deepEqual(parseCSV('Name,Section\nAnn,S'), [['Name', 'Section'], ['Ann', 'S']]);
});

/* ---------- the template ---------- */

test('the template is twelve singers, three to a section, with a 2-way split and an A/B/C one', () => {
  const body = TEMPLATE_ROWS.slice(1);
  assert.equal(body.length, 12);
  assert.deepEqual(TEMPLATE_ROWS[0], ['Name', 'Section', '2-way', 'Another Split']);
  assert.deepEqual(body.map((r) => r[1][0]).join(''), 'SSSAAATTTBBB');
  assert.deepEqual([...new Set(body.map((r) => r[2]))].sort(), ['1', '2']);
  assert.deepEqual([...new Set(body.map((r) => r[3]))].sort(), ['A', 'B', 'C']);
});

test('the template spells the sections out in full, which is the lesson it is teaching', () => {
  for (const r of TEMPLATE_ROWS.slice(1)) assert.ok(SECTIONS.includes(r[1]), r[1]);
});

test('no template name can be read by Excel as a formula', () => {
  // csvCell would apostrophe-prefix such a name into safety, but a template is a thing people
  // copy, and one that teaches a leading apostrophe teaches the wrong lesson.
  for (const r of TEMPLATE_ROWS.slice(1)) assert.equal(csvCell(r[0]), r[0]);
});

test('every CSV this app writes starts with a UTF-8 BOM, and parseCSV eats it again', () => {
  // Excel on Windows decodes a BOM-less CSV as the system codepage, so an accented name
  // garbles on double-click. The round trip is what makes it safe
  // to retrofit: parseCSV has always stripped a leading BOM.
  const text = csvText([['Name', 'Section'], ['Ännchen Bähr', 'Soprano']]);
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.equal(CSV_BOM, '\ufeff');
  assert.deepEqual(parseCSV(text), [['Name', 'Section'], ['Ännchen Bähr', 'Soprano']]);
});

test('the template round-trips through the importer it is a template for', () => {
  const rows = normaliseRows(parseCSV(templateCSV()));
  assert.equal(headerProblem(rows), null);
  const cols = classifyColumns(rows);
  assert.deepEqual(cols.map((c) => [c.label, c.groups, c.pick]), [['2-way', 2, true], ['Another Split', 3, true]]);
  const r = buildImport(rows, cols.filter((c) => c.pick).map((c) => c.index));
  assert.equal(r.ok, true);
  assert.equal(r.roster.length, 12);
  assert.equal(r.splits.length, 2);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.unknownSections, []);
  assert.deepEqual(r.roster.map((p) => p.section[0]).join(''), 'SSSAAATTTBBB');
});

test('the roster template is the same singers with no split column', () => {
  assert.deepEqual(ROSTER_TEMPLATE_ROWS[0], ['Name', 'Section']);
  assert.deepEqual(ROSTER_TEMPLATE_ROWS.slice(1), TEMPLATE_ROWS.slice(1).map((r) => r.slice(0, 2)));
  const rows = normaliseRows(parseCSV(rosterTemplateCSV()));
  assert.deepEqual(classifyColumns(rows), []);
  assert.equal(buildImport(rows, []).roster.length, 12);
});

/* ---------- replacing a roster by name ---------- */

test('a name key ignores case and spaces at either end, and nothing else', () => {
  assert.equal(nameKey('  Julian BARLOW '), 'julian barlow');
  assert.notEqual(nameKey('Barlow, Julian'), nameKey('Julian Barlow'), 'word order is not guessed at');
  assert.notEqual(nameKey('Zoë Hall'), nameKey('Zoe Hall'), 'nor accents');
});

test('replacing keeps everybody the file still names, removes the rest, and adds the new', () => {
  const existing = [
    { id: 's1', name: 'Julian Barlow', section: 'Bass' },
    { id: 's2', name: 'Zoë Hall', section: 'Soprano' },
    { id: 's3', name: 'Ann Lee', section: 'Alto' },
    { id: 's7', name: 'Gone Person', section: 'Tenor' }
  ];
  const incoming = [
    { name: 'julian barlow', section: 'Tenor' },
    { name: 'Zoe Hall', section: 'Soprano' },
    { name: 'Ann Lee', section: 'Alto' },
    { name: 'Barlow, Julian', section: 'Bass' }
  ];
  let n = 8;
  const r = matchRosterByName(existing, incoming, () => 's' + n++);
  assert.deepEqual(r.singers.map((p) => p.id), ['s1', 's8', 's3', 's9'], 'new ids come from mint()');
  assert.deepEqual(r.singers[0], { id: 's1', name: 'julian barlow', section: 'Tenor' }, "the file's spelling and section win");
  assert.equal(r.matched, 2);
  assert.deepEqual(r.renamed, [{ from: 'Julian Barlow', to: 'julian barlow' }]);
  assert.deepEqual(r.added, ['Zoe Hall', 'Barlow, Julian']);
  assert.deepEqual(r.removed, ['Zoë Hall', 'Gone Person']);
});

test('an ambiguous loose match is left alone rather than guessed', () => {
  const existing = [{ id: 's1', name: 'Sam Lee', section: 'Bass' }, { id: 's2', name: 'SAM LEE', section: 'Tenor' }];
  const r = matchRosterByName(existing, [{ name: 'sam lee', section: 'Bass' }], () => 's3');
  assert.equal(r.matched, 0);
  assert.deepEqual(r.removed, ['Sam Lee', 'SAM LEE']);
  assert.equal(r.singers[0].id, 's3');
});

test('an exact match is taken first, so a loose one cannot steal it', () => {
  const existing = [{ id: 's1', name: 'Ann Lee', section: 'Alto' }, { id: 's2', name: 'ann lee', section: 'Alto' }];
  const r = matchRosterByName(existing, [{ name: 'ann lee', section: 'Alto' }, { name: 'Ann Lee', section: 'Alto' }]);
  assert.deepEqual(r.singers.map((p) => p.id), ['s2', 's1']);
  assert.deepEqual(r.renamed, []);
});
