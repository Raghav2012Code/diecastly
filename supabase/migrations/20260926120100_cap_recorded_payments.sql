-- Cap recorded payments at what an order is still owed.
--
-- record_payment validated only that the amount was positive and the order
-- existed. It now also refuses an amount above the outstanding balance.
--
-- Why this matters: payment state is derived, never stored (D16, D17). An
-- overpayment therefore did not raise anything — it produced a negative
-- balance and a derived status of `paid`, and every consumer then hid the
-- negative balance (the order detail rendered a balance row only when it was
-- positive, and the receipt clamped it to zero). Typing one digit too many
-- therefore recorded a surplus that nothing on screen would ever reveal.
--
-- refund_payment was already capped at net_paid. This makes money coming in
-- bounded in the same way money going out is.
--
-- Signature unchanged, deliberately. The specification for this fix proposed
-- an explicit overpayment escape hatch behind a new p_allow_overpayment
-- parameter, but that would mean dropping and recreating the function, which
-- changes an overload set that PostgREST resolves against and that the grant
-- list pins by exact signature. None of that can be exercised without a
-- PostgreSQL instance, so the simpler guard is shipped and the escape hatch
-- is left out deliberately rather than landed untested. The guard is the fix
-- for the reported defect; a genuine overpayment is handled outside the
-- ledger.
--
-- The idempotency check stays ahead of the cap on purpose: a retry of a
-- request that already succeeded must keep returning the original result
-- rather than being rejected by a cap it has already passed.

create or replace function public.record_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_reference text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.payments;
  v_fin jsonb;
  v_balance numeric(12, 2);
begin
  perform public.require_admin();

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_payment' using errcode = '22023';
  end if;

  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.order_id <> p_order_id then
        raise exception 'idempotency_conflict' using errcode = 'P0001';
      end if;
      return public.order_json(p_order_id);
    end if;
  end if;

  v_fin := public.order_financials(p_order_id);
  v_balance := (v_fin ->> 'balance')::numeric(12, 2);

  if p_amount > v_balance then
    raise exception 'over_payment' using errcode = 'P0001';
  end if;

  insert into public.payments (
    order_id, amount, method, provider, status, reference, received_at,
    recorded_by, idempotency_key
  )
  values (
    p_order_id, p_amount, p_method, 'manual', 'received', p_reference, now(),
    auth.uid(), p_idempotency_key
  );

  return public.order_json(p_order_id);
end;
$$;
