#!/usr/bin/env node
/**
 * The #7 payment-cap race, with two genuinely overlapping transactions.
 *
 * WHY THIS IS NOT A pgTAP FILE
 *
 * pgTAP runs inside one session and one transaction. A single backend has no
 * second transaction to race against, so the defect this test exists for is
 * structurally untestable there - which is the entire argument issue #19 makes
 * for the plain-SQL suites being an inadequate substitute. This script drives
 * two separate psql connections instead, which is what makes the race real.
 *
 * THE DEFECT
 *
 * The cap on a payment is a read-then-write: read the balance, compare it to the
 * amount, insert. Under READ COMMITTED two concurrent payments for the same
 * order each read the same balance, each pass the cap, and both insert - giving
 * exactly the negative balance the cap exists to prevent. Nothing else stops it,
 * because the idempotency key is unique but a retry uses the SAME key, whereas
 * the race uses two different ones. The fix is `select ... from orders for update`
 * at the top of the function, which serialises the two.
 *
 * HOW THE OVERLAP IS FORCED, WITHOUT FLAKY SLEEP-AND-HOPE
 *
 * Session A begins, pays, then holds its transaction open with `pg_sleep` while
 * still owning the row lock. Session B starts a moment later and attempts the
 * same payment; it must BLOCK on that lock and cannot proceed until A commits.
 *
 * The elapsed time is therefore not just incidental, it is the assertion: B
 * returning quickly means the lock did not engage and the guard is missing,
 * which is exactly the regression this is written to catch. B returning slowly
 * and then raising over_payment means the lock held and the second payment was
 * correctly refused after re-reading the balance.
 *
 * No IPC between the sessions is needed - `pg_sleep` holds the lock for a known
 * window, so timing is deterministic rather than coordinated.
 *
 * CONNECTION
 *
 * Talks to whatever PGHOST/PGPORT/PGUSER/PGPASSWORD point at. It does not assume
 * Supabase: on a host with Docker, point it at the local stack. Against the
 * linked cloud project, use the SESSION pooler (port 5432), not the transaction
 * pooler (6543) - two concurrent transactions need two real backends, and the
 * transaction pooler would serialise them, which is precisely the thing being
 * tested.
 *
 * Exits non-zero on any failure.
 */

import { spawn } from "node:child_process";

const PSQL = process.env.PSQL ?? "psql";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@diecastly.test";

let failures = 0;

function ok(condition, message) {
  if (condition) {
    console.log(`  ok   ${message}`);
  } else {
    console.error(`  FAIL ${message}`);
    failures += 1;
  }
}

/** Runs one SQL string to completion, returning { text, durationMs }. */
function run(sql, { label = "sql" } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(
      PSQL,
      [
        "-X",
        "-q",
        "-t",
        "-A",
        // Explicit: through the pooler the user is `postgres.<ref>`, and without
        // -d psql uses the user name as the database name and fails with
        // 'database "postgres.<ref>" does not exist'.
        "-d",
        process.env.PGDATABASE ?? "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
      ],
      { env: process.env },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ text: out.trim(), err: err.trim(), code, durationMs: Date.now() - started, label }),
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The admin claim both sessions need; record_payment is security definer. */
function adminClaims() {
  return `select set_config('request.jwt.claims',
    (select json_build_object('sub', a.id::text, 'role', 'authenticated')::text
       from public.admin_users a where a.email = '${ADMIN_EMAIL}'), true);`;
}

async function scalar(sql) {
  const r = await run(sql);
  if (r.code !== 0) throw new Error(`${r.err}\n${sql}`);
  // Take the LAST non-empty line. A script body that sets the admin claim and
  // then runs the query emits two result sets, and `-t -A` returns both - so the
  // claim's JSON would otherwise end up glued onto the front of the answer.
  const lines = r.text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length === 0 ? "" : lines[lines.length - 1];
}

console.log("\n  #7 payment-cap race — two connections, overlapping transactions\n");

