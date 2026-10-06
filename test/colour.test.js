/*
 * Tests for the colour constants (their 2026-09-04
 * revision, and the 2026-09-11 move to split frames computed per section).
 *
 * Run: npm test
 *
 * These do not test a function so much as guard a set of PROPERTIES that are easy to break
 * by tidying, and that nothing else in the codebase would notice. Two of them cost real
 * effort to establish and would be silently lost:
 *
 *   1. Every section colour clears WCAG AA as text. Soprano and Bass were darkened on
 *      2026-09-04 to achieve this. The values look arbitrary, and "rounding them back" to
 *      the nicer-looking Glasshouse originals reintroduces the failure with no visible
 *      symptom, because the seat fills are unaffected either way (see 2).
 *   2. The seat fills are exactly the Glasshouse colours. tint() keeps only the hue, so the
 *      fills are what carries the section identity while the raw hex's lightness carries the
 *      text contrast. This test is what says those two facts stay true together.
 *
 * The colour maths is imported from the palette tools rather than re-implemented. That is
 * deliberate: a second implementation of exactly this maths once went
 * wrong and put bad figures into the doc as canon. One copy, used by everything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASIC_SPLITS,
  LIMITS,
  EXAMPLE_SPLITS,
  SECTIONS,
  SECTION_COLOR,
  SPLIT_FRAMES,
  deriveSplitGlobals,
  hexToHsl,
  hslToHex,
  lchHue,
  normaliseColours,
  normaliseSplitColours,
  resolveSectionColours,
  resolveSplitFrames,
  sectionColour,
  splitCatPositions,
  splitFrame,
  splitFrameColour,
  tint,
  validSectionColour
} from '../src/utils/arranger.js';
import { contrast, labOf, ciede2000, VISION } from '../tools/colour.mjs';

const WHITE = '#ffffff';

// Round-tripping a colour through a hex string quantises it, and hexToHsl then reconstructs
// a very slightly different hue — which tint() keeps. So comparisons between two CONSTRUCTED
// colours allow a step of 1 per channel; comparisons against a stored constant stay exact.
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function assertSameFill(a, b, message) {
  const [ca, cb] = [channels(a), channels(b)];
  const off = ca.map((v, i) => Math.abs(v - cb[i]));
  assert.ok(Math.max(...off) <= 1, `${message}: ${a} vs ${b}`);
}

// The seat fills: the Glasshouse HUES under the 2026-09-04 "vivid" tint (L 0.74, saturation
// clamped 0.75-0.95). Written out rather than derived so that a change to a section hue, or
// to either tint() constant, fails here instead of quietly agreeing with itself.
// Tenor moved on 2026-09-19, from the purple `#ae8bee` to the pink `#ee8bbc`: the purple was
// never the Glasshouse tenor. That is the only hue this palette has ever changed, and it is
// the change this constant exists to make visible — see arranger.js on SECTION_COLOR.
const FILLS = {
  Soprano: '#fcdb7e',
  Alto: '#8bb4ee',
  Tenor: '#ee8bbc',
  Bass: '#8beeb8'
};

/* ---------- sections ---------- */

test('every section colour except Soprano clears WCAG AA as text on white', () => {
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    if (section === 'Soprano') continue; // see the test below
    const c = contrast(hex, WHITE);
    assert.ok(
      c >= 4.5,
      `${section} (${hex}) is ${c.toFixed(2)}:1 on white, below the 4.5:1 AA threshold. ` +
        'It is used as text in SectionBlock.vue and NeighbourReport.vue. Darken it — the ' +
        'seat fill will not move, because tint() discards lightness.'
    );
  }
});

test('Soprano stays yellow and stays below AA, on purpose', () => {
  // Do not "fix" this by darkening. A yellow cannot reach 4.5:1 on white and still read as
  // yellow — dark yellow is brown. `#966f00` clears AA at 4.59:1 and was rejected on sight
  // for exactly that reason (Jordan, 2026-09-04). The text is 15px bold, under WCAG's
  // large-text threshold, so the 3:1 allowance does not rescue it either. The fix belongs at
  // the usage site, not in this constant.
  const c = contrast(SECTION_COLOR.Soprano, WHITE);
  assert.ok(c < 4.5, 'Soprano now passes AA — if that was done by darkening it, check it still reads yellow');
  assert.ok(c >= 3.0, `Soprano is ${c.toFixed(2)}:1, worse than the 3.04:1 that was accepted`);
  // and it must still be a yellow, not a brown: brown is the same hue at low lightness.
  const { h, l } = hexToHsl(SECTION_COLOR.Soprano);
  assert.ok(h > 35 && h < 60, `Soprano hue ${Math.round(h)} is outside the yellow band`);
  assert.ok(l >= 0.34, `Soprano at L ${l.toFixed(2)} is dark enough to read as brown`);
});

