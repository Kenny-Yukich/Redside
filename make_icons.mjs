// make_icons.mjs: draws the Redside app icon and writes every size the app uses.
//
//   node make_icons.mjs
//
// The artwork is built here as SVG (icons/icon.svg is the master copy), then
// Chromium rasterizes it so gradients, blur and edges come out smooth.
// Needs the same optional Playwright install as tests/browser-smoke.mjs.
//
// Scene: a redside (Deschutes redband) rainbow trout leaping across a
// high-desert sunset, Cascade peaks on the horizon, splash below.

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const modulePath = process.env.REDSIDE_PLAYWRIGHT_MODULE;
const pw = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : "playwright");
const chromium = pw.chromium ?? pw.default.chromium;

// Palette: the app's own tokens plus a few sunset and trout tones.
const C = {
  ink: "#0a2326",
  deep: "#123b3d",
  water: "#1e6e6b",
  redside: "#c4442a",
  redsideSoft: "#e06a4f",
  gold: "#d9a441",
  sunTop: "#ffe29a",
  sunBottom: "#ef8a3c",
  paper: "#eafcfb",
  olive: "#3f5a3a",
  oliveLight: "#7d8f5a",
  belly: "#f4efe2",
};

const S = 1024; // master canvas
const f = (n) => Math.round(n * 10) / 10;

// ---------- trout geometry ----------
// Centerline: quadratic Bezier from the tail root (s=0) to the snout (s=1).
const P0 = [262, 742];
const P1 = [470, 432];
const P2 = [826, 318];
const bez = (s) => {
  const a = (1 - s) ** 2, b = 2 * (1 - s) * s, c = s ** 2;
  return [a * P0[0] + b * P1[0] + c * P2[0], a * P0[1] + b * P1[1] + c * P2[1]];
};
const tangent = (s) => {
  const x = 2 * (1 - s) * (P1[0] - P0[0]) + 2 * s * (P2[0] - P1[0]);
  const y = 2 * (1 - s) * (P1[1] - P0[1]) + 2 * s * (P2[1] - P1[1]);
  const l = Math.hypot(x, y);
  return [x / l, y / l];
};
// Normal pointing to the fish's back (upper-left of the arc).
const normal = (s) => { const [x, y] = tangent(s); return [y, -x]; };

// Half-depth of the body along its length.
const HMAX = 112, HPED = 30, PEAK = 0.5;
const depth = (s) => {
  if (s <= PEAK) {
    const t = s / PEAK;
    return HPED + (HMAX - HPED) * Math.sin((t * Math.PI) / 2) ** 1.6;
  }
  const t = (s - PEAK) / (1 - PEAK);
  return HMAX * Math.max(0, 1 - t ** 2.4) ** 0.62;
};
const back = (s) => depth(s) * 1.0;
const belly = (s) => depth(s) * 0.94;

// A point on the fish in its own frame: s along the body, v across it (+ toward the back).
const at = (s, v) => {
  const [x, y] = bez(s), [nx, ny] = normal(s);
  return [x + nx * v, y + ny * v];
};
// Extend past either end along the tangent (for tail and snout details).
const beyond = (s, u, v) => {
  const [x, y] = at(s, v), [tx, ty] = tangent(s);
  return [x + tx * u, y + ty * u];
};
const pt = ([x, y]) => `${f(x)} ${f(y)}`;

function polyline(points) {
  return points.map((p, i) => (i ? "L" : "M") + pt(p)).join(" ");
}

function bodyPath() {
  const N = 80, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    top.push(at(s, back(s)));
    bot.push(at(s, -belly(s)));
  }
  return polyline([...top, ...bot.reverse()]) + " Z";
}

// A band along the flank between two signed offsets (fractions of the depth).
function bandPath(s0, s1, hi, lo) {
  const N = 60, top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const s = s0 + ((s1 - s0) * i) / N;
    const taper = Math.sin(Math.PI * Math.min(1, (s - s0) / (s1 - s0)) ) ** 0.35;
    top.push(at(s, depth(s) * hi * taper));
    bot.push(at(s, depth(s) * lo * taper));
  }
  return polyline([...top, ...bot.reverse()]) + " Z";
}

function tailPath() {
  // Slightly forked trout tail, flared with the leap.
  const r0 = at(0.0, HPED * 0.92), r1 = at(0.0, -HPED * 0.9);
  const upTip = beyond(0, -150, 118), loTip = beyond(0, -132, -104);
  const notch = beyond(0, -104, 4);
  const c1 = beyond(0, -70, 50), c2 = beyond(0, -60, -46);
  return `M${pt(r0)} Q${pt(c1)} ${pt(upTip)} Q${pt(beyond(0, -118, 54))} ${pt(notch)} ` +
    `Q${pt(beyond(0, -108, -50))} ${pt(loTip)} Q${pt(c2)} ${pt(r1)} Z`;
}

