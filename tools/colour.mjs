/*
 * Colour maths for the colour tests: sRGB <-> linear <-> CIE Lab, CIEDE2000, the three
 * dichromacy simulations and greyscale, and WCAG contrast.
 *
 * Extracted on 2026-09-04 from the palette checker, which was not kept, so that the checker and
 * the tests shared ONE implementation. That matters here more than it usually would: a
 * re-created harness with a broken dichromacy transform once put wrong figures into the doc as
 * canon. Since 2026-09-11 the sRGB and Lab conversions live in arranger.js, because the app
 * computes split frames in LCh itself; they are re-exported here, so there is still one copy.
 *
 * Method, and its limits. Distance is CIEDE2000 in CIE Lab under D65. Dichromacy is
 * simulated with Vienot, Brettel and Mollon 1999: a projection in linear LMS onto the plane
 * spanned by the two surviving cone responses. It models a *dichromat*, i.e. the severe end;
 * anomalous trichromats (the large majority of colour-blind people) see more separation.
 * Greyscale uses Rec. 709 luma on linear light.
 *
 * CIEDE2000 scale: ~1 is a just-noticeable difference between two large adjacent patches.
 * Split frames are 3px lines with a cell between them, which is a far harder case, so the
 * targets sit well above that.
 */
import { toLin, toSrgb, hexToLin, linToHex, labOf } from '../src/utils/arranger.js';

export { toLin, toSrgb, hexToLin, linToHex, labOf };

export function ciede2000(lab1, lab2) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) * deg;
    return h < 0 ? h + 360 : h;
  };
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2);
  const dLp = L2 - L1, dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (Cp1 + Cp2) / 2;
  let hbp;
  if (Cp1 * Cp2 === 0) hbp = hp1 + hp2;
  else {
    hbp = (hp1 + hp2) / 2;
    if (Math.abs(hp1 - hp2) > 180) hbp += hp1 + hp2 < 360 ? 180 : -180;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTh = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

const RGB2LMS = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922]
];
const LMS2RGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789]
];
const mul = (M, v) => M.map((row) => row.reduce((acc, m, i) => acc + m * v[i], 0));
const DICHROMAT = {
  protan: [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  deutan: [[1, 0, 0], [0.9513092, 0, 0.04302063], [0, 0, 1]],
  tritan: [[1, 0, 0], [0, 1, 0], [-0.86744736, 1.86727089, 0]]
};
const sim = (kind) => (hex) => linToHex(mul(LMS2RGB, mul(DICHROMAT[kind], mul(RGB2LMS, hexToLin(hex)))));
export const VISION = {
  normal: (hex) => hex,
  protan: sim('protan'),
  deutan: sim('deutan'),
  tritan: sim('tritan'),
  mono: (hex) => {
    const [r, g, b] = hexToLin(hex);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return linToHex([y, y, y]);
  }
};

export function contrast(h1, h2) {
  const lum = (h) => {
    const [r, g, b] = hexToLin(h);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(h1), b = lum(h2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