// Proving the connection is real before trusting anything below.
const backend = await scalar("select count(*) from pg_stat_activity where pid = pg_backend_pid();");
ok(backend === "1", "the probe reached a live backend");

const heldMs = Number(process.env.RACE_HOLD_MS ?? 5000);
const gapMs = Number(process.env.RACE_GAP_MS ?? 1200);

// ---------------------------------------------------------------------------
// Payment race: two concurrent payments, each for the FULL order total.
// Exactly one may succeed.
// ---------------------------------------------------------------------------

console.log("\n  record_payment — two full payments racing");

// Picked at run time rather than hard-coded: the seed generates product ids, so
// a fixed uuid would pass today and rot the moment anyone re-seeds.
const probeProduct = await scalar(`
  select p.id from public.products p
    join public.inventory_stock s on s.product_id = p.id
   where p.status = 'active' and s.quantity >= 5
   order by p.slug limit 1;`);
ok(Boolean(probeProduct), `probe product ${probeProduct} found`);

const orderNo = await scalar(`
  ${adminClaims()}
  select public.place_online_order(
    '[{"productId":"${probeProduct}","quantity":1}]'::jsonb,
    '{"name":"Race Probe","phone":"9000001234","addressLine1":"1 Lock St","city":"Bengaluru","state":"KA","postalCode":"560001"}'::jsonb,
    'cod'::public.payment_method,
    '{"line1":"1 Lock St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
    'Concurrency probe', 'race-' || gen_random_uuid())
  ->> 'order_number';`);

const orderId = await scalar(`select id from public.orders where order_number = '${orderNo}';`);
const total = Number(
  await scalar(`select total::text from public.orders where id = '${orderId}';`),
);
ok(Boolean(orderId) && total > 0, `probe order ${orderNo} created for ₹${total.toFixed(2)}`);

// A holds the lock open. It pays first and then sleeps INSIDE its transaction,
// so the row stays locked until its COMMIT.
const sessionA = run(
  `begin;
   ${adminClaims()}
   select public.record_payment('${orderId}', ${total}, 'cash'::public.payment_method, 'race-a-' || gen_random_uuid(), 'race-a-' || gen_random_uuid());
   select pg_sleep(${heldMs / 1000});
   commit;`,
  { label: "A" },
);

await sleep(gapMs);

// B arrives while A still owns the lock. It must block.
const sessionB = run(
  `begin;
   ${adminClaims()}
   select public.record_payment('${orderId}', ${total}, 'cash'::public.payment_method, 'race-b-' || gen_random_uuid(), 'race-b-' || gen_random_uuid());
   commit;`,
  { label: "B" },
);

const [a, b] = await Promise.all([sessionA, sessionB]);

// B is launched `gapMs` after A, so its measured duration is (held - gap), not
// `held`. Anything near zero means the lock never engaged.
const expectedBlock = heldMs - gapMs;
const blockFloor = expectedBlock - 700;

ok(
  b.durationMs >= blockFloor,
  `the second payment blocked on the row lock (${b.durationMs}ms, expected >= ${blockFloor}ms)`,
);

ok(a.code === 0, "the first payment succeeded");
ok(
  b.code !== 0 && b.err.includes("over_payment"),
  `the second payment was refused with over_payment${b.code === 0 ? " — IT WAS ALLOWED" : ""}`,
);

const payCount = Number(
  await scalar(`select count(*) from public.payments where order_id = '${orderId}';`),
);
ok(payCount === 1, `exactly one payment row exists (found ${payCount})`);

const balance = await scalar(
  `select balance::text from public.v_order_financials where order_id = '${orderId}';`,
);
ok(Number(balance) >= 0, `the balance is not negative (₹${balance})`);

// ---------------------------------------------------------------------------
// Refund race: two concurrent refunds, each for the FULL amount received.
// refund_payment had the identical defect against net_paid.
// ---------------------------------------------------------------------------