// Closed Catmull-Rom spline through points, as cubic Beziers.
function spline(points, tension = 1) {
  const n = points.length, k = tension / 6;
  let d = `M${pt(points[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += ` C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d + " Z";
}

function finPath(s0, s1, side, height, sweep) {
  // A swept fan of a fin rooted on the back (side=+1) or belly (side=-1)
  // between s0 (rear) and s1 (front): long leading edge out to a rounded tip,
  // then a concave trailing edge back to the body.
  const edge = side > 0 ? back : belly;
  const off = (s, extra) => at(s, side * (edge(Math.max(0, s)) + extra));
  return spline([
    off(s1, -12),
    off(s1 - sweep * 0.45, height * 0.62),
    off(s0 - sweep, height),
    off(s0 - sweep * 0.55, height * 0.42),
    off(s0, -12),
  ], 0.9);
}

// Deterministic spots so the icon doesn't change between runs.
function spots() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let i = 0; i < 56; i++) {
    const s = 0.04 + rnd() * 0.74;
    const v = (0.22 + rnd() * 0.7) * back(s);
    const r = 5 + rnd() * 6;
    if (s > 0.38 && s < 0.6 && v > back(s) * 0.82) continue; // keep the dorsal root clean
    out.push([...at(s, v), r]);
  }
  for (let i = 0; i < 10; i++) {
    const s = 0.05 + rnd() * 0.32;
    out.push([...at(s, -(0.25 + rnd() * 0.45) * belly(s)), 4 + rnd() * 4]);
  }
  // spots on the tail
  for (let i = 0; i < 16; i++) {
    const u = -(26 + rnd() * 92), v = (rnd() * 2 - 1) * (30 + (-u) * 0.6);
    out.push([...beyond(0, u, v), 4 + rnd() * 4]);
  }
  // spots on the dorsal fin
  for (let i = 0; i < 6; i++) {
    const s = 0.42 + rnd() * 0.12;
    out.push([...at(s, back(s) + 12 + rnd() * 34), 4 + rnd() * 3]);
  }
  return out;
}

