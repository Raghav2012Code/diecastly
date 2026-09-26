# Design audit — findings and fix plan

A `hallmark audit` + `frontend-design-deslop` pass over the whole product, run
against **rendered pages** in Chromium rather than against the source alone.

- **Date:** 2026-09-27
- **Audited:** storefront (`/`, `/cart`, `/checkout`, `/products/[slug]`,
  `/order/[n]`, `/admin/login`) and the admin surfaces via the preview harness
  (`admin`, `orders`, `order`, `pos`, `receipt`)
- **Method:** source review against the named anti-pattern catalogue, plus a
  computed contrast scan of every text node on every screen (compositing
  translucent backgrounds up the ancestor chain, then WCAG 2.x relative
  luminance). Screenshot review at 1280 px.
- **Verdict: 0 critical · 5 major · 2 minor — and the 5 majors are all
  accessibility or dead-code, not taste.**

**This is not slop.** The honest headline is that the visual system is
genuinely well made and the failures are almost entirely measurable contrast
and one piece of dead infrastructure. The list of cleared tells is as long as
the findings and is in §C — it matters, because it means the fix list is short
and the work that produced this design should not be thrown away.

---

## A. Findings

### A1 · `--primary` fails contrast in *both* directions — `critical`

`--primary: 21 90% 48%` → `rgb(233, 89, 12)`.

- White text on it: **3.56:1** (needs 4.5)
- It as text on a white card: **3.56:1** (needs 4.5)

This is one token causing every one of these, all measured in the browser:

| Element | Where | Measured |
| --- | --- | --- |
| Every primary button | "Try again", "Browse the catalog", "Sign in", "Enter the amount received" | 3.56:1 |
| The `D` wordmark tile | storefront header, admin sidebar, all 10 screens | 3.56:1 |
| Order-number link `text-primary` | orders table, 12 px | 3.56:1 |

It is the main call-to-action colour of the entire product, and it does not pass
on either side. **Fix — one token, two ways out:**

**Option A — keep white text, darken the vermilion.**

| `--primary` | white-on-it | as-text-on-white |
| --- | --- | --- |
| `hsl(21 90% 48%)` (current) | 3.56:1 ✗ | 3.56:1 ✗ |
| `hsl(21 90% 42%)` | 4.53:1 ✓ | 4.53:1 ✓ |
| `hsl(21 90% 40%)` | 4.91:1 ✓ | 4.91:1 ✓ |
| `hsl(21 90% 38%)` | 5.32:1 ✓ | 5.32:1 ✓ |

`hsl(21 90% 40%)` is the smallest change that clears AA with margin. It stays
recognisably the same vermilion.

**Option B — keep the vermilion, make `--primary-foreground` the ink.**

`rgb(23, 26, 28)` — which is *already* `--foreground` — on the current vermilion
is **4.91:1** ✓. Pure black would be 5.90:1, so there is real headroom.

Option B preserves the brand colour exactly and changes the CTA from white-on-
vermilion to ink-on-vermilion. On a warm-paper editorial palette that arguably
looks better and more deliberate; it is also the bigger visual change, and it
has to be checked against the vermilion-tinted `bg-primary/10` surfaces, where
ink text would need re-checking in the other direction.

**This is a design decision, not a bug fix. It needs your call.** §D.

### A2 · The low-stock badge is illegible — `critical` *(self-inflicted, Phase 7)*

The badge I added in Phase 7 is `bg-warning/20 text-warning` on the petrol
sidebar. Measured: **2.25:1**. The worst failure on the site, and I shipped it.

`--warning: 33 100% 33%` is a dark amber; `20%` of it over petrol `#0f383e` is
still dark, and the text on top is the same dark amber. Dark-on-dark.

Fix — a light-on-dark treatment inside the petrol context, which needs its own
value rather than a darkened global:

| text | on a matching tint over petrol | |
| --- | --- | --- |
| `hsl(38 100% 55%)` | 4.47:1 | ✗ |
| `hsl(38 100% 62%)` | 4.71:1 | ✓ |
| `hsl(38 100% 70%)` | 5.02:1 | ✓ |

Add `--warning-on-dark` (or scope the badge to a fixed light value) rather than
retuning the global `--warning`, which has to keep working on the light tints in
A3.

### A3 · Status-badge text fails on its own tint — `major`

Measured in the browser: "Part paid" **4.35:1**, "Completed" **4.27:1** (need
4.5). Modelled against a pure-white card, `--success` and `--warning` come out
at 4.17:1 and 3.78:1 — the browser numbers are the ground truth and differ
because the badge composites over `--card` with a border, so **re-measure after
changing rather than trusting the model.**

Darkening by 4–6 L clears it in both cases:

| token | current | −4 L | −6 L |
| --- | --- | --- | --- |
| `--success` | 4.17:1 ✗ | 4.94:1 ✓ | 5.44:1 ✓ |
| `--warning` | 3.78:1 ✗ | 4.54:1 ✓ | 4.96:1 ✓ |
| `--destructive` | 4.63:1 ✓ | — | already passes |

