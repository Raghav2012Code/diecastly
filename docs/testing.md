# Database testing

Two SQL suites run against the same schema. This file explains which is which,
how to run them on a host that cannot reach a database, and — the part that
drifts — which assertions live where.

## The two suites

| | `supabase/tests/*.sql` | `scripts/*-assertions.sql` |
|---|---|---|
| Format | pgTAP | plain SQL, `raise notice` on failure |
| Runs under | **real pgTAP 1.3.3** | plain PostgreSQL |
| Count | **11 files, 126 assertions** | 3 files, 46 assertions |
| Transactions | `begin; … rollback;` | none — **fixtures are committed** |
| Needs Docker | no, if pointed at a reachable server | no |

`supabase/tests/` is the specification. The `scripts/*-assertions.sql` files are
the fallback for a host that can run neither pgTAP nor a second connection.

## Running them

| Command | What it does |
|---|---|
| `npm run test:db:tap` | pgTAP files under `scripts/pgtap-shim.sql` — a **stand-in**, not pgTAP |
| `npm run test:db:single` · `:catalog` · `:orders` | the three plain-SQL suites under `postgres --single` |
| `npm run test:db:remote` | **real pgTAP** against the linked project |
| `npm run test:db:race` | the `#7` payment-cap race, on two connections |
| `npm run test:db:fallback` | shim self-test + all four plain-SQL suites |
| `npm run verify:sql` | `fallback` + `remote` + `race` |
| `npm run verify:fallback` | typecheck, lint, unit tests, build, contrast, `fallback` |
| `npm run test:db` | **cannot complete here** — `CREATE DATABASE`, which hosted Supabase forbids |

`test:db:remote` needs `SUPABASE_DB_PASSWORD`; the pooler URL comes from
`supabase/.temp/`, which is gitignored. The password is not stored in the repo.

## Reading results honestly

**`psql` exits 0 even when assertions fail.** pgTAP's `finish()` reports a
mismatch by raising, but a failing assertion is reported in the *output*, not the
exit status. A harness that checks only the exit code will report a green run
for a red one.

This is not hypothetical. An earlier harness of mine grepped for `not ok` and
missed the fact that pgTAP also reports failures as `# Failed test N` and
`Looks like you failed N tests` — so eight real failures were reported as
`files_passed=11`. `scripts/pgtap-remote.mjs` now treats any of four signals as
a failure, requires at least one passing assertion, and cross-checks the count
against `plan(N)` read from the file. It is negative-tested: raising a file's
plan makes it exit non-zero.

## Isolation: run against a seeded database

The pgTAP files were originally only ever run against an **empty** database,
which hid five assertions that counted rows across a whole table:

| File | Assertion | Was | Now |
|---|---|---|---|
| 01 | one sale movement per sale | `count(*) where movement_type='sale'` | scoped to the file's product |
| 01 | cancellation restocks once | `count(*) where movement_type='order_cancel'` | scoped to the file's product |
| 06 | one restock movement | `count(*) where movement_type='restock'` | scoped to the file's product |
| 06 | one adjustment movement | `count(*) where movement_type='adjustment'` | scoped to the file's product |
| 06 | `v_low_stock` returns the expected rows | `count(*) from v_low_stock` | scoped to the file's products |

Each returned the right number only because nothing had ever been sold. Run
`test:db:remote` against a populated project and they fail immediately. **Seed
before you trust the suite**, and prefer an assertion scoped to its own fixture
over a global count — a global count is a test that only passes in a vacuum.

## Coverage map

Every plain-SQL assertion, and where it is covered in pgTAP.

### `scripts/money-assertions.sql` (5) → `08_money_trust_boundary.sql`

| Assertion | Covered by |
|---|---|
| anonymous price tampering ignored | 08 — under/over/discount |
| zero catalog price refused | 08 |
| no payment derives unpaid, still fulfilled | 08 |
| stored subtotal and cost | 08 |
| payment capped, refund cap, idempotent retry | 08, 04, 07 |

### `scripts/catalog-assertions.sql` (14) → `10_image_sort_order_atomicity.sql` and others