function trout() {
  const stroke = `stroke="${C.ink}" stroke-width="8" stroke-linejoin="round"`;
  const fin = `fill="url(#fin)" ${stroke}`;
  const [eyeX, eyeY] = at(0.9, back(0.9) * 0.22);
  const gill = [at(0.74, depth(0.74) * 0.78), at(0.8, 0), at(0.74, -depth(0.74) * 0.72)];
  const mouth = [at(0.985, -depth(0.985) * 0.05), at(0.93, -depth(0.93) * 0.18)];
  const lateral = [];
  for (let i = 0; i <= 30; i++) { const s = 0.04 + (0.72 * i) / 30; lateral.push(at(s, depth(s) * 0.02)); }

  return `
  <g id="trout">
    <!-- fins behind the body -->
    <path d="${finPath(0.43, 0.56, 1, 58, 0.06)}" ${fin}/>
    <path d="${finPath(0.13, 0.155, 1, 20, 0.03)}" ${fin}/>
    <path d="${finPath(0.15, 0.23, -1, 40, 0.07)}" ${fin}/>
    <path d="${finPath(0.41, 0.47, -1, 38, 0.09)}" ${fin}/>
    <path d="${tailPath()}" fill="url(#tail)" ${stroke}/>
    <!-- body -->
    <path d="${bodyPath()}" fill="url(#body)" ${stroke}/>
    <g clip-path="url(#bodyClip)">
      <path d="${bandPath(0.0, 0.86, 0.34, -0.3)}" fill="${C.redside}" filter="url(#soft)" opacity=".95"/>
      <path d="${bandPath(0.06, 0.8, 0.12, -0.12)}" fill="${C.redsideSoft}" filter="url(#soft)" opacity=".8"/>
      <ellipse cx="${f(at(0.8, 0)[0])}" cy="${f(at(0.8, 0)[1])}" rx="58" ry="66" fill="${C.redside}" filter="url(#soft)" opacity=".75"/>
      <path d="${polyline(lateral)}" fill="none" stroke="${C.belly}" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round" opacity=".55"/>
      ${spots().map(([x, y, r]) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${C.ink}"/>`).join("")}
      <!-- sunlit sheen along the back -->
      <path d="${bandPath(0.08, 0.95, 0.98, 0.72)}" fill="#ffe7a8" opacity=".22" filter="url(#soft)"/>
    </g>
    <!-- the pectoral fin sits over the body -->
    <path d="${finPath(0.71, 0.76, -1, 34, 0.13)}" ${fin}/>
    <path d="M${pt(gill[0])} Q${pt(gill[1])} ${pt(gill[2])}" fill="none" stroke="${C.ink}" stroke-width="6" stroke-linecap="round" opacity=".7"/>
    <path d="M${pt(mouth[0])} L${pt(mouth[1])}" stroke="${C.ink}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="${f(eyeX)}" cy="${f(eyeY)}" r="19" fill="${C.gold}" stroke="${C.ink}" stroke-width="5"/>
    <circle cx="${f(eyeX + 2)}" cy="${f(eyeY + 1)}" r="10" fill="${C.ink}"/>
    <circle cx="${f(eyeX + 5)}" cy="${f(eyeY - 4)}" r="3.6" fill="#fff"/>
  </g>`;
}

// ---------- scene ----------
const HORIZON = 734;
const SUN = { x: 520, y: 548, r: 312 };

function mountains() {
  // Back range: Three Sisters-ish bumps. Front: Mt Jefferson's sharp peak, off to the right.
  const backRange = "M0 690 L70 664 L140 680 L210 644 L270 662 L330 640 L400 664 L470 650 L540 672 " +
    "L600 660 L660 676 L760 650 L860 664 L940 640 L1024 652 L1024 740 L0 740 Z";
  const jeff = "M470 740 L560 700 L640 640 L690 588 L718 548 L734 522 L752 546 L782 590 L830 636 L890 674 L960 704 L1024 716 L1024 740 Z";
  const snow = "M690 588 L718 548 L734 522 L752 546 L782 590 L764 584 L750 600 L736 580 L720 598 L704 586 Z";
  const butte = "M0 740 L0 712 L90 700 L180 708 L280 726 L340 740 Z";
  return `
    <path d="${backRange}" fill="#3d6f68" opacity=".9"/>
    <path d="${jeff}" fill="#1d4c4b"/>
    <path d="${snow}" fill="#ffe6c4"/>
    <path d="${butte}" fill="#173f40"/>`;
}

function water() {
  // Broken sun-glint dashes under the sun, narrowing toward the viewer.
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dashes = [];
  for (let row = 0; row < 11; row++) {
    const y = HORIZON + 14 + row * 24 + row * row * 0.9;
    const span = 250 - row * 16;
    let x = SUN.x - span / 2 + rnd() * 20;
    while (x < SUN.x + span / 2) {
      const w = 18 + rnd() * 54;
      dashes.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(5 + row * 0.7)}" rx="3" fill="${C.sunTop}" opacity="${f(0.85 - row * 0.06)}"/>`);
      x += w + 10 + rnd() * 26;
    }
  }
  return `
    <rect x="0" y="${HORIZON}" width="${S}" height="${S - HORIZON}" fill="url(#water)"/>
    <rect x="0" y="${HORIZON}" width="${S}" height="4" fill="${C.sunTop}" opacity=".35"/>
    ${dashes.join("")}`;
}

function splash() {
  const [cx, cy] = [236, 812];
  // Curved spray arcs thrown outward from where the tail leaves the water.
  const arcs = [[-70, 70], [-48, 104], [-24, 126], [4, 132], [30, 118], [56, 92]];
  const spray = arcs.map(([a, len], i) => {
    const r = (a * Math.PI) / 180, dx = Math.sin(r), dy = -Math.cos(r);
    const b = [cx + dx * 70, cy + dy * 8];
    const tip = [b[0] + dx * len * 1.1, b[1] + dy * len];
    const ctrl = [b[0] + dx * len * 0.2, b[1] + dy * len * 0.85];
    const w = 13 - Math.abs(a) / 12;
    return `<path d="M${pt(b)} Q${pt(ctrl)} ${pt(tip)}" stroke="${C.paper}" stroke-width="${f(w)}" stroke-linecap="round" fill="none"/>` +
      `<circle cx="${f(tip[0] + dx * 26)}" cy="${f(tip[1] + dy * 22 - 6)}" r="${f(w * 0.62)}" fill="${C.paper}"/>` +
      (i % 2 ? `<circle cx="${f(tip[0] + dx * 52)}" cy="${f(tip[1] + dy * 40 - 4)}" r="${f(w * 0.4)}" fill="${C.paper}" opacity=".85"/>` : "");
  });
  return `
    <ellipse cx="${cx}" cy="${cy + 26}" rx="224" ry="40" fill="none" stroke="${C.paper}" stroke-width="7" opacity=".28"/>
    <ellipse cx="${cx}" cy="${cy + 20}" rx="156" ry="27" fill="none" stroke="${C.paper}" stroke-width="8" opacity=".5"/>
    <g opacity=".95">${spray.join("")}
    <path d="M${cx - 132} ${cy + 18} Q${cx - 80} ${cy - 30} ${cx} ${cy - 26} Q${cx + 80} ${cy - 30} ${cx + 132} ${cy + 18} Q${cx} ${cy + 38} ${cx - 132} ${cy + 18} Z" fill="${C.paper}"/></g>`;
}