A third fix is better than darkening: give the badge a **dedicated text token**
(`--success-text`, `--warning-text`, `--destructive-text`) separate from the
fill used for dots and borders. That decouples "what colour is this status" from
"is this text legible", which is where this class of bug comes from. More tokens,
but it is the one that stops it recurring.

### A4 · Sidebar footnote fails — `major`

`"Stock moves only through the ledger."` at `text-petrol-foreground/45`, 11 px:
**3.53:1**. Petrol foreground is `11.19:1` on petrol at full strength, so the
opacity is the whole problem. `/60` or `/70` clears it; the line is decoration,
so raising it costs nothing.

### A5 · Dark mode is 43 lines of dead code — `major`

- `tailwind.config.ts:4` sets `darkMode: ["class"]`
- **nothing anywhere adds the `.dark` class** — no theme provider, no
  `next-themes`, no inline script
- **zero `dark:` variants in zero source files**
- `globals.css:62–105` is a complete dark palette that **can never apply**

Verified in the browser: under `prefers-color-scheme: dark` the body stays
`rgb(240, 241, 238)`, the light cream, and `documentElement.className` is empty.

This is worse than a missing feature. It reads as "we did dark mode" while
shipping nothing, and a 43-line block of plausible-looking tokens is a trap for
the next person who assumes it works. **Either wire it or delete it** — and
deleting is the defensible default, because Phase 8 would otherwise inherit a
palette that has never been looked at. See §D.

### A6 · The orders filter bar — `major`

`/admin/orders`, measured at 1280 px: seven controls in one flat, unlabelled
row — search, three selects, two date inputs, "Apply", "Clear".

- **Placeholder used as the label.** "Any status", "Any payment state", "Any
  channel" are *values*, not labels. There is no visible field label anywhere in
  the bar, so a screen-reader user landing mid-row has no idea which control is
  which. This is the deslop craft rule *"do not use placeholder text as the
  label"*, and here it is also an accessibility defect.
- **Native date inputs** render as `dd----yyyy` — locale-dependent, and they
  look broken next to every other control.
- Nothing groups the controls, so there is no visual answer to "which of these
  seven are filters and which two are actions".

Fix: label the selects, or replace the row with a labelled filter group; swap
the two date inputs for a styled pair or a single "date range" control; and
separate the actions from the fields rather than trailing them inline.

### A7 · Empty and error states centre everything, in a large dead box — `major`

`/`, `/cart`, `/checkout` all render their empty or error state as a bordered
card with heading, body and button **all centred**, inside `min-h-[60vh]`. At
1280×900 the card is ~220 px tall and roughly 400 px of empty page sits below it
before the footer.

The page-level layout is *not* centred — "Checkout" and its deck are left-aligned
in a `max-w-*` column, which is correct. The tell is confined to the empty/error
card, and it repeats on every storefront route, so it reads as a house style
rather than a one-off.

Fix: left-align the empty-state content, or keep it centred but drop the
`min-h-[60vh]` so the page doesn't reserve half a viewport for three lines of
text. Both are small.

### A8 · `--card` is pure white — `minor`

`--card: 0 0% 100%` on a page of `--background: 75 9% 94%` = `rgb(240,241,238)`.
The page is properly tinted; the card is `#ffffff` sitting on it, which is the
"pure black, pure white" flatness tell. `hsl(75 12% 97%)` keeps the same 1.13:1
step and stops being pure white. Cosmetic, not a gate.

### A9 · The storefront has no route to the business — `minor`

The header is a wordmark and "Cart". The footer is one line: a tagline plus
"Catalog · Cart". There is **no contact, shipping, returns or UPI-details page at
all** — so a shopper who wants to know whether you ship to their PIN code, or
how to reach you, has nowhere to go. `ux.md` does not require one, so this is a
judgement call rather than a spec violation. It is a conversion and trust
problem more than an aesthetic one.

---

## B. Fix plan

Ordered so each step is verifiable before the next depends on it.

| # | Fix | Files | Verify by |
| --- | --- | --- | --- |
| 1 | **Decide A1 Option A or B**, then change one token | `globals.css` | re-run the contrast scan; assert no `bg-primary` element below 4.5:1 |
| 2 | Fix the low-stock badge with a dark-context value (A2) | `globals.css`, `admin/nav.tsx` | scan the admin shell; badge ≥ 4.5:1 |
| 3 | Badge text tokens, or darken `--success`/`--warning` by 4–6 L (A3) | `globals.css`, `components/ui/badge.tsx` | scan `orders` + `order`; no badge below 4.5:1 |
| 4 | Raise the sidebar footnote opacity (A4) | `admin/layout.tsx` | scan `admin` |
| 5 | **Decide** wire-up vs deletion for dark mode (A5) | `globals.css`, `tailwind.config.ts` | either a rendered dark screenshot, or no `.dark` block and no `darkMode` key |
| 6 | Rebuild the orders filter bar with real labels (A6) | `components/admin/order-filters.tsx` | visual + a11y snapshot; every control has an accessible name |
| 7 | Left-align or de-void the empty/error states (A7) | storefront empty/error components | screenshot `/cart` at 1280 |
| 8 | Tint `--card` off pure white (A8) | `globals.css` | visual |
| 9 | Decide whether the storefront needs a contact page (A9) | new route + footer | product decision, not a gate |