| Assertion | Covered by |
|---|---|
| non-admin cannot set the primary image | 10 — the admin guard assertion |
| foreign image rejected, primary untouched | 10 |
| reorder applies the order, no duplicates | 10 — **the swap regression guard** |
| partial set rejected, nothing half-applied | 10 (deferred constraint) |
| duplicated id rejected | 10 |
| deleting the primary promotes the successor | **not in pgTAP** — see below |
| deleting every image leaves none, no error | **not in pgTAP** — see below |
| deleting a non-existent image rejected | **not in pgTAP** — see below |
| first image promoted, later ones not | 10 |
| the three RPCs are admin-only | 10 (admin guard), plus `test:db:remote` grant checks |
| gallery view shows only active products | 10 |
| gallery granted to both roles, base table not | **not in pgTAP** — a grant assertion, not behavioural |
| anon cannot enumerate non-active images | 10 |

### `scripts/order-assertions.sql` (27) → spread across `06`, `07`, `11`

| Assertion | Covered by |
|---|---|
| two lines for one product fully restocked | 06, 11 |
| key reused for a different request refused | 07 |
| a genuine retry replays the same order and token | 07 |
| re-split quantities across lines is still a retry | 07 |
| anonymous order cannot overwrite the customer | 07 |
| over-payment refused **and leaves nothing behind** | 07, and 11 for the cancellation path |
| two identical tender lines both recorded | 07 |
| inventory key cannot be reused for another product | 07 |
| payment cap holds, exact balance accepted | 07, and `test:db:race` under concurrency |
| refund cap holds, full refund accepted | 07, and `test:db:race` under concurrency |
| **only the single next step is accepted** | **11** — ported |
| **cancelled and returned are routed to cancel** | **11** — ported |
| **a shipped order cannot be cancelled and nothing moved** | **11** — ported |
| **the reversal window is enforced both ways** | **11** — ported |
| reference contract rejects null types, helpers revoked | **not in pgTAP** — a contract assertion |
| cancelled-without-restock restockable once by reference | 06, and `supabase/tests/` via D80 |

Bold rows are what `11_order_lifecycle.sql` was written for: the four topics that
existed **only** in the plain-SQL suites.

### Deliberately not ported

Three assertions remain plain-SQL only, and the reason is that they are not
behavioural:

- **delete promotes the successor, delete-all leaves none, delete-unknown is
  refused.** Real coverage would be three more pgTAP assertions in a new file.
  Kept in `catalog-assertions.sql` because they are cheap there and the RPC is
  already asserted elsewhere. Porting is a fair piece of follow-up work.
- **grant assertions** (`the three RPCs are admin-only`, `the gallery view is
  granted to both roles`). pgTAP is good at behaviour and poor at catalog
  introspection; `has_function_privilege` would work but reads better as a
  deliberate SQL assertion than smuggled into a behavioural file.
- **the reference contract rejects null types.** This asserts on
  `information_schema` shape, which is a schema-stability check rather than a
  behaviour.

Porting the whole 2,100 lines was rejected deliberately: eleven of thirteen
topics were already covered, so a full port would have duplicated assertions and
doubled the maintenance for no coverage. See issue #19.

## The concurrency gap

`postgres --single` runs one backend. A single backend has no second
transaction to race against, so any read-then-write cap is **structurally
untestable** there — which is the argument for the pgTAP suite existing at all.

`npm run test:db:race` closes it. It opens two connections and forces the
overlap: session A pays and holds its transaction open with `pg_sleep` while
owning the row lock; session B attempts the same payment and must block.

The elapsed time is the assertion. A fast B means the lock did not engage.
Negative-tested by removing `for update` from `record_payment` on a live
database:

```
ok   the second payment blocked on the row lock (3999ms, expected >= 3100ms)
```

with the lock, and without it:

```
FAIL the second payment blocked on the row lock (205ms, expected >= 3100ms)
FAIL the second payment was refused with over_payment — IT WAS ALLOWED
FAIL exactly one payment row exists (found 2)
FAIL the balance is not negative (₹-828.00)
```

Use the **session** pooler (port 5432), not the transaction pooler (6543): two
concurrent transactions need two real backends, and the transaction pooler would
serialise them, testing nothing.

## Known limits

- **`npm run verify` still cannot complete here.** Its last step is
  `test:db` → `scripts/db-suite.mjs`, which issues `CREATE DATABASE`. Hosted
  Supabase forbids that. `test:db:remote` + `test:db:race` is the substitute,
  not a replacement.
- **The pgTAP shim is not pgTAP.** `test:db:tap` proves the assertions execute
  and the SQL behaves as they assert, on a host where nothing else can connect.
  Report it as "under the shim", never as "the pgTAP suite passed". The shim
  self-test (`test:db:shim`) exists so it can still *fail*.
- **`supabase/tests/` files must keep their `begin; … rollback;`.** They are run
  against a live database; a file without the wrapper commits its fixtures.
