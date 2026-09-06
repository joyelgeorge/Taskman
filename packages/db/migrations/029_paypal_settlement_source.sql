-- PayPal is a verifiable settlement source.
--
-- The audit page now sells through a PayPal link, and the ledger would have
-- refused the resulting payment: settlements_source_verifiable allowed only
-- stripe, bank and manual_receipt. The first real sale would have had to be
-- booked as manual_receipt — the category meant for cash and cheques, where the
-- only record is one the operator wrote themselves — which understates evidence
-- that is in fact as strong as Stripe's.
--
-- The test is not which company processed the money. It is whether an outside
-- system holds a record this one can be checked against, and a PayPal
-- transaction id does: issued by the processor, visible to both parties, and
-- reconcilable against a bank credit later.

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_source_verifiable;
ALTER TABLE settlements ADD CONSTRAINT settlements_source_verifiable
  CHECK (source IN ('stripe', 'paypal', 'bank', 'manual_receipt'));