console.log("\n  refund_payment — two full refunds racing");

const refundOrder = await scalar(`
  ${adminClaims()}
  select public.place_online_order(
    '[{"productId":"${probeProduct}","quantity":1}]'::jsonb,
    '{"name":"Refund Probe","phone":"9000005678","addressLine1":"2 Lock St","city":"Bengaluru","state":"KA","postalCode":"560001"}'::jsonb,
    'cod'::public.payment_method,
    '{"line1":"2 Lock St","city":"Bengaluru","state":"KA","postal_code":"560001","country":"India"}'::jsonb,
    'Concurrency probe', 'race-r-' || gen_random_uuid())
  ->> 'order_number';`);

const refundId = await scalar(`select id from public.orders where order_number = '${refundOrder}';`);
const refundTotal = Number(
  await scalar(`select total::text from public.orders where id = '${refundId}';`),
);

// Settle it first, committed, so there is a real net_paid to refund against.
await run(`
  ${adminClaims()}
  select public.record_payment('${refundId}', ${refundTotal}, 'cod'::public.payment_method, 'settle', 'settle-' || gen_random_uuid());`);

const refundA = run(
  `begin;
   ${adminClaims()}
   select public.refund_payment('${refundId}', ${refundTotal}, 'cod'::public.payment_method, 'race refund A', 'rr-a-' || gen_random_uuid());
   select pg_sleep(${heldMs / 1000});
   commit;`,
  { label: "refund A" },
);

await sleep(gapMs);

const refundB = run(
  `begin;
   ${adminClaims()}
   select public.refund_payment('${refundId}', ${refundTotal}, 'cod'::public.payment_method, 'race refund B', 'rr-b-' || gen_random_uuid());
   commit;`,
  { label: "refund B" },
);

const [ra, rb] = await Promise.all([refundA, refundB]);

ok(
  rb.durationMs >= blockFloor,
  `the second refund blocked on the row lock (${rb.durationMs}ms, expected >= ${blockFloor}ms)`,
);
ok(ra.code === 0, "the first refund succeeded");
// Either code is a correct refusal. Once A has refunded the full amount,
// net_paid is 0, and refund_payment distinguishes "you asked for more than was
// received" from "there is nothing left to refund" - so the second one raises
// nothing_to_refund, not over_refund. Asserting the specific code would have
// been asserting the wrong thing; what matters is that it refused.
ok(
  rb.code !== 0 && (rb.err.includes("over_refund") || rb.err.includes("nothing_to_refund")),
  `the second refund was refused (${rb.code === 0 ? "IT WAS ALLOWED" : rb.err.split("\n")[0]})`,
);

const netPaid = await scalar(
  `select net_paid::text from public.v_order_financials where order_id = '${refundId}';`,
);
ok(Number(netPaid) >= 0, `net_paid did not go negative (₹${netPaid})`);

// ---------------------------------------------------------------------------
// Cleanup. The probe orders are real rows in the demo ledger and must not be
// left behind, so they are removed rather than merely cancelled.
// ---------------------------------------------------------------------------

await run(`
  delete from public.payments where order_id in ('${orderId}', '${refundId}');
  delete from public.order_status_history where order_id in ('${orderId}', '${refundId}');
  delete from public.order_items where order_id in ('${orderId}', '${refundId}');
  delete from public.inventory_movements where reference_type = 'order' and reference_id in ('${orderId}', '${refundId}');
  delete from public.orders where id in ('${orderId}', '${refundId}');
  delete from public.customers where phone_normalized in ('+919000001234', '+919000005678');`);

const cleaned = await scalar(
  `select count(*) from public.orders where id in ('${orderId}', '${refundId}');`,
);
ok(cleaned === "0", "the probe orders were cleaned up");

console.log(
  failures === 0
    ? "\n  race check passed: the order lock holds\n"
    : `\n  race check FAILED: ${failures} assertion(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