test('the seat fills are the expected vivid tint of the Glasshouse hues', () => {
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    assert.equal(
      tint(hex),
      FILLS[section],
      `${section}'s fill moved. Either its hue changed — the hue is the section identity and ` +
        'is not up for retuning — or one of tint()\'s two constants did, which moves all four.'
    );
  }
});

test('the fills stay far enough apart, and out of the way of the names', () => {
  // Loose floors: they catch a regression, not a deliberate retune. The split frames' own
  // clearance from the fills is tested per section below.
  const fills = Object.values(SECTION_COLOR).map(tint);

  let sections = Infinity;
  for (let a = 0; a < fills.length; a++)
    for (let b = a + 1; b < fills.length; b++)
      sections = Math.min(sections, ciede2000(labOf(fills[a]), labOf(fills[b])));
  assert.ok(sections >= 16, `closest two section fills are ΔE ${sections.toFixed(1)}, expected >= 16`);

  // the singer's name is painted on the fill (SeatGrid .cell .nm)
  const name = Math.min(...fills.map((f) => contrast('#11203a', f)));
  assert.ok(name >= 4.5, `singer name on the worst fill is ${name.toFixed(2)}:1, below WCAG AA`);
});

test('tint() discards lightness entirely, which is what makes the contrast fix free', () => {
  // The exact property the 2026-09-04 section change rests on. tint() forces L=0.78, so
  // LIGHTNESS is the free lever: hold hue and saturation, move lightness as far as the text
  // contrast needs, and the fill does not move at all.
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    const { h, s } = hexToHsl(hex);
    const fill = tint(hex);
    // Swept over the range a section colour could plausibly take. Below about L 0.2 a hex
    // has too few distinct steps left to round-trip the hue, so the drift there is the
    // colour space running out of resolution rather than tint() misbehaving.
    for (const l of [0.25, 0.35, 0.45, 0.55, 0.65]) {
      assertSameFill(tint(hslToHex(h, s, l)), fill, `${section} at L${l} moved the fill`);
    }
  }
});

test('every section sits outside the clamp band, so the fill is a pure function of hue', () => {
  // Under the 2026-09-04 constants (S clamped to 0.75-0.95) all four sections are clamped:
  // Soprano at 1.00 down to 0.95, and Alto 0.69 / Tenor 0.60 / Bass 0.58 all up to 0.75.
  // That is what makes the fills depend on hue alone, and it is the reason the section
  // colours are free to be retuned for text contrast. If a future section colour lands
  // INSIDE the band, that stops being true for it and this test says so.
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    const { h, s, l } = hexToHsl(hex);
    assert.ok(
      s <= 0.75 || s >= 0.95,
      `${section} saturation ${s.toFixed(2)} is inside the clamp band, so its fill now ` +
        'depends on saturation as well as hue'
    );
    // moving saturation anywhere else on the same side of the band must not move the fill
    const other = s <= 0.75 ? Math.max(0.05, s - 0.2) : 1.0;
    assertSameFill(tint(hslToHex(h, other, l)), tint(hex), `${section} fill moved with saturation`);
  }
});

test('a section hue change does move the fill, so this suite would catch one', () => {
  // Guards the guard: if tint() ever stopped depending on hue, the test above would pass
  // vacuously and the identity claim would be unprotected.
  const { h, s, l } = hexToHsl(SECTION_COLOR.Alto);
  assert.notEqual(tint(hslToHex((h + 40) % 360, s, l)), FILLS.Alto);
});

/* ---------- split frames, computed per section ---------- */

const FRAMES = 8;
const framesOf = (hex) => Array.from({ length: FRAMES }, (_, i) => splitFrame(hex, i));
function worstPair(frames, k, vision = 'normal') {
  const see = VISION[vision];
  let worst = Infinity;
  for (let a = 0; a < k; a++)
    for (let b = a + 1; b < k; b++) worst = Math.min(worst, ciede2000(labOf(see(frames[a])), labOf(see(frames[b]))));
  return worst;
}