function svg({ fishScale = 1 } = {}) {
  const t = fishScale === 1 ? "" : `transform="translate(${S / 2} ${S / 2}) scale(${fishScale}) translate(${-S / 2} ${-S / 2})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#103d40"/>
      <stop offset=".42" stop-color="#1b6463"/>
      <stop offset=".72" stop-color="#4a8d7f"/>
    </linearGradient>
    <radialGradient id="glow" cx="${SUN.x}" cy="${SUN.y + 60}" r="640" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffc56b" stop-opacity=".9"/>
      <stop offset=".42" stop-color="#ee8350" stop-opacity=".45"/>
      <stop offset=".75" stop-color="#c4442a" stop-opacity=".12"/>
      <stop offset="1" stop-color="#c4442a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.sunTop}"/>
      <stop offset=".75" stop-color="#f6ad55"/>
      <stop offset="1" stop-color="${C.sunBottom}"/>
    </linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a6662"/>
      <stop offset="1" stop-color="${C.ink}"/>
    </linearGradient>
    <linearGradient id="body" gradientUnits="userSpaceOnUse" x1="${f(at(0.55, HMAX)[0])}" y1="${f(at(0.55, HMAX)[1])}" x2="${f(at(0.55, -HMAX)[0])}" y2="${f(at(0.55, -HMAX)[1])}">
      <stop offset="0" stop-color="${C.olive}"/>
      <stop offset=".3" stop-color="${C.oliveLight}"/>
      <stop offset=".55" stop-color="#d9d7c0"/>
      <stop offset="1" stop-color="${C.belly}"/>
    </linearGradient>
    <linearGradient id="tail" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.oliveLight}"/>
      <stop offset="1" stop-color="${C.olive}"/>
    </linearGradient>
    <linearGradient id="fin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7f8f58"/>
      <stop offset=".7" stop-color="#b98a5e"/>
      <stop offset="1" stop-color="#e3866a"/>
    </linearGradient>
    <clipPath id="bodyClip"><path d="${bodyPath()}"/></clipPath>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#05181a" flood-opacity=".45"/>
    </filter>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#sky)"/>
  <rect width="${S}" height="${S}" fill="url(#glow)"/>
  <circle cx="${SUN.x}" cy="${SUN.y}" r="${SUN.r}" fill="url(#sun)"/>
  <circle cx="${SUN.x}" cy="${SUN.y}" r="${SUN.r + 26}" fill="none" stroke="#ffe29a" stroke-width="5" opacity=".35"/>
  ${mountains()}
  ${water()}
  <g ${t}>
    ${splash()}
    <g filter="url(#shadow)">${trout()}</g>
  </g>
</svg>`;
}

// ---------- output ----------
const master = svg();
await writeFile(resolve(root, "icons/icon.svg"), master + "\n");

const outputs = [
  // iOS: opaque full-bleed square. iOS rounds the corners itself.
  { file: "apple-touch-icon.png", size: 180, svg: master },
  // Android / desktop install icons: rounded tile, transparent corners.
  { file: "icon-192.png", size: 192, svg: master, radius: 0.2237 },
  { file: "icon-512.png", size: 512, svg: master, radius: 0.2237 },
  // Maskable: keep the fish inside the 80% safe zone.
  { file: "icon-maskable-512.png", size: 512, svg: svg({ fishScale: 0.8 }) },
];

const browser = await chromium.launch();
try {
  for (const o of outputs) {
    const page = await browser.newPage({ viewport: { width: o.size, height: o.size } });
    const clip = o.radius ? `border-radius:${o.radius * 100}%;overflow:hidden;` : "";
    const src = "data:image/svg+xml;base64," + Buffer.from(o.svg).toString("base64");
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}
      div{width:${o.size}px;height:${o.size}px;${clip}}img{display:block;width:100%;height:100%}</style>
      <div><img src="${src}"></div>`);
    await page.waitForFunction(() => document.querySelector("img").complete);
    await page.screenshot({ path: resolve(root, "icons", o.file), omitBackground: Boolean(o.radius) });
    await page.close();
    console.log("wrote icons/" + o.file);
  }
} finally {
  await browser.close();
}
