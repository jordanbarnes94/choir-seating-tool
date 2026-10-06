# Choir import — hand-testing fixtures

One file per case for testing the spreadsheet importer in the real UI (Roster dialog → Import).
These are **not** read by `npm test`; the pure logic is covered by `test/import.test.js`.
Regenerate with `node test/fixtures/import/make-fixtures.mjs` (output is deterministic).

An import always becomes a **new preset**, named in the picker, and opens it on stage. Before
each import, load a preset so there is a roster, seating and pins on stage — every refusal
should leave all three untouched **and add nothing to the preset list**. Give each successful
import a fresh name (or delete the previous one), or the name check will refuse it.

Success reads "Imported N singers and M splits into the new preset "<name>", now open on
stage." — the tables below abbreviate that to its counts.

## A. Happy path
| # | File | Expect |
|---|------|--------|
| 1 | *Download a blank template*, import it unedited | Picker: `2-way · 2 groups` ✓ → 8 singers and 1 split. The result has no *Download a blank template* button (only refusals offer it) |
| 2 | Same, but **Cancel** at the picker | Nothing changed |
| 3 | `01-template-roundtrip.xlsx` | As 1 |
| 4 | `02-realistic.csv` | Headings Singer / Voice part accepted. Picker: 2-way ✓, 3-way ✓, Email unticked *too many*, Notes unticked *no values*, *(column 7)* unticked *no heading*. 14 singers, 2 splits. Treble → Tenor, Baritone → Bass, "Smith, Jane" is one name |
| 5 | `03-realistic.xlsx` | Identical to 4 |
| 6 | `04-xlsx-numbers-and-dates.xlsx` | Number and date cells become splits; date categories `2026-09-01`, `2026-09-08` |
| 7 | `05-bom-and-lf.csv` | Clean import, no stray character in "Name" |
| 8 | `16-xlsx-renamed-to.csv` | Imports — format is sniffed from bytes, not extension |

## B. Partial success
| # | File | Expect |
|---|------|--------|
| 9 | `06-partial-skips.csv` | 4 singers. Unrecognised: Mezzo ×2, Counter-tenor ×1, (blank) ×1. Skipped 6 rows incl. `(duplicate)` and `(reserved name)`. Nameless row silently ignored |

## C. Refused after the picker
| # | File | Expect |
|---|------|--------|
| 10 | `07-all-sections-unknown.csv` | "No singers could be read…" + unknown-values list (picker first said "Found 4 singers") |
| 11 | `17-nine-splits.csv` | All 9 ticked → "That has 9 splits; the maximum is 8." Untick one → imports |
| 12 | `18-thirteen-categories.csv` | Default → 13 singers, 0 splits. Tick Desk → "…has 13 categories; the maximum is 12 per split." |
| 13 | `19-251-singers.csv` | "That has 251 singers; the maximum is 250…" |

## D. Refused at read (no picker)
| # | File | Expect |
|---|------|--------|
| 14 | `08-columns-swapped.csv` | "The first two columns must be Name and Section…" |
| 15 | `09-header-only.csv` | "…a header row and no singers under it." |
| 16 | `10-empty.csv` | "There are no rows in that file." |
| 17 | `11-semicolon-european.csv` | Header message (no hint that the delimiter is the problem) |
| 18 | `12-singers-on-sheet2.xlsx` | Header message, which names the first-sheet rule |
| 19 | `13-singers-on-sheet2-blank-sheet1.xlsx` | "There are no rows in that file." (does **not** mention the first-sheet rule) |
| 20 | `15-not-a-workbook.xlsx` | "That file is not a spreadsheet this tool can read…" |
| 21 | `14-legacy.xls`, `20-plain-text.txt` | Switch the file dialog to *All files* first. .xls → "re-save as .xlsx or CSV"; .txt → header message |

## E. The preset name and the unsaved-changes warning
Any file that reaches the picker will do; `02-realistic.csv` is a good default.

| # | Do | Expect |
|---|----|--------|
| 22 | Leave the name box empty | Import is disabled; Enter does nothing |
| 23 | Name it `!!!` | Stays on the picker: "Use at least one letter or number." |
| 24 | Name it the same as a built-in preset | Stays on the picker: "…clashes with a built-in preset…" |
| 25 | Name it the same as one of your presets (any case/punctuation variant) | Stays on the picker: "You already have a preset named…" |
| 26 | Load a preset, change nothing, import | No red warning; "Your other presets are not changed." |
| 27 | Load a preset, move a singer, import | Red warning about unsaved changes on stage |
| 28 | Load a preset, move a singer, **Save**, import | No warning (Save marks the stage clean) |
| 29 | After a successful import, open the preset list | New preset is there and selected; loading it restores the same seating instantly |
| 30 | Import a file with only Name and Section (delete the `2-way` column from `05-bom-and-lf.csv`) | Picker says "That file has only names and sections, so there are no splits to choose." and does not ask "Which columns are splits?"; after import the Colour by split bar shows "No splits yet" |
| 31 | Reload the page after 30 | Still no splits (an empty split list is restored as empty, not reset to the default 2-way) |