test('every default section has its own bespoke eight frames, and they are what it paints', () => {
  // SPLIT_FRAMES is keyed by the exact section hex, so a change to SECTION_COLOR without new
  // frames for it silently falls back to the computed frames. This catches it.
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    assert.ok(SPLIT_FRAMES[hex], `${section} (${hex}) has no bespoke frames in SPLIT_FRAMES`);
    assert.equal(SPLIT_FRAMES[hex].length, FRAMES);
    assert.deepEqual(framesOf(hex), SPLIT_FRAMES[hex]);
  }
});

test('every split frame reads against its own section fill', () => {
  // The reason frames are per section. The global palette's worst frame on its own fill was
  // ΔE 9.0 at 1.03:1, a blue frame lost on the Alto fill. Loose floors below the measured values.
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    const fill = tint(hex);
    framesOf(hex).forEach((f, i) => {
      const d = ciede2000(labOf(f), labOf(fill));
      assert.ok(d >= 25, `${section} frame ${i + 1} (${f}) is ΔE ${d.toFixed(1)} from its fill, expected >= 25`);
      const c = contrast(f, fill);
      assert.ok(c >= 2.2, `${section} frame ${i + 1} (${f}) is ${c.toFixed(2)}:1 on its fill, expected >= 2.2`);
    });
  }
});

test('within a section, the first categories of a split stay apart', () => {
  // Floor 18, lowered from 25 on 2026-09-19 and deliberately so: Alto (22.4) and Tenor (19.9)
  // reached 25+ only with a frame near their own hue, the blue on Alto and purple on Tenor
  // that were rejected on sight. The trade bought colour-blind separation, guarded below.
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    const frames = framesOf(hex);
    const two = worstPair(frames, 2), four = worstPair(frames, 4);
    assert.ok(two >= 40, `${section} 2-way is ΔE ${two.toFixed(1)}, expected >= 40`);
    assert.ok(four >= 18, `${section} worst pair among four is ΔE ${four.toFixed(1)}, expected >= 18`);
  }
});

test('the first four frames stay apart for red- and green-blind viewers', () => {
  // Under the shared offsets the worst of these was ΔE 4.0 (Soprano, protan). The bespoke
  // search weighs protan and deutan in, and the lowest is now 11.4 (Alto and Tenor, deutan).
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    for (const vision of ['protan', 'deutan']) {
      const four = worstPair(framesOf(hex), 4, vision);
      assert.ok(four >= 10, `${section} four frames under ${vision} are ΔE ${four.toFixed(1)}, expected >= 10`);
    }
  }
});

test('no frame is near the hue of its own section', () => {
  // The bespoke search keeps 50 degrees; gamut clipping and 8-bit rounding can shave a little.
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    const own = lchHue(hex);
    for (const f of framesOf(hex)) {
      const d = Math.abs(lchHue(f) - own) % 360;
      assert.ok(Math.min(d, 360 - d) >= 45, `${section} frame ${f} is within 45 degrees of the section hue`);
    }
  }
});

test('a section\'s frames are all different, and the ninth category wraps to the first', () => {
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    const frames = framesOf(hex);
    assert.equal(new Set(frames).size, frames.length, `${section} repeats a frame: ${frames.join(' ')}`);
    assert.equal(splitFrame(hex, FRAMES), frames[0]);
  }
});

test('a recoloured section falls back to frames computed from its own hue', () => {
  const { h, s, l } = hexToHsl(SECTION_COLOR.Alto);
  const moved = hslToHex((h + 40) % 360, s, l);
  const frames = framesOf(moved);
  assert.ok(!Object.values(SPLIT_FRAMES).some((list) => list.includes(frames[0])), 'expected a computed frame, got a bespoke one');
  assert.notEqual(frames[0], splitFrame(SECTION_COLOR.Alto, 0));
  assert.equal(new Set(frames).size, FRAMES);
});

/* ---------- how a split numbers its categories ---------- */

test('each split numbers its categories from zero, in order', () => {
  // A split carries only the position. The colour also depends on the singer's section, so 1A
  // of the 4-way is the first frame of whichever section the singer is in.
  const { CAT_INDEX } = deriveSplitGlobals(EXAMPLE_SPLITS);
  assert.equal(CAT_INDEX['2way']['1'], 0);
  assert.equal(CAT_INDEX['3way'].Highs, 0);
  assert.deepEqual(Object.values(CAT_INDEX['4way']), [0, 1, 2, 3]);
});

