# Release checklist

The gate for a release, and an honest record of what is and is not verified.
Written at the end of Phase 7.

Two rules govern this document:

- **A green run is not a claim.** Every line below says what was executed, not
  what was read. Reading a migration is not verifying it.
- **Absence of evidence is recorded as absence.** Where a check could not be run
  on this host, the line says so and names what was run instead. "The suite
  passed" and "the suite could not run, and here is what was actually verified"
  are different statements, and only the second is useful.

## 1. What is verified, and how

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean |
| Unit tests | `npm test` | 272 passing, 16 files |
| Production build | `npm run build` | clean |
| SQL: money | `npm run test:db:single` | 17 migrations applied, all assertions passed |
| SQL: catalog | `npm run test:db:catalog` | as above |
| SQL: orders | `npm run test:db:orders` | as above, 11 sections |
| Full gate | `npm run verify:fallback` | all of the above, in order |

All SQL runs apply **every migration** to a scratch database first. A suite that
passes against a database the migrations did not build is not a result.

### The pgTAP suite did not run

`supabase/tests/*.sql` has **never** been executed. pgTAP is not bundled with the
PostgreSQL build on this host and no package for it exists, so
`CREATE EXTENSION pgtap` needs a cross-toolchain compile that cannot be done
here.

This means `npm run test:db` and `npm run verify` **cannot complete on this
machine** — `test:db` exits non-zero when no server is reachable rather than
skipping, which is correct behaviour and the reason `verify:fallback` exists.
The plain-SQL suites are a substitute with real coverage of the money and ledger
paths, and they are not equivalent: no pgTAP means no `throws_ok`, no
`lives_ok`, no per-test isolation, and no `CREATE DATABASE` scratch schema.

**Before a release, run the pgTAP suite on a host that can.** See issue #19.

### The assertion suites are known to be able to fail

A green plain-SQL suite proves nothing unless it can go red. Each guard added or
relied on in Phase 7 was broken on purpose and the suite was re-run:

| Mutation | Expected to break | Result |
| --- | --- | --- |
| Drop the `invalid_transition` guard from `update_order_status` | the transition table | suite red, `FAIL skipping steps must raise invalid_transition, got no error` |
| Drop the `use_cancel_order` routing guard | the cancelled/returned routing | suite red, `FAIL cancelled must raise use_cancel_order` |
| Drop the in-person reversal window from `cancel_order` | the 24-hour window | suite red, `FAIL a 10-day-old in-person sale must raise outside_reversal_window, got no error` |
| Invert the refusal stock comparison | proves the comparison is live | suite red, `FAIL the refused cancel moved stock` |
| Revoke-then-delete pattern (`revoke … from anon`) | function grants | covered in the catalog suite; `grant` to the wrong role is used for negative tests, because deleting a `revoke` grants nothing |

The fourth row is worth stating plainly: a mutation that restocks *before* the
eligibility check **cannot** make the suite red, because `raise exception` aborts
the whole transaction and the restock is rolled back with it. In a
single-transaction `security definer` RPC no raise-based implementation can
half-apply. The "nothing moved" assertion is therefore a cheap invariant rather
than a load-bearing one, and it is in the suite as a tripwire, not as proof.

## 2. Responsive QA — what was actually rendered

The Next.js dev server was run and pages were measured in a real browser
(Playwright) at 320, 375, 767, 768, 1024, 1280 and 1536 px.

| Surface | Viewports | Result |
| --- | --- | --- |
| `/` catalog | 320–1536 | no horizontal overflow |
| `/cart` | 320–1536 | no overflow; empty state matches `ux.md` §10 |
| `/checkout` | 320–1536 | no overflow; empty-cart state correct after hydration |
| `/products/<slug>` error path | 375 | the `(store)` error boundary renders, after hydration |
| `/order/<n>` without a token | 375 | 404 page renders, no order data leaked |
| `/admin` | 375 | middleware redirects to `/admin/login?next=%2Fadmin` |
| `/preview?screen=admin` | 320–1280 | all 9 nav items reachable, badge present, no overflow |
| `/preview?screen=pos` | 320–1280 | no overflow **after the fix below** |
| `/preview?screen=order` | 320–1280 | no overflow **after the fix below** |
| `/preview?screen=orders` | 320–1280 | no overflow |
| `/preview?screen=receipt` | 320–1280 | no overflow |

### Defects found and fixed in Phase 7

1. **The admin had no navigation below 768 px.** The sidebar is `hidden md:flex`
   and it was the only nav, so a phone showed the header, the page and no way to
   reach any other section. Measured, not assumed: with the new bar removed from
   the preview shell, visible nav items at 375 px = **0**. With it, **9**.