**Make the contrast scan a gate, not a one-off.** The single highest-value change
in this plan is not any individual token — it is turning the scan into
`scripts/contrast-audit.mjs` and wiring it into `npm run verify`. Four of the
five majors above are contrast failures, and nothing in the current gate would
have caught any of them. A scan that walks every text node, composites
translucent ancestors, and fails on a ratio below the WCAG threshold would make
A1–A4 impossible to reintroduce. Do this **first**, before the token changes, so
each fix is confirmed by the same check that found the bug.

### Verification, stated honestly

- Contrast figures are **computed from the rendered DOM** and are ground truth.
- The fix-candidate ratios in A1 and A2 are **modelled**, from the same maths,
  against pure white or a flat petrol. They must be re-measured in the browser
  after the change; the A3 table shows the model and the browser disagreeing by
  ~0.2, which is why re-measuring is part of the plan and not optional.
- No page was rendered against a **real database**. The storefront was audited
  in its degraded state (settings fallback, catalog load failure) — genuinely
  representative of those states and not of a populated catalog. See issue #20.

---

## C. Cleared — checked and *not* slop

Recorded so a later pass does not re-raise them, and because the list is the
evidence that the design system is real.

**Tokens and palette**
- No gradient anywhere in the codebase — zero matches for `gradient`.
- No purple / indigo / violet. The palette is warm cream paper, vermilion accent,
  petrol dark. Contested territory, deliberately.
- `--radius: 0.25rem` (4 px). No blob rounding. All 9 `rounded-full` uses are
  genuine circles — avatars, status dots, the cart badge.
- `--card` is the only pure-white surface (A8), on an otherwise tinted page.

**Typography**
- Real 2+1 pairing: **Saira Condensed** (display) + **IBM Plex Sans** (body) +
  **IBM Plex Mono** (numbers, SKUs, order numbers). Not Inter, not Roboto, not
  `system-ui`.
- **Zero italic declarations in the entire codebase** — the single most reliable
  AI tell is absent.
- No gradient headline, no `background-clip: text`.

**Structure**
- No hero → 3-feature-cards → testimonials → CTA. It is an application, and it is
  laid out like one.
- No full-viewport centred hero. No `100vh`/`100dvh`/`min-h-screen` hero.
- Nav is a **side-rail** (N3), not wordmark-plus-four-links-plus-CTA.
- Footer is a **single line** (Ft2), not four columns plus a social row.
- No card-in-card. No side-stripe cards. No icon-tile-above-heading feature cards.
- No eyebrow labels anywhere.

**Craft**
- One icon library — `lucide-react` across all 11 files. No emoji as icons.
- `tabular-nums` on money (`globals.css:124`), and money columns are
  **right-aligned** in the orders table, the order detail and the receipt.
- Status badges carry a **dot plus text**, so colour is never the only signal.
- No `transition-all`, no `hover:scale-*`, no bouncy easings, no `100vw`, no
  `z-index: 9999`.
- Motion is three keyframes (dialog, toast, line), all ≤160 ms, all `ease-out`,
  with a `prefers-reduced-motion` kill switch.
- No hairline-border-plus-shadow stacking on the same element.
- No invented metrics, no fabricated testimonials, no logo wall. Every number on
  screen comes from the ledger and reconciles (order DC-2026-00061: 599 + 1,098 =
  1,697; cost 1,140; profit 557).
- Sample data uses plausible Indian names — Priya Nair, Arjun Rao, Karthik
  Subramanian — not "Jane Doe". SKUs are real (`HW-69CAM`, `MB-DEF110`).

**One thing that is genuinely a signature move:** the POS receipt panel is
deliberately *not* app chrome — off-white receipt stock, dotted separators, mono
figures — so the artefact the customer walks away with looks like the artefact,
not like the software that produced it. That is a design decision someone made on
purpose. It should survive whatever else changes.

---

## D. Open decisions for you

1. **A1 — the vermilion.** Option A (darken to `hsl(21 90% 40%)`, keep white
   buttons, smallest visual change) or Option B (keep the colour, ink on
   vermilion, bigger change to every CTA). My recommendation is **Option A**: it
   is a one-token change that cannot break anything else, and it keeps the CTAs
   reading as white-on-colour, which is what the design currently assumes
   everywhere. Option B is prettier on warm paper but needs the tinted
   `bg-primary/*` surfaces re-checked in the opposite direction.

2. **A5 — dark mode.** Wire it up, or delete the 43 lines. I lean **delete**:
   it has never been rendered, a never-seen palette is a liability, and dark
   mode is real work (elevation by lightness, desaturated accents, a full
   contrast pass) rather than a config flag. If you want it, it should be a
   roadmap phase with its own audit — not a side effect of a token edit.

3. **A9 — a contact page on the storefront.** A real shop with no way to ask a
   question is a conversion leak. Out of scope for a polish pass; flagging it
   because no amount of visual work fixes it.