test('past eight categories the frames wrap, and the label is the only identifier', () => {
  // Pre-existing behaviour, pinned so the wrap is a decision
  // rather than a surprise: LIMITS.cats allows 12 and there are eight frames per section.
  const cats = Array.from({ length: LIMITS.cats }, (_, i) => `c${i}`);
  const { CAT_INDEX } = deriveSplitGlobals([{ id: 'big', name: 'big', cats }]);
  const hex = SECTION_COLOR.Bass;
  assert.equal(splitFrame(hex, CAT_INDEX.big.c8), splitFrame(hex, CAT_INDEX.big.c0));
  assert.equal(splitFrame(hex, CAT_INDEX.big.c11), splitFrame(hex, CAT_INDEX.big.c3));
});


/* ---------- a plan's own section colours ---------- */

/*
 * The rule these all turn on: ABSENT MEANS "USE THE DEFAULT". Not black, and not a copy of
 * today's constant taken at save time. It is what lets a future retune of SECTION_COLOR reach
 * every plan whose owner never chose their own, and it is what makes the reset a delete.
 */

test('no override paints exactly the shipped defaults', () => {
  for (const empty of [undefined, null, {}, 'nonsense', 7, []]) {
    assert.deepEqual(resolveSectionColours(empty), { ...SECTION_COLOR });
    for (const s of SECTIONS) assert.equal(sectionColour(s, empty), SECTION_COLOR[s]);
  }
});

test('an override paints that section and leaves the other three on their defaults', () => {
  const colours = { Alto: '#123456' };
  assert.equal(sectionColour('Alto', colours), '#123456');
  assert.equal(sectionColour('Bass', colours), SECTION_COLOR.Bass);
  assert.deepEqual(resolveSectionColours(colours), { ...SECTION_COLOR, Alto: '#123456' });
});

test('a section whose override is nonsense falls back, and costs only itself', () => {
  // The case that matters is a hand-edited or truncated backup. Substituting black here would
  // be the single worst outcome: an invisible stage that looks like a rendering bug.
  for (const bad of ['red', '', '#abc', '#12345g', '#1234567', null, 7, {}, undefined]) {
    const out = resolveSectionColours({ Tenor: bad, Bass: '#005500' });
    assert.equal(out.Tenor, SECTION_COLOR.Tenor, `${JSON.stringify(bad)} should fall back, not paint`);
    assert.equal(out.Bass, '#005500', 'and should not take a valid neighbour with it');
  }
});

test('normaliseColours keeps only the four sections, lowercased', () => {
  const out = normaliseColours({ Soprano: '#AABBCC', Descant: '#000000', Alto: 'red', nope: 1 });
  assert.deepEqual(out, { Soprano: '#aabbcc' });
  // sparse, so "which sections did this plan actually choose?" is answerable
  assert.deepEqual(Object.keys(normaliseColours({})), []);
  assert.deepEqual(normaliseColours(null), {});
});

test('normaliseColours never writes to what it is handed', () => {
  const raw = Object.freeze({ Alto: '#ABCDEF' });
  assert.deepEqual(normaliseColours(raw), { Alto: '#abcdef' });
  assert.equal(raw.Alto, '#ABCDEF');
});

test('validSectionColour accepts a six-digit hex and nothing else', () => {
  // What `<input type="color">` produces, and only that: the picker cannot emit a named colour,
  // an alpha channel or a three-digit shorthand, so anything else arrived from a file.
  for (const ok of ['#000000', '#ffffff', '#FFFFFF', '#c4317a']) assert.ok(validSectionColour(ok));
  for (const no of ['#fff', '#ffffffff', 'white', 'rgb(0,0,0)', '', null, undefined, 0, {}])
    assert.ok(!validSectionColour(no));
});

