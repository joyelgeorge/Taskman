-- Multiple income possibilities, tracked as hypotheses — and the data asset
-- that accrues while none of them has settled yet.
--
-- Context: this system has a settlement-verified ledger, a rail governor, and
-- zero settlements, because every income lane it has tried needs either a human
-- to open an account or a venue that pays programmatically. Betting the whole
-- machine on one lane is how it stayed at zero. This table makes "which ways
-- could this earn" a thing the system reasons over rather than a thing that
-- lives in someone's head, and makes each one carry its own disproof.

CREATE TABLE IF NOT EXISTS income_streams (
  stream_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- How money physically arrives. If this cannot be stated concretely, the
  -- hypothesis is not ready to be worked on.
  mechanism TEXT NOT NULL,
  -- What must be true for this to earn. The falsifiable part.
  requires TEXT NOT NULL,
  -- The single next action, and who can perform it. A stream blocked on a human
  -- must say so rather than sitting in the queue looking actionable.
  next_action TEXT NOT NULL,
  unblocked_by TEXT NOT NULL CHECK (unblocked_by IN ('machine', 'human')),
  state TEXT NOT NULL DEFAULT 'HYPOTHESIS'
    CHECK (state IN ('HYPOTHESIS', 'TESTING', 'BLOCKED', 'EARNING', 'DISPROVEN')),
  -- Why it is in that state, in evidence terms. A DISPROVEN stream keeps its
  -- reason so it is not rediscovered and retried every quarter.
  state_reason TEXT,
  -- Cheapest credible test, in hours, and the smallest real payment that would
  -- count as proof. Both deliberately small: this system's failure mode is
  -- building for months toward a payment that never comes.
  test_cost_hours NUMERIC(6,2),
  proof_cents INTEGER,
  -- Set only by a real settlement. Never written by an estimate.
  first_settled_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS income_streams_state_idx ON income_streams(state);

-- A dataset that could actually be sold, as opposed to a table that has rows in
-- it. Every field here is a question a buyer's procurement or legal asks first,
-- and not being able to answer one is what makes an accumulated database
-- unsellable no matter how large it is.
CREATE TABLE IF NOT EXISTS data_products (
  product_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- The decision a buyer makes with it, and who that buyer is. A dataset with
  -- no named decision has no price.
  buyer TEXT NOT NULL,
  decision TEXT NOT NULL,
  -- Which series compose it.
  series_keys TEXT[] NOT NULL,
  -- Licence of every upstream source, resolved to whether we may resell.
  upstream_licences JSONB NOT NULL DEFAULT '[]'::jsonb,
  resale_permitted BOOLEAN NOT NULL DEFAULT FALSE,
  -- The moat test. A series the publisher also archives can be backfilled by
  -- anyone for free, so its history is worth nothing however long we keep it.
  reconstructible BOOLEAN NOT NULL,
  reconstructible_note TEXT,
  -- Value accrues with elapsed observed time, so it is recorded, not estimated.
  first_observed_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  observation_days INTEGER NOT NULL DEFAULT 0,
  row_count BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACCRUING'
    CHECK (status IN ('ACCRUING', 'SELLABLE', 'RETIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Whether a series can be reconstructed from the publisher's own archive is the
-- single fact that decides if keeping it builds an asset. Recorded per source,
-- with the URL that settles it, so the claim is checkable rather than asserted.
ALTER TABLE observation_sources ADD COLUMN IF NOT EXISTS reconstructible BOOLEAN;
ALTER TABLE observation_sources ADD COLUMN IF NOT EXISTS reconstructible_note TEXT;

-- http_json_ranked reads a ranking and the items it points at. Ordering is the
-- one thing here that no publisher archives, so it is the only series whose
-- history this system can own.
ALTER TABLE observation_sources DROP CONSTRAINT IF EXISTS observation_sources_kind_known;
ALTER TABLE observation_sources ADD CONSTRAINT observation_sources_kind_known
  CHECK (kind IN ('http_json', 'http_xml', 'http_json_ranked'));
