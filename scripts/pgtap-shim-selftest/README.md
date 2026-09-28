# pgTAP shim self-test

`scripts/pgtap-shim.sql` is load-bearing: `npm run test:db:tap` runs the real
invariant suite through it, so a change that made the shim more lenient than pgTAP
would turn the whole SQL gate into a green lie. These eight scenarios exist to stop
that, and they are the direct application of the "assert the assertions" rule in
`AGENTS.md` to the thing that asserts the assertions.

Each directory holds one file and is run as its own isolated `--tap` invocation,
because several of the scenarios have to *fail* and must therefore not be able to
take a neighbour down with them.

| Scenario | Must | Why it matters |
|---|---|---|
| `t1-pass` | pass | Correct assertions pass — including `1.10 = 1.1` by value and `is(NULL, NULL)` |
| `t2-wrong-value` | **fail** | A wrong value is a failure, with the actual and expected echoed |
| `t3-plan-mismatch` | **fail** | `plan(5)` with one assertion aborts — the `08_money_trust_boundary.sql` bug |
| `t4-wrong-token` | **fail** | `throws_ok` with a message the error does not carry is a failure |
| `t5-right-token` | pass | `throws_ok` with the real message token passes |
| `t6-no-finish` | **fail** | A file that drops `finish()` fails instead of passing quietly |
| `t7-null-vs-value` | **fail** | `is(NULL, 5)` and `ok(false)` are both failures |
| `t8-lives-fails` | **fail** | `lives_ok` on SQL that raises is a failure |

`npm run test:db:shim` runs all eight. It passes `--skip-migrations`, because none
of these scenarios touch the application schema — the shim alone is enough, which
keeps the whole thing to a few seconds instead of reapplying 17 migrations eight
times.

**Run it after any edit to `scripts/pgtap-shim.sql`.** A shim that has never been
shown to fail is not a gate.