test('a recoloured section changes its seat fill AND all eight of its split frames', () => {
  // The behaviour most likely to be reported as a bug, pinned here so it reads as the feature it
  // is. SPLIT_FRAMES is keyed on the exact section hex, so a custom colour finds no bespoke list
  // and takes the computed derivation instead — frames measured against the fill it now has
  // rather than the one it used to.
  const custom = { Alto: '#8a2f7d' };
  const painted = sectionColour('Alto', custom);
  assert.notEqual(tint(painted), tint(SECTION_COLOR.Alto), 'the fill moves');
  const before = framesOf(SECTION_COLOR.Alto), after = framesOf(painted);
  for (let i = 0; i < FRAMES; i++) assert.notEqual(after[i], before[i], `frame ${i + 1} should have moved`);
  assert.equal(new Set(after).size, FRAMES, 'and the computed eight are still eight');
});

test('choosing a section its own default hex keeps its bespoke frames', () => {
  // The picker hands back a hex whatever the user does, including the value it opened on. An
  // override that equals the default has to behave exactly like no override at all, or a user
  // who opened the picker and cancelled would silently lose the bespoke eight.
  for (const [section, hex] of Object.entries(SECTION_COLOR)) {
    const painted = sectionColour(section, { [section]: hex.toUpperCase() });
    assert.equal(painted, hex);
    assert.deepEqual(framesOf(painted), SPLIT_FRAMES[hex]);
  }
});

/* ---------- a plan's own SPLIT FRAME colours (the per-split-category half) ---------- */

/*
 * Same rule again — ABSENT MEANS "ASK splitFrame()" — but with one extra thing to hold that the
 * section overrides did not have: the store is keyed by the section's NAME while SPLIT_FRAMES is
 * keyed by its HEX, and that difference is deliberate. Keyed by hex, a section recolour would
 * orphan every frame the user had picked for it. The test below is the whole argument.
 */

const DEFAULT_COLOURS = resolveSectionColours({});

test('with no overrides the resolved frames are exactly what splitFrame() paints', () => {
  for (const empty of [undefined, null, {}, 'nonsense', 7, []]) {
    const frames = resolveSplitFrames(DEFAULT_COLOURS, empty);
    for (const [section, hex] of Object.entries(SECTION_COLOR)) {
      assert.equal(frames[section].length, LIMITS.cats, 'as far as a split can reach');
      frames[section].forEach((f, i) => assert.equal(f, splitFrame(hex, i)));
    }
  }
});

test('an override reaches the frame, and costs only the position it names', () => {
  const over = { Tenor: { 2: '#123456' } };
  const frames = resolveSplitFrames(DEFAULT_COLOURS, over);
  assert.equal(frames.Tenor[2], '#123456');
  assert.equal(frames.Tenor[1], splitFrame(SECTION_COLOR.Tenor, 1), 'the neighbouring position is untouched');
  assert.equal(frames.Alto[2], splitFrame(SECTION_COLOR.Alto, 2), 'and so is the same position in another section');
  // the single-value accessor agrees with the map, the way sectionColour agrees with resolveSectionColours
  assert.equal(splitFrameColour('Tenor', SECTION_COLOR.Tenor, 2, over), '#123456');
  assert.equal(splitFrameColour('Alto', SECTION_COLOR.Alto, 2, over), splitFrame(SECTION_COLOR.Alto, 2));
});

test('recolouring a section does NOT orphan the frames its owner picked by hand', () => {
  // The reason the store is keyed by section NAME. SPLIT_FRAMES is keyed on the exact hex on
  // purpose, so that a recoloured section drops the bespoke eight measured against a fill it no
  // longer has. An override is the opposite case: it is a colour a person chose, and it belongs
  // to the section rather than to the shade the section was when they chose it. Keyed by hex it
  // would vanish silently on the next recolour, which is a bug and not a feature.
  const over = { Alto: { 0: '#ff8800', 3: '#004466' } };
  const recoloured = resolveSectionColours({ Alto: '#8a2f7d' });
  const frames = resolveSplitFrames(recoloured, over);
  assert.equal(frames.Alto[0], '#ff8800');
  assert.equal(frames.Alto[3], '#004466');
});

test('precedence: the override wins where it speaks, the recoloured section fills the rest', () => {
  // Both kinds of override on the same section at once. The positions nobody chose follow the
  // NEW hue through splitFrame()'s computed fallback — never the bespoke list of the colour the
  // section used to be, which is the trap a "keep what we had" fallback would fall into.
  const custom = '#8a2f7d';
  const over = { Alto: { 1: '#ff8800' } };
  const frames = resolveSplitFrames(resolveSectionColours({ Alto: custom }), over);
  assert.equal(frames.Alto[1], '#ff8800', 'the override wins at the position it names');
  for (let i = 0; i < LIMITS.cats; i++) {
    if (i === 1) continue;
    assert.equal(frames.Alto[i], splitFrame(custom, i), `position ${i} follows the new section colour`);
    assert.notEqual(frames.Alto[i], SPLIT_FRAMES[SECTION_COLOR.Alto][i % FRAMES], 'and not the old colour\'s bespoke frame');
  }
});