2. **The POS screen and order detail overflowed a 375 px viewport** (430 px and
   537 px wide). Cause: `lg:grid-cols-[minmax(0,1fr)_23rem]` constrains the wide
   column only *from* `lg` up; below that the implicit single column is
   auto-sized and grows to fit its widest content. Fixed by constraining the base
   column and adding `min-w-0` to the children, since a grid item also defaults
   to `min-width: auto`. Re-measured: no overflow at 320–1280 px.

### What responsive QA did **not** cover

- **No page was rendered against a real database.** The storefront measurements
  were of the *degraded* states (settings fallback, catalog load failure), which
  is a genuine result for those states and says nothing about how populated
  pages look. See issue #20.
- **The admin layout's own page content was never rendered**, because it requires
  a session. The nav was rendered in the preview harness against copied shell
  markup; the real layout's server-side `getLowStock` call is covered by
  typecheck and lint only.
- **Print styles were not checked.** `print:` variants exist on the admin shell
  and the receipt.
- **No real browser other than Chromium was used**, and no Safari/WebKit,
  Firefox or touch-device pass.

## 3. Ledger and money — invariant checklist

Each of these is asserted in SQL, not just intended:

- [x] Stock moves only through `apply_stock_delta` and `record_movement`; the
      ledger tables have no direct-write path from the UI lanes.
- [x] Money is INR `numeric(12,2)`; every sum on the reporting side goes through
      `addMoney` and is rounded once.
- [x] Order lines and payments snapshot name, SKU, price and cost at write time.
- [x] `inventory_movements` and `payments` are append-only; no update or delete
      path is granted.
- [x] Products are archived (`status`), never hard-deleted.
- [x] Cash on delivery is capped at the order total; the cap is enforced
      server-side in the RPC, not only in the POS form.
- [x] Online order placement is idempotent per key, and the fingerprint excludes
      the shipping address so a genuine retry with a corrected address is not
      rejected as a duplicate (D50).
- [x] Cancellation restocks once; a repeat cancel returns the existing result.
- [x] Every dated or reported figure uses IST day boundaries.
- [ ] **The concurrency half of the payment cap is unverified.** The cap is
      asserted in sequence, not under two simultaneous sessions. See issue #19.

## 4. Security checklist

- [x] RLS on every table the anon key can touch; the storefront reads only
      through `security definer` views that expose no cost columns.
- [x] `settings` is readable by anon but exposes no secret; the UPI QR path is
      public by design.
- [x] Guest order access requires the order number **and** the unguessable token;
      a wrong token and a wrong order number are indistinguishable to the caller
      (D59), so neither is a probe for the other.
- [x] `settings` write and all ledger writes require `require_admin()`.
- [x] Raw database error text is never surfaced to a shopper; the storefront
      error state shows a fixed message.
- [ ] **No penetration test and no RLS review against a live Supabase instance.**
      The policies are asserted structurally, not adversarially.

## 5. Accessibility — partial

- [x] Every nav has an `aria-label`; the active item carries `aria-current="page"`.
- [x] The low-stock badge is not silently invisible: the number is visual and a
      screen reader is told "N products low on stock" (verified in the rendered
      DOM).
- [x] `prefers-reduced-motion` is honoured globally in `globals.css`.
- [x] Focus is visible on the controls checked by hand below. There is **no**
      global `focus-visible` rule, so a control that never declares one has no
      visible focus ring — this is a known gap, not a verified property.
- [ ] **No screen-reader pass, no axe scan, no keyboard-only walkthrough, and no
      contrast audit.** The claim above is a property of the markup, not the
      result of a test.

## 6. Before shipping

- [ ] Run `npm run verify` — the real gate, including pgTAP — on a host with
      Docker or a reachable PostgreSQL. Until this passes, the SQL half of the
      release is unverified.
- [ ] Work issue #20: render the storefront and every admin page against a real
      seeded database, at 375 px and 1280 px, and re-run this checklist's
      responsive table against populated pages rather than degraded ones.
- [ ] Add the payment-cap concurrency test from issue #19.
- [ ] Decide the open tax/GST question (D60). No tax column exists and no tax is
      computed; nothing in the release may imply otherwise.
- [ ] Create the admin user from the SQL under **Create the admin user** in the
      README. Public sign-up is disabled.
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the real origin, or order confirmation links
      will be wrong.
- [ ] Confirm the UPI QR image is served from `upiQrPath` and not committed.
- [ ] Re-check the print output of a receipt on A4.

## 7. Honest summary

What is strong: the money and ledger invariants are asserted in SQL, the
assertions are known to be able to fail, the build and the 272 unit tests are
green, and the responsive defects that were found are fixed and re-measured.

What is not established: **no page has been rendered against a real database,
the pgTAP suite has never run, and the payment cap has not been tested
concurrently.** This is a codebase whose logic is well covered and whose
*rendered output* is almost entirely unverified. It should not ship until
sections 6's first two boxes are ticked on a host that can run the real gate.
