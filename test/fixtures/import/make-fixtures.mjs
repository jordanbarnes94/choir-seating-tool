// Generates the hand-testing fixtures for the Choir spreadsheet importer, one file per case.
// The numbered order and the expected outcome of each is in README.md beside this script.
//
//   node test/fixtures/import/make-fixtures.mjs
//
// fflate is not a direct dependency: it arrives transitively (via the Nuxt toolchain), which
// is fine for a script that only needs to be re-run when a fixture changes. Zip entries carry
// a fixed mtime so regenerating produces byte-identical files and no git churn.
import { zipSync as zip, strToU8 } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const zipSync = (files) => zip(files, { mtime: new Date('2026-01-01T00:00:00Z') });
const OUT = process.argv[2] || dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const csv = (rows) =>
  rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(',')).join('\r\n');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// Excel serial for a JS date (1900 system)
const serial = (d) => (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000;

function sheetXml(rows) {
  const body = rows.map((r, ri) => {
    const cells = r.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = colName(ci) + (ri + 1);
      if (v instanceof Date) return `<c r="${ref}" s="1"><v>${serial(v)}</v></c>`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function xlsx(sheets) {
  const names = Object.keys(sheets);
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`
  };
  names.forEach((n, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[n])));
  const u8 = {};
  for (const [k, v] of Object.entries(files)) u8[k] = strToU8(v);
  return zipSync(u8);
}

const put = (name, data) => writeFileSync(join(OUT, name), data);

/* ---------- data ---------- */
const TEMPLATE = [
  ['Name', 'Section', '2-way'],
  ['Alice Green', 'Soprano', '1'], ['Beth Hall', 'Soprano', '2'],
  ['Carol Innes', 'Alto', '1'], ['Dana Judd', 'Alto', '2'],
  ['Ellis Kerr', 'Tenor', '1'], ['Frank Lowe', 'Tenor', '2'],
  ['Grace Muir', 'Bass', '1'], ['Henry Nash', 'Bass', '2']
];

// Real-world-ish: alternate headings, short/numbered section labels, several split kinds,
// a free-text Email column (13 distinct → "too many"), a headed-but-empty column, and a
// trailing header-less column that only has data in one row.
const secs = ['Sop 1', 'Sop 2', 'Alt', 'Altos', 'Ten', 'Tenors', 'Bass I', 'Baritone', 'Treble', 'soprano', 'alto 2', 'B', 'S'];
const REAL = [['Singer', 'Voice part', '2-way', '3-way', 'Email', 'Notes', '']];
secs.forEach((s, i) =>
  REAL.push([`Singer ${String.fromCharCode(65 + i)}`, s, String((i % 2) + 1), ['Highs', 'Mids', 'Lows'][i % 3], `s${i}@example.com`, '', i === 4 ? 'stray' : ''])
);
REAL.push(['Smith, Jane','Alto', '1', 'Mids', 'jane@example.com', '', '']); // comma in name

const XLSX_TYPES = [
  ['Name', 'Section', 'Row number', 'Rehearsal date'],
  ['Ann', 'Soprano', 1, new Date(Date.UTC(2026, 8, 1))],
  ['Bea', 'Alto', 2, new Date(Date.UTC(2026, 8, 1))],
  ['Cal', 'Tenor', 1, new Date(Date.UTC(2026, 8, 8))],
  ['Dan', 'Bass', 2, new Date(Date.UTC(2026, 8, 8))]
];

const PARTIAL = [
  ['Name', 'Section', '2-way'],
  ['Alice Green', 'Soprano', '1'], ['Beth Hall', 'Mezzo', '2'], ['Cara Hill', 'Mezzo', '1'],
  ['Carol Innes', 'Alto', '1'], ['Dev Oak', 'Counter-tenor', '2'], ['Eve Pine', '', '1'],
  ['Alice Green', 'Alto', '2'], // duplicate
  ['__EMPTY__', 'Tenor', '1'], // reserved sentinel
  ['', 'Bass', '1'], // no name — silently ignored, not reported
  ['Grace Muir', 'Bass', '1'], ['Henry Nash', 'Bass', '2']
];

const ALL_BAD = [['Name', 'Section'], ['Ann', 'Mezzo'], ['Bea', 'Contralto'], ['Cal', 'Counter'], ['Dan', '']];

const NINE = [['Name', 'Section', ...Array.from({ length: 9 }, (_, i) => `Split ${i + 1}`)]];
['Soprano', 'Alto', 'Tenor', 'Bass'].forEach((s, i) => NINE.push([`Singer ${i + 1}`, s, ...Array.from({ length: 9 }, (_, j) => String(((i + j) % 2) + 1))]));

const THIRTEEN = [['Name', 'Section', 'Desk']];
for (let i = 0; i < 13; i++) THIRTEEN.push([`Singer ${i + 1}`, ['Soprano', 'Alto', 'Tenor', 'Bass'][i % 4], `D${i + 1}`]);

const TOO_MANY_SINGERS = [['Name', 'Section']];
for (let i = 0; i < 251; i++) TOO_MANY_SINGERS.push([`Singer ${i + 1}`, ['Soprano', 'Alto', 'Tenor', 'Bass'][i % 4]]);

/* ---------- write ---------- */
put('01-template-roundtrip.xlsx', xlsx({ Sheet1: TEMPLATE }));
put('02-realistic.csv', csv(REAL));
put('03-realistic.xlsx', xlsx({ Singers: REAL }));
put('04-xlsx-numbers-and-dates.xlsx', xlsx({ Sheet1: XLSX_TYPES }));
put('05-bom-and-lf.csv', '﻿' + csv(TEMPLATE).replace(/\r\n/g, '\n') + '\n');
put('06-partial-skips.csv', csv(PARTIAL));
put('07-all-sections-unknown.csv', csv(ALL_BAD));
put('08-columns-swapped.csv', csv(TEMPLATE.map(([a, b, c]) => [b, a, c])));
put('09-header-only.csv', csv([TEMPLATE[0]]));
put('10-empty.csv', '');
put('11-semicolon-european.csv', TEMPLATE.map((r) => r.join(';')).join('\r\n'));
put('12-singers-on-sheet2.xlsx', xlsx({ Cover: [['Choir list — see next sheet']], Singers: TEMPLATE }));
put('13-singers-on-sheet2-blank-sheet1.xlsx', xlsx({ Blank: [], Singers: TEMPLATE }));
put('14-legacy.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(504).fill(0)]));
put('15-not-a-workbook.xlsx', zipSync({ 'hello.txt': strToU8('this is a zip, not a workbook') }));
put('16-xlsx-renamed-to.csv', xlsx({ Sheet1: TEMPLATE }));
put('17-nine-splits.csv', csv(NINE));
put('18-thirteen-categories.csv', csv(THIRTEEN));
put('19-251-singers.csv', csv(TOO_MANY_SINGERS));
put('20-plain-text.txt', 'Just some notes about the choir.\nNot a spreadsheet.\n');
console.log('wrote fixtures to', OUT);