test('an override outlives a recolour in both directions, including back to the default', () => {
  const over = { Bass: { 0: '#ff00ff' } };
  for (const hex of [SECTION_COLOR.Bass, '#112233', SECTION_COLOR.Bass]) {
    const frames = resolveSplitFrames(resolveSectionColours({ Bass: hex }), over);
    assert.equal(frames.Bass[0], '#ff00ff');
  }
});

test('normaliseSplitColours keeps the four sections, whole positions in range, lowercased', () => {
  const out = normaliseSplitColours({
    Soprano: { 0: '#AABBCC', 1: 'red', 3: null },
    Descant: { 0: '#000000' },
    Alto: { [LIMITS.cats]: '#000000', '-1': '#000000', x: '#000000' },
    Bass: {},
    Tenor: 'nonsense'
  });
  // a section whose every key was junk is dropped entirely, so "which positions did this plan
  // actually choose?" stays answerable and a reset is byte-identical to never having chosen
  assert.deepEqual(out, { Soprano: { 0: '#aabbcc' } });
  assert.deepEqual(normaliseSplitColours({}), {});
  assert.deepEqual(normaliseSplitColours(null), {});
});

test('normaliseSplitColours never writes to what it is handed', () => {
  const raw = Object.freeze({ Alto: Object.freeze({ 0: '#ABCDEF' }) });
  assert.deepEqual(normaliseSplitColours(raw), { Alto: { 0: '#abcdef' } });
  assert.equal(raw.Alto[0], '#ABCDEF');
});

test('a junk override falls back to the default frame rather than painting black', () => {
  for (const bad of ['red', '', '#abc', '#12345g', null, 7, {}, undefined]) {
    const frames = resolveSplitFrames(DEFAULT_COLOURS, { Tenor: { 0: bad, 1: '#005500' } });
    assert.equal(frames.Tenor[0], splitFrame(SECTION_COLOR.Tenor, 0), `${JSON.stringify(bad)} should fall back`);
    assert.equal(frames.Tenor[1], '#005500', 'and should not take a valid neighbour with it');
  }
});

test('a position past the largest split is offered no picker', () => {
  // The count of pickers that matter is 4 x (the largest split's category count): 16 for the
  // example with every split, 8 for a clean install. A picker for a position no split reaches would
  // change nothing on the stage, which is worse than no picker at all.
  const rows = splitCatPositions(EXAMPLE_SPLITS);
  assert.deepEqual(rows.map((r) => r.pos), [0, 1, 2, 3], 'the widest example split is 4-way');
  assert.deepEqual(rows[0].names, ['1', 'Highs', '1A'], 'one row per POSITION, naming every category on it');
  assert.deepEqual(rows[3].names, ['2B'], 'and only the 4-way reaches position 4');
  assert.equal(splitCatPositions(BASIC_SPLITS).length, 2, 'a clean install offers two');
  for (const none of [[], undefined, null, 'nonsense', [{ id: 'x', cats: [] }]])
    assert.deepEqual(splitCatPositions(none), [], 'no splits, no pickers');
});

test('the positions offered stop at LIMITS.cats however many categories a split claims', () => {
  const cats = Array.from({ length: LIMITS.cats + 4 }, (_, i) => `c${i}`);
  assert.equal(splitCatPositions([{ id: 'big', name: 'big', cats }]).length, LIMITS.cats);
});

test('a position past the bespoke eight can be overridden on its own', () => {
  // The wrap belongs to the DEFAULT list: splitFrame() repeats itself at position 8 because there
  // are eight bespoke frames. An override is a value a person picked for one position, so
  // colouring position 8 leaves position 0 alone — which is the only way a 12-way split can be
  // given twelve distinct frames at all.
  const frames = resolveSplitFrames(DEFAULT_COLOURS, { Soprano: { 8: '#010203' } });
  assert.equal(frames.Soprano[8], '#010203');
  assert.equal(frames.Soprano[0], splitFrame(SECTION_COLOR.Soprano, 0));
});
