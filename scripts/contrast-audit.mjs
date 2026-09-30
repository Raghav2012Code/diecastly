/**
 * Contrast gate for the Diecastly design tokens (Stage 3.1, audit §B).
 *
 * Four of the five major audit findings are contrast failures, and nothing in
 * the gate would have caught any of them — so the scan itself is the
 * highest-value change in the plan. It runs on the token values in
 * `src/app/globals.css` (no browser needed) and fails below WCAG AA 4.5:1.
 *
 * What it pins (one check per audit finding):
 *   A1  white on --primary, and --primary as text on --card and on white
 *   A2  --warning-on-dark on petrol (the sidebar badge; flat petrol is the
 *       conservative case — the real badge sits on a white/10 tint which only
 *       helps light text)
 *   A3  --success-text / --warning-text / --destructive-text on their
 *       /10 tints composited over --card (the badge treatment)
 *   A4  --petrol-foreground at 70% over petrol (the sidebar footnote)
 *   A5  no `.dark` block in globals.css and no `darkMode` key in
 *       tailwind.config.ts (dead palette deleted, not wired)
 *
 * Modelled ratios disagree with the browser by ~0.06 at worst, and once by much
 * more: the A2 badge is checked here against FLAT petrol, but it actually renders
 * on `bg-white/10` over petrol and measures 5.41:1, not the 7.32:1 below. That is
 * deliberate. Light text on a white-tinted background is worse than on flat
 * petrol, so this is a lower bound — do NOT "correct" it to the measured 5.41:1,
 * because tightening a check to the best case a token happens to hit destroys
 * the margin that makes it conservative. Measured figures are in
 * docs/design-audit.md §B. A8 (--card off pure white) is visual and ungated.
 *
 * Usage: `node scripts/contrast-audit.mjs [--root <repo-root>]`
 * Exit 0 when every check passes, 1 with FAIL lines otherwise.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : join(here, ".."));

const THRESHOLD = 4.5;

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS ${message}`);
}

/** Parse `75 9% 94%` into [h, s, l]. */
function parseHsl(value) {
  const match = value.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!match) throw new Error(`Not an HSL triplet: "${value}"`);
  return [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

function luminance([r, g, b]) {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` over `bg` (both linear-ish sRGB triplets). */
function over(fg, bg, alpha) {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
}

/** Read the `:root` custom properties out of globals.css. */
function readTokens(cssPath) {
  const css = readFileSync(cssPath, "utf8");
  const rootBlock = css.match(/:root\s*{([^}]*)}/s);
  if (!rootBlock) throw new Error("No :root block found in globals.css");
  const tokens = {};
  for (const match of rootBlock[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return { css, tokens };
}

function check(name, fg, bg) {
  const ratio = contrast(fg, bg);
  const label = `${name}: ${ratio.toFixed(2)}:1`;
  if (ratio < THRESHOLD) fail(`${label} (needs ${THRESHOLD}:1)`);
  else pass(label);
}

const { css, tokens } = readTokens(join(root, "src/app/globals.css"));

const rgb = (name) => hslToRgb(...parseHsl(tokens[name]));
const WHITE = [1, 1, 1];

// A1 — the vermilion, both directions.
check("white on --primary", WHITE, rgb("primary"));
check("--primary on --card", rgb("primary"), rgb("card"));
check("--primary on white", rgb("primary"), WHITE);

// A2 — sidebar badge: light amber on petrol.
check("--warning-on-dark on petrol", rgb("warning-on-dark"), rgb("petrol"));

// A3 — badge text on its own tint (10% fill over --card).
const card = rgb("card");
for (const name of ["success", "warning", "destructive"]) {
  const tint = over(rgb(name), card, 0.1);
  check(`--${name}-text on ${name}/10 over card`, rgb(`${name}-text`), tint);
}

// A4 — sidebar footnote at 70% over petrol.
check("petrol-foreground/70 on petrol", over(rgb("petrol-foreground"), rgb("petrol"), 0.7), rgb("petrol"));

// A5 — dead dark palette stays deleted.
if (/\.dark\s*{/.test(css)) fail("globals.css still contains a .dark block");
else pass("no .dark block in globals.css");

const tailwind = readFileSync(join(root, "tailwind.config.ts"), "utf8");
if (/darkMode/.test(tailwind)) fail("tailwind.config.ts still sets darkMode");
else pass("no darkMode key in tailwind.config.ts");

if (process.exitCode) {
  console.error("\ncontrast-audit: failures above — see docs/design-audit.md §B.");
} else {
  console.log("\ncontrast-audit: all checks passed.");
}
